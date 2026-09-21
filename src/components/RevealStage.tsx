import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type CSSProperties,
} from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import type { Entry } from "../../shared/core";
export type RevealMode =
  | "simple"
  | "slot"
  | "wheel"
  | "scramble"
  | "countdown"
  | "balloon"
  | "scratch";
const modes: [RevealMode, string][] = [
  ["simple", "Simple reveal"],
  ["slot", "Slot reel"],
  ["wheel", "Wheel"],
  ["scramble", "Name scramble"],
  ["countdown", "Countdown"],
  ["balloon", "Balloon pop"],
  ["scratch", "Scratch to reveal"],
];
export default function RevealStage({
  entries,
  winners,
  mode,
  onMode,
  onComplete,
  demo = false,
  autoPlay = false,
  rank,
}: {
  entries: Entry[];
  winners: number[];
  mode: RevealMode;
  onMode: (mode: RevealMode) => void;
  onComplete: () => void;
  demo?: boolean;
  autoPlay?: boolean;
  rank?: number;
}) {
  const batched = winners.length > 1;
  const [playing, setPlaying] = useState(autoPlay),
    [tick, setTick] = useState(0),
    [popped, setPopped] = useState(false),
    [reduced, setReduced] = useState(false);
  const done = useRef(onComplete);
  const skip = useRef<HTMLButtonElement>(null);
  done.current = onComplete;
  const winner = entries[winners[0] - 1];
  const samples = useMemo(
    () =>
      Array.from(
        { length: 8 },
        (_, i) => entries[(i * 7 + 3) % entries.length].label,
      ).concat(winner.label),
    [entries, winner.label],
  );
  useEffect(() => {
    if (playing && !autoPlay) skip.current?.focus({ preventScroll: true });
  }, [playing, autoPlay]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(media.matches);
    const change = () => setReduced(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!playing) return;
    if (reduced || mode === "simple") {
      done.current();
      return;
    }
    if (batched && !autoPlay) return;
    if (mode === "balloon" || mode === "scratch") return;
    const duration =
      mode === "countdown" ? 3000 : mode === "wheel" ? 2400 : 1800;
    const timer = setTimeout(() => done.current(), duration),
      interval =
        mode === "countdown" || mode === "scramble"
          ? setInterval(
              () => setTick((t) => t + 1),
              mode === "countdown" ? 1000 : 90,
            )
          : null;
    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
    };
  }, [playing, mode, reduced, batched, autoPlay]);
  useEffect(() => {
    if (!popped) return;
    const t = setTimeout(() => done.current(), 330);
    return () => clearTimeout(t);
  }, [popped]);
  const scrambled = winner.label
    .split("")
    .map((char, i) =>
      i < (tick / 18) * winner.label.length || char === " " || char === "*"
        ? char
        : "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[(i * 7 + tick * 3) % 32],
    )
    .join("");
  const begin = (next: RevealMode) => {
    onMode(next);
    setTick(0);
    setPopped(false);
    setPlaying(true);
  };
  if (playing && batched && !autoPlay && !reduced && mode !== "simple") {
    return (
      <BatchReveal
        entries={entries}
        winners={winners}
        mode={mode}
        demo={demo}
        onComplete={onComplete}
      />
    );
  }
  return (
    <section
      className={`reveal-stage ${autoPlay ? "reveal-compact" : ""}`}
      aria-label={rank ? `Winner ${rank} animation` : "Result presentation"}
    >
      {!autoPlay && (
        <div className="reveal-controls">
          <h2>
            {playing
              ? modes.find(([value]) => value === mode)?.[1]
              : "Make it a moment."}
          </h2>
          <span>
            <ShieldCheck size={15} />
            {demo ? "Fixed demo result" : "Result already recorded"}
          </span>
        </div>
      )}
      {!playing && winners.length > 1 && (
        <div className="reveal-sequence-choice">
          <p id="reveal-sequence-help">
            {`${winners.length} winners · ${Math.ceil(winners.length / 5)} ${winners.length > 5 ? "rounds" : "round"} · Up to 5 animations at a time.`}
          </p>
        </div>
      )}
      <div className={`reveal-viewport ${playing ? "playing" : ""}`}>
        {!playing ? (
          <div className="reveal-options">
            {modes
              .filter(([value]) => value !== "simple")
              .map(([value, label]) => (
                <button
                  key={value}
                  className="reveal-option"
                  aria-label={`Reveal with ${label}`}
                  onClick={() => begin(value)}
                >
                  <span
                    className={`reveal-option-art art-${value}`}
                    aria-hidden="true"
                  >
                    {value === "slot" ? (
                      <span className="mini-reel">
                        <i>A***</i>
                        <b>B***</b>
                        <i>C***</i>
                      </span>
                    ) : value === "wheel" ? (
                      <span className="mini-wheel">✳</span>
                    ) : value === "scramble" ? (
                      <span className="mini-scramble">
                        A<span>×</span>R<span>?</span>
                      </span>
                    ) : value === "countdown" ? (
                      <span className="mini-countdown">
                        <i>3</i>
                        <b>2</b>
                        <i>1</i>
                      </span>
                    ) : value === "balloon" ? (
                      <span className="mini-balloon">✳</span>
                    ) : (
                      <span className="mini-scratch">
                        A***
                        <i />
                      </span>
                    )}
                  </span>
                  <span className="reveal-option-title">
                    {label}
                    <ArrowRight size={16} />
                  </span>
                </button>
              ))}
          </div>
        ) : (
          <>
            {mode === "slot" && (
              <div className="slot-reel" aria-hidden="true">
                <div className="slot-window">
                  <div className="slot-track">
                    {samples.map((label, i) => (
                      <div className="slot-label" key={i}>
                        {label}
                      </div>
                    ))}
                  </div>
                </div>
                <span className="reel-pointer">›</span>
              </div>
            )}
            {mode === "wheel" && (
              <div className="wheel-wrap" aria-hidden="true">
                <span className="wheel-pointer" />
                <div className="reveal-wheel" />
                <div className="wheel-center">✳</div>
              </div>
            )}
            {mode === "scramble" && (
              <div className="scramble-name" aria-hidden="true">
                <span>THE RECORDED WINNER</span>
                <strong>{scrambled}</strong>
                <small>#{String(winner.id).padStart(4, "0")}</small>
              </div>
            )}
            {mode === "countdown" && (
              <div className="reveal-countdown" aria-hidden="true" key={tick}>
                {Math.max(1, 3 - tick)}
              </div>
            )}
            {mode === "balloon" && (
              <button
                className={`balloon-button ${popped ? "popped" : ""}`}
                onClick={() => setPopped(true)}
                disabled={popped}
                aria-label={
                  rank
                    ? `Pop balloon to reveal winner ${rank}`
                    : "Pop balloon to reveal recorded winners"
                }
              >
                <span className="balloon-shape">✳</span>
                <span className="balloon-caption">Pop to reveal</span>
              </button>
            )}
            {mode === "scratch" && (
              <Scratch label={winner.label} onComplete={() => done.current()} />
            )}
          </>
        )}
      </div>
      {!autoPlay && (
        <p className="reveal-status" role="status">
          {playing
            ? "Revealing the recorded result. No new draw is taking place."
            : reduced
              ? "Reduced motion is enabled. The result will appear immediately."
              : mode === "wheel"
                ? "The wheel is decorative; it does not represent entry odds."
                : `Choose a card to reveal ${winners.length === 1 ? "the winner" : `all ${winners.length} winners`}. The result stays the same.`}
        </p>
      )}
      {!playing ? (
        <button
          className="text-button instant-reveal"
          onClick={() => begin("simple")}
        >
          Reveal instantly <ArrowRight size={18} />
        </button>
      ) : !autoPlay || mode === "scratch" ? (
        <button
          ref={skip}
          className="button secondary"
          onClick={() => done.current()}
        >
          {rank
            ? `Reveal winner ${rank} without scratching`
            : mode === "scratch"
              ? "Reveal without scratching"
              : "Skip animation"}
          <ArrowRight size={18} />
        </button>
      ) : null}
    </section>
  );
}
function BatchReveal({
  entries,
  winners,
  mode,
  demo,
  onComplete,
}: {
  entries: Entry[];
  winners: number[];
  mode: RevealMode;
  demo: boolean;
  onComplete: () => void;
}) {
  const [round, setRound] = useState(0),
    [settled, setSettled] = useState<number[]>([]);
  const nextButton = useRef<HTMLButtonElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (stage && stage.getBoundingClientRect().top < 16)
      stage.scrollIntoView({ block: "start", behavior: "instant" });
  }, [round]);
  const start = round * 5,
    current = winners.slice(start, start + 5),
    rounds = Math.ceil(winners.length / 5);
  const ready = current.every((id) => settled.includes(id));
  const finish = (id: number) =>
    setSettled((previous) =>
      previous.includes(id) ? previous : [...previous, id],
    );
  useEffect(() => {
    if (ready) nextButton.current?.focus({ preventScroll: true });
  }, [ready]);
  return (
    <section
      className="reveal-stage reveal-batched"
      ref={stageRef}
      data-mode={mode}
      aria-label="Winner reveal rounds"
    >
      <div className="reveal-controls">
        <h2>
          Round {round + 1} of {rounds}
        </h2>
        <span>{demo ? "Fixed demo result" : "Result already recorded"}</span>
      </div>
      <p className="round-progress" role="status">
        Winners {start + 1}–{start + current.length} of {winners.length} ·{" "}
        {settled.length} revealed
      </p>
      <div
        className="reveal-batch-grid"
        style={{ "--reveal-columns": current.length } as CSSProperties}
      >
        {current.map((id, index) => (
          <article className="reveal-winner-column" key={`${round}:${id}`}>
            <h3>Winner {start + index + 1}</h3>
            {settled.includes(id) ? (
              <div className="round-winner-result">
                <strong>{entries[id - 1].label}</strong>
                <small>Entry #{String(id).padStart(4, "0")}</small>
              </div>
            ) : (
              <RevealStage
                autoPlay
                rank={start + index + 1}
                entries={entries}
                winners={[id]}
                mode={mode}
                onMode={() => {}}
                onComplete={() => finish(id)}
                demo={demo}
              />
            )}
          </article>
        ))}
      </div>
      <p className="reveal-status">
        {mode === "wheel"
          ? "The wheels are decorative; they do not represent entry odds."
          : "These animations reveal the recorded winners in order. No new draw takes place."}
      </p>
      <div className="round-actions">
        {ready ? (
          <button
            ref={nextButton}
            className="button lime"
            onClick={() => {
              if (round + 1 === rounds) onComplete();
              else setRound((value) => value + 1);
            }}
          >
            {round + 1 === rounds
              ? "See all winners"
              : `Reveal next ${Math.min(5, winners.length - start - current.length)} winners`}
            <ArrowRight size={18} />
          </button>
        ) : (
          <button
            className="button secondary"
            onClick={() =>
              setSettled((previous) =>
                Array.from(new Set([...previous, ...current])),
              )
            }
          >
            Skip this round
          </button>
        )}
        <button className="text-button" onClick={onComplete}>
          Reveal all now
        </button>
      </div>
    </section>
  );
}
function Scratch({
  label,
  onComplete,
}: {
  label: string;
  onComplete: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null),
    drawing = useRef(false),
    last = useRef<{ x: number; y: number } | null>(null),
    cells = useRef(new Set<number>()),
    complete = useRef(false);
  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    let paintedWidth = 0,
      paintedHeight = 0;
    const paint = () => {
      const rect = c.getBoundingClientRect(),
        ratio = devicePixelRatio || 1;
      if (rect.width === paintedWidth && rect.height === paintedHeight) return;
      paintedWidth = rect.width;
      paintedHeight = rect.height;
      c.width = rect.width * ratio;
      c.height = rect.height * ratio;
      const ctx = c.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.fillStyle = "#b9dd88";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.fillStyle = "#365322";
      ctx.font = `600 ${Math.min(18, Math.max(12, rect.width / 12))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Scratch to reveal", rect.width / 2, rect.height / 2 - 4);
      ctx.font = `${Math.min(12, Math.max(9, rect.width / 18))}px sans-serif`;
      ctx.fillText(
        "The winner is already recorded",
        rect.width / 2,
        rect.height / 2 + 23,
      );
      cells.current.clear();
      last.current = null;
      drawing.current = false;
    };
    paint();
    const observer = new ResizeObserver(paint);
    observer.observe(c);
    return () => observer.disconnect();
  }, []);
  const scratch = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || complete.current) return;
    const canvas = ref.current!,
      rect = canvas.getBoundingClientRect(),
      ctx = canvas.getContext("2d")!,
      x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineWidth = 48;
    ctx.beginPath();
    ctx.moveTo(last.current?.x ?? x, last.current?.y ?? y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fill();
    const from = last.current || { x, y },
      dx = x - from.x,
      dy = y - from.y,
      length = dx * dx + dy * dy;
    // Count the whole erased stroke, including fast pointer movements between events.
    for (let row = 0; row < 6; row++)
      for (let col = 0; col < 10; col++) {
        const cx = ((col + 0.5) * rect.width) / 10,
          cy = ((row + 0.5) * rect.height) / 6;
        const t = length
          ? Math.max(
              0,
              Math.min(1, ((cx - from.x) * dx + (cy - from.y) * dy) / length),
            )
          : 0;
        if (
          (cx - from.x - t * dx) ** 2 + (cy - from.y - t * dy) ** 2 <=
          24 ** 2
        )
          cells.current.add(row * 10 + col);
      }
    last.current = { x, y };
    if (cells.current.size >= 34) {
      complete.current = true;
      onComplete();
    }
  };
  return (
    <div className="scratch-card">
      <div className="scratch-result" aria-hidden="true">
        <span>RECORDED WINNER</span>
        <strong>{label}</strong>
      </div>
      <canvas
        ref={ref}
        aria-hidden="true"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          scratch(e);
        }}
        onPointerMove={scratch}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerCancel={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
    </div>
  );
}
