import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Fingerprint,
  Hash,
  Layers,
  LoaderCircle,
  Play,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { Dialog } from "./primitives";
import {
  traceSelection,
  WEIGHTED_ALGORITHM,
  type Giveaway,
} from "../../shared/core";
import type { Hex } from "viem";
type Trace = ReturnType<typeof traceSelection>;
export default function VerificationDialog({
  open,
  close,
  g,
  word,
  demo,
}: {
  open: boolean;
  close: () => void;
  g: Giveaway;
  word?: Hex;
  demo: boolean;
}) {
  const [chainState, setChainState] = useState<
      "idle" | "checking" | "verified" | "failed"
    >("idle"),
    [chainMessage, setChainMessage] = useState(""),
    [trace, setTrace] = useState<Trace | null>(null),
    [error, setError] = useState(""),
    [active, setActive] = useState(0),
    [phase, setPhase] = useState(0),
    [playing, setPlaying] = useState(false),
    [run, setRun] = useState(0),
    [reduced, setReduced] = useState(false);
  const identity = `${g.commitment}:${word}:${g.status}`,
    current = useRef(identity);
  current.current = identity;
  useEffect(() => {
    setChainState("idle");
    setChainMessage("");
    setTrace(null);
    setActive(0);
    setPlaying(false);
    setError("");
  }, [identity]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (!open) {
      setPlaying(false);
      if (trace) setPhase(4);
    }
  }, [open]);
  useEffect(() => {
    if (!playing) return;
    if (reduced) {
      setPhase(4);
      setPlaying(false);
      return;
    }
    const timers = [1, 2, 3, 4]
      .filter((p) => p > phase)
      .map((p) =>
        setTimeout(
          () => {
            setPhase(p);
            if (p === 4) setPlaying(false);
          },
          (p - phase) * 800,
        ),
      );
    return () => timers.forEach(clearTimeout);
  }, [playing, run, reduced]);
  const verify = async () => {
    if (demo || !g.evidence || g.status !== "completed") return;
    const token = current.current;
    setChainState("checking");
    setChainMessage("Checking the VRF proof against independent chain data…");
    try {
      const { verifyD20 } = await import("../../shared/proof");
      await verifyD20(g);
      if (current.current !== token) return;
      setChainState("verified");
      setChainMessage(
        "VRF proof, pinned public key, request and consumer bindings verified. Epoch source attestations rely on the coordinator’s onchain verification.",
      );
    } catch {
      if (current.current !== token) return;
      setChainState("failed");
      setChainMessage(
        "The proof could not be checked, or the RPC is unavailable. It has not been marked as verified. Try again.",
      );
    }
  };
  const replay = () => {
    if (!word) return;
    try {
      const result = traceSelection(g.manifest, word, g.commitment);
      setTrace(result);
      setActive(0);
      setError("");
      setPhase(0);
      setRun((r) => r + 1);
      setPlaying(true);
    } catch (e) {
      setTrace(null);
      setError((e as Error).message);
    }
  };
  const step = trace?.steps[active],
    weighted = g.manifest.algorithm === WEIGHTED_ALGORITHM;
  const hashChunks = useMemo(
    () => step?.derivedHash.slice(2).match(/.{1,8}/g) || [],
    [step?.derivedHash],
  );
  const selected = step ? g.manifest.entries[step.entryId - 1] : null;
  const title = step
    ? `${step.role === "winner" ? "Winner" : "Alternate"} ${step.role === "winner" ? step.draw + 1 : step.draw - g.manifest.winners + 1}`
    : "";
  return (
    <Dialog open={open} close={close} title="Follow the proof." wide>
      <p className="verification-intro">
        Check the randomness. Watch the exact calculation that reproduces this
        result.
      </p>
      <section className="chain-verification">
        <div className="verification-heading">
          <span className="verification-number">01</span>
          <h3>Onchain randomness</h3>
          <span className="proof-network">
            {demo
              ? "DEMO"
              : g.evidence
                ? `Arc Testnet · #${g.evidence.requestId}`
                : "Awaiting a result"}
          </span>
        </div>
        {demo ? (
          <div className="verification-state neutral">
            <Fingerprint size={24} />
            <div>
              <strong>Demo data, not an onchain proof</strong>
              <p>This example uses a fixed word. No D20DAO request was made.</p>
            </div>
          </div>
        ) : (
          <div className={`verification-state ${chainState}`} role="status">
            {chainState === "verified" ? (
              <CheckCircle2 size={26} />
            ) : chainState === "checking" ? (
              <LoaderCircle size={25} className="spin" />
            ) : (
              <ShieldCheck size={25} />
            )}
            <div>
              <strong>
                {chainState === "verified"
                  ? "Onchain proof verified"
                  : chainState === "checking"
                    ? "Verifying onchain proof…"
                    : chainState === "failed"
                      ? "Verification not completed"
                      : "Ready for an independent check"}
              </strong>
              <p>
                {chainMessage ||
                  "Verify the signed randomness, the committed inputs and their onchain connection."}
              </p>
            </div>
          </div>
        )}
        {!demo && (
          <div className="proof-actions">
            <button
              className="button secondary"
              onClick={verify}
              disabled={
                chainState === "checking" ||
                !g.evidence ||
                g.status !== "completed"
              }
            >
              {chainState === "verified" ? (
                <Check size={17} />
              ) : (
                <ShieldCheck size={17} />
              )}
              Verify onchain proof
            </button>
            {g.evidence && (
              <a
                className="external-link"
                href={`https://testnet.arcscan.app/tx/${g.evidence.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction <ExternalLink size={16} />
              </a>
            )}
          </div>
        )}
      </section>
      <section className="selection-verification">
        <div className="verification-heading">
          <span className="verification-number">02</span>
          <h3>From hash to winner</h3>
          {trace && phase === 4 && (
            <span className="verified-label">
              <CheckCircle2 size={15} />
              {demo ? "Demo replay matched" : "Replay verified"}
            </span>
          )}
        </div>
        <p>
          The committed list and random word feed the same versioned algorithm.
          Every selection can be reproduced, in order.
        </p>
        {!trace ? (
          <div className="trace-intro">
            <div className="trace-intro-flow" aria-hidden="true">
              <span>
                <Layers size={23} />
                Inputs
              </span>
              <ArrowRight size={18} />
              <span>
                <Fingerprint size={23} />
                Randomness
              </span>
              <ArrowRight size={18} />
              <span>
                <Hash size={23} />
                Hash
              </span>
              <ArrowRight size={18} />
              <span>
                <CheckCircle2 size={23} />
                Result
              </span>
            </div>
            <button className="button lime" disabled={!word} onClick={replay}>
              <Play size={17} />
              Replay the selection
            </button>
            {!word && (
              <p className="small muted">
                The calculation becomes available once a randomness result is
                finalized.
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="trace-navigation">
              <div>
                <strong>{title}</strong>
                <span>
                  Selection {active + 1} of {trace.steps.length}
                </span>
              </div>
              <div>
                <button
                  className="icon-button"
                  aria-label="Previous selection"
                  disabled={active === 0 || playing}
                  onClick={() => {
                    setActive((a) => a - 1);
                    setPhase(4);
                  }}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  className="icon-button"
                  aria-label="Next selection"
                  disabled={active === trace.steps.length - 1 || playing}
                  onClick={() => {
                    setActive((a) => a + 1);
                    setPhase(4);
                  }}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
              <button
                className="text-button"
                disabled={playing}
                onClick={() => {
                  if (phase === 4) {
                    setPhase(0);
                    setRun((r) => r + 1);
                  }
                  setPlaying(true);
                }}
              >
                <RotateCcw size={15} />
                {phase === 4 ? "Play this step" : "Continue"}
              </button>
              {playing && (
                <button
                  className="text-button"
                  onClick={() => setPlaying(false)}
                >
                  Pause
                </button>
              )}
              {phase < 4 && (
                <button
                  className="text-button"
                  onClick={() => {
                    setPlaying(false);
                    setPhase(4);
                  }}
                >
                  Skip animation
                </button>
              )}
            </div>
            <div className="computation-flow" key={`${run}:${active}`}>
              <div
                className={`computation-node input-node ${phase >= 0 ? "active" : ""}`}
              >
                <div className="node-heading">
                  <span className="node-number">1</span>
                  <strong>Start with locked inputs</strong>
                  <Check size={16} />
                </div>
                <div className="input-facts">
                  <span>{g.manifest.entries.length} entries</span>
                  <span>
                    {g.manifest.winners}{" "}
                    {g.manifest.winners === 1 ? "winner" : "winners"}
                  </span>
                  <span>
                    {g.manifest.reserves}{" "}
                    {g.manifest.reserves === 1 ? "alternate" : "alternates"}
                  </span>
                  <span>{weighted ? "Public weights" : "Equal chances"}</span>
                </div>
                <div className="hash-inputs">
                  <div>
                    <span>List commitment</span>
                    <code title={g.commitment} data-value={g.commitment}>
                      {g.commitment.slice(0, 14)}…{g.commitment.slice(-10)}
                    </code>
                  </div>
                  <div>
                    <span>
                      {demo ? "Demo random word" : "D20DAO random word"}
                    </span>
                    <code title={word} data-value={word}>
                      {word!.slice(0, 14)}…{word!.slice(-10)}
                    </code>
                  </div>
                  <div className="counter-input">
                    <span>Counter</span>
                    <strong>{step!.counter}</strong>
                  </div>
                </div>
                <p className="node-note">
                  Same input bytes. Same algorithm version. No new randomness
                  request.
                </p>
              </div>
              <ArrowDown
                className={`flow-arrow ${phase >= 1 ? "lit" : ""}`}
                size={21}
              />
              <div
                className={`computation-node hash-node ${phase >= 1 ? "active" : ""}`}
              >
                <div className="node-heading">
                  <span className="node-number">2</span>
                  <strong>Derive the step hash</strong>
                  <span className="node-tag">Keccak-256</span>
                </div>
                <p className="formula">
                  Hᵢ = Keccak256(domain ‖ commitment ‖ word ‖ counterᵢ)
                </p>
                <div
                  className="derived-hash"
                  aria-label={`Derived hash ${step!.derivedHash}`}
                >
                  <span className="hex-prefix">0x</span>
                  {hashChunks.map((chunk, i) => (
                    <code
                      key={i}
                      className={phase >= 1 ? "arrived" : ""}
                      style={{ "--chunk": i } as CSSProperties}
                    >
                      {chunk}
                    </code>
                  ))}
                </div>
              </div>
              <ArrowDown
                className={`flow-arrow ${phase >= 2 ? "lit" : ""}`}
                size={21}
              />
              <div
                className={`computation-node range-node ${phase >= 2 ? "active" : ""}`}
              >
                <div className="node-heading">
                  <span className="node-number">3</span>
                  <strong>Map into a fair range</strong>
                  <span className="node-tag">Rejection sampling</span>
                </div>
                <div className="range-equation">
                  <span>accepted hash</span>
                  <b>mod</b>
                  <strong>{step!.range.toLocaleString("en-US")}</strong>
                  <b>=</b>
                  <output>{step!.ticket.toLocaleString("en-US")}</output>
                </div>
                <p>
                  {step!.rejected
                    ? `${step!.rejected} out-of-range hashes were rejected before this sample.`
                    : "This hash passed the unbiased range check on the first attempt."}
                </p>
                <div
                  className={`sample-range ${phase >= 3 ? "sampled" : ""}`}
                  style={
                    {
                      "--sample": `${((step!.ticket + 0.5) / step!.range) * 100}%`,
                      "--start": `${(step!.intervalStart / step!.range) * 100}%`,
                      "--width": `${((step!.intervalEnd - step!.intervalStart) / step!.range) * 100}%`,
                    } as CSSProperties
                  }
                >
                  <span className="selected-interval" />
                  <span className="sample-pin" />
                </div>
                <div className="range-axis">
                  <span>0</span>
                  <span>
                    {weighted
                      ? `${step!.range.toLocaleString("en-US")} remaining weight units`
                      : `${step!.remainingCount.toLocaleString("en-US")} remaining entries`}
                  </span>
                  <span>{step!.range - 1}</span>
                </div>
                <p className="interval-explanation">
                  {weighted
                    ? `Ticket ${step!.ticket} falls in entry #${step!.entryId}’s interval [${step!.intervalStart}, ${step!.intervalEnd}). Its weight is ${step!.weight}.`
                    : `Offset ${step!.ticket} maps to entry #${step!.entryId} in the remaining Fisher–Yates pool.`}
                </p>
                <div className="pool-window">
                  <span>Remaining pool</span>
                  <ol>
                    {step!.nearby?.map((e) => (
                      <li
                        key={e.id}
                        className={
                          e.id === step!.entryId && phase >= 3 ? "chosen" : ""
                        }
                      >
                        <small>
                          {weighted ? `w${e.weight}` : `offset ${e.position}`}
                        </small>
                        <b>#{e.id}</b>
                      </li>
                    ))}
                  </ol>
                  {step!.remainingCount > 5 && (
                    <small>
                      Nearby entries shown; IDs stay fixed as the pool changes.
                    </small>
                  )}
                </div>
              </div>
              <ArrowDown
                className={`flow-arrow ${phase >= 4 ? "lit" : ""}`}
                size={21}
              />
              <div className={`trace-result ${phase >= 4 ? "matched" : ""}`}>
                <span className="result-check">
                  <Check size={27} />
                </span>
                <div>
                  <span>
                    {title} · #{String(step!.entryId).padStart(4, "0")}
                  </span>
                  <strong>{selected!.label}</strong>
                  <p>
                    {weighted
                      ? "This entry and its full weight leave the pool."
                      : "This entry is removed from the remaining pool."}{" "}
                    It cannot be selected again.
                  </p>
                </div>
              </div>
            </div>
            <div
              className={`replay-complete ${phase === 4 ? "shown" : ""}`}
              role="status"
              aria-hidden={phase < 4}
            >
              <CheckCircle2 size={20} />
              <div>
                <strong>
                  {demo
                    ? "Demo calculation reproduced"
                    : "Selection reproduced"}
                </strong>
                <p>
                  Selection reproduced. Winning entry IDs:{" "}
                  {trace.outcome.winners.join(", ")}.
                  {trace.outcome.reserves.length > 0
                    ? ` Alternates: ${trace.outcome.reserves.join(", ")}.`
                    : ""}{" "}
                  {demo
                    ? "This checks the demo data only."
                    : "Onchain randomness is checked separately above."}
                </p>
              </div>
            </div>
            <details className="exact-bytes">
              <summary>Inspect exact values</summary>
              <dl className="proof-data">
                <dt>List commitment</dt>
                <dd>{g.commitment}</dd>
                <dt>{demo ? "Demo random word" : "D20DAO random word"}</dt>
                <dd>{word}</dd>
                <dt>Algorithm</dt>
                <dd>{g.manifest.algorithm}</dd>
                <dt>Domain bytes (UTF-8)</dt>
                <dd>{trace.domain}</dd>
                <dt>Counter (uint256, big-endian)</dt>
                <dd>
                  0x{BigInt(step!.counter).toString(16).padStart(64, "0")}
                </dd>
                <dt>Derived hash as an integer</dt>
                <dd>{step!.sample}</dd>
                <dt>Acceptance limit · sample must be smaller</dt>
                <dd>{step!.limit}</dd>
                <dt>Sampling range</dt>
                <dd>{step!.range}</dd>
              </dl>
            </details>
          </>
        )}
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <p className="verification-privacy">
          Public replay verifies entry IDs. It does not reveal private names,
          verify real-world identities or prove prize delivery.
        </p>
      </section>
    </Dialog>
  );
}
