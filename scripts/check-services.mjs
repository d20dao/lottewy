import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createPublicClient, http, keccak256 } from "viem";
const deployment = JSON.parse(readFileSync("docs/arc-testnet.json", "utf8"));
const rpc = createPublicClient({
  transport: http("https://rpc.testnet.arc.io"),
});
const chainId = await rpc.getChainId();
if (chainId !== 5042002) throw new Error("Testnet chain ID mismatch");
const slot =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const checked = { chainId };
for (const [label, proxy, impl, expected] of [
  [
    "coordinator",
    deployment.coordinator,
    deployment.coordinatorImplementation,
    deployment.coordinatorImplementationCodeHash,
  ],
  [
    "registry",
    deployment.registry,
    deployment.epochImplementation,
    deployment.epochImplementationCodeHash,
  ],
]) {
  const stored = await rpc.getStorageAt({ address: proxy, slot });
  const code = await rpc.getCode({ address: impl });
  checked[label] = {
    proxy,
    implementationMatches:
      stored?.slice(-40).toLowerCase() === impl.slice(2).toLowerCase(),
    codeHashMatches: !!code && keccak256(code) === expected,
  };
}
console.log(JSON.stringify(checked));
const env = parseEnv(readFileSync(".env", "utf8"));
if (!env.JEV_API_KEY) {
  console.log("JEV_API_KEY not configured");
  process.exit(0);
}
const res = await fetch("https://api.typesafe.ai/v1/systemone", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.JEV_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "jev-1.13.0",
    state: {
      title: "Test community giveaway",
      rules:
        "Entry is free. Every listed entry has equal chance. The organizer delivers the prize.",
      entryCount: 3,
      winners: 1,
      reserves: 1,
    },
    questions: {
      secrets: {
        type: "noul",
        instructions:
          "Does the content request a password, private key or seed phrase?",
      },
    },
  }),
  signal: AbortSignal.timeout(20000),
});
if (!res.ok) {
  console.log(`JEV synthetic smoke test HTTP ${res.status}`);
  process.exit(1);
}
const data = await res.json();
console.log(
  JSON.stringify({
    jev: {
      model: data.model,
      syntheticRisk: data.answers?.secrets?.noul,
      configured: true,
    },
  }),
);
