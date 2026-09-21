import { createPublicClient, http, type Address } from "viem";
import { arc } from "../shared/chain";
import { CHAIN_ID } from "../shared/core";

export type AbuseCode =
  | "ARC_USDC_REQUIRED"
  | "FUNDING_CHECK_UNAVAILABLE"
  | "BOT_CHECK_REQUIRED"
  | "BOT_CHECK_UNAVAILABLE"
  | "REVIEW_RATE_LIMIT"
  | "REVIEW_LIMIT_UNAVAILABLE";

export class AbuseError extends Error {
  constructor(
    public readonly code: AbuseCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AbuseError";
  }
}

export async function assertFunded(env: { RPC_URL: string }, address: Address) {
  let balance: bigint;
  try {
    if (!env.RPC_URL) throw new Error("Missing network configuration");
    const client = createPublicClient({
      chain: arc,
      transport: http(env.RPC_URL, { timeout: 8000, retryCount: 0 }),
    });
    if ((await client.getChainId()) !== CHAIN_ID)
      throw new Error("Incorrect network");
    balance = await client.getBalance({ address, blockTag: "latest" });
    if (typeof balance !== "bigint" || balance < 0n)
      throw new Error("Invalid balance");
  } catch {
    throw new AbuseError(
      "FUNDING_CHECK_UNAVAILABLE",
      "The Arc Testnet balance check is unavailable. Your draft is preserved; please try again.",
      503,
    );
  }
  if (balance === 0n)
    throw new AbuseError(
      "ARC_USDC_REQUIRED",
      "Fund this wallet with native USDC on Arc Testnet before saving a giveaway. Your draft is preserved.",
      400,
    );
}

export async function checkTurnstile(
  env: { MODE: string; APP_ORIGIN: string; TURNSTILE_SECRET_KEY?: string },
  token: unknown,
  ip?: string | null,
) {
  if (!env.TURNSTILE_SECRET_KEY) {
    if (env.MODE === "development") return;
    throw new AbuseError(
      "BOT_CHECK_UNAVAILABLE",
      "The anti-bot check is not configured. Your draft is preserved; please try again later.",
      503,
    );
  }
  if (typeof token !== "string" || !token.trim() || token.length > 2048)
    throw new AbuseError(
      "BOT_CHECK_REQUIRED",
      "Complete the anti-bot check before saving. Your draft is preserved.",
      400,
    );
  let result: { success?: unknown; action?: unknown; hostname?: unknown };
  let expectedHostname: string;
  try {
    const origin = new URL(env.APP_ORIGIN);
    if (!["http:", "https:"].includes(origin.protocol) || !origin.hostname)
      throw new Error("Invalid application origin");
    expectedHostname = origin.hostname;
    const body = new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
    });
    if (ip) body.set("remoteip", ip);
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) throw new Error("Verification unavailable");
    result = await response.json();
  } catch {
    throw new AbuseError(
      "BOT_CHECK_UNAVAILABLE",
      "The anti-bot check is unavailable. Your draft is preserved; please retry the check.",
      503,
    );
  }
  // Siteverify enforces five-minute expiry and single use. Never trust a client
  // assertion, an unbound token, or an upstream response body in an error message.
  if (
    !result ||
    result.success !== true ||
    result.action !== "giveaway-save" ||
    result.hostname !== expectedHostname
  )
    throw new AbuseError(
      "BOT_CHECK_REQUIRED",
      "The anti-bot check expired or could not be verified. Complete a new check; your draft is preserved.",
      400,
    );
}

const budgets = [
  { kind: "minute", seconds: 60, limit: 3 },
  { kind: "hour", seconds: 3600, limit: 20 },
] as const;

/** Call only after funding and bot verification, immediately before JEV. This
 * reservation is intentionally retained when content review denies a request.
 */
export async function consumeReviewBudget(
  env: { DB: D1Database },
  address: Address,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const wallet = address.toLowerCase();
  const windows = budgets.map((budget) => {
    const start = Math.floor(timestamp / budget.seconds) * budget.seconds;
    return {
      ...budget,
      bucket: `${budget.kind}:${start}`,
      expires: start + budget.seconds,
    };
  });
  const exhausted = async () => {
    const rows = await env.DB.prepare(
      "SELECT bucket,count FROM abuse_buckets WHERE wallet=? AND bucket IN (?,?)",
    )
      .bind(wallet, windows[0].bucket, windows[1].bucket)
      .all<{ bucket: string; count: number }>();
    return rows.results.some((row) =>
      windows.some(
        (window) => window.bucket === row.bucket && row.count >= window.limit,
      ),
    );
  };
  const denied = () =>
    new AbuseError(
      "REVIEW_RATE_LIMIT",
      "This wallet has reached its review limit (3 attempts per minute or 20 per hour). Your draft is preserved; please try again later.",
      429,
    );
  try {
    if (await exhausted()) throw denied();
    const statements = windows.flatMap((window) => [
      env.DB.prepare(
        "INSERT INTO abuse_buckets(wallet,bucket,count,expires) VALUES (?,?,1,?) ON CONFLICT(wallet,bucket) DO UPDATE SET count=count+1 WHERE count<?",
      ).bind(wallet, window.bucket, window.expires, window.limit),
      env.DB.prepare(
        "INSERT INTO atomic_guard(ok) VALUES (CASE WHEN changes()=1 THEN 1 ELSE 0 END)",
      ),
    ]);
    await env.DB.batch([
      ...statements,
      env.DB.prepare(
        "DELETE FROM abuse_buckets WHERE wallet=? AND expires<=?",
      ).bind(wallet, timestamp),
      env.DB.prepare("DELETE FROM atomic_guard"),
    ]);
  } catch (error) {
    if (error instanceof AbuseError) throw error;
    // A concurrent request may have exhausted either window after the precheck.
    try {
      if (await exhausted()) throw denied();
    } catch (recheck) {
      if (recheck instanceof AbuseError) throw recheck;
    }
    throw new AbuseError(
      "REVIEW_LIMIT_UNAVAILABLE",
      "The review availability check is unavailable. Your draft is preserved; please try again.",
      503,
    );
  }
}
