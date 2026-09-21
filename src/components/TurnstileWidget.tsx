import { useEffect, useRef, useState } from "react";
import "../turnstile.css";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}
let scriptReady: Promise<Turnstile> | undefined;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptReady) return scriptReady;
  scriptReady = new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    const timeout = setTimeout(() => fail(), 15000);
    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      scriptReady = undefined;
      reject(
        new Error(
          "Verification could not load. Check your connection and try again.",
        ),
      );
    };
    script.onerror = fail;
    script.onload = () => {
      clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else fail();
    };
    document.head.appendChild(script);
  });
  return scriptReady;
}

export default function TurnstileWidget({
  siteKey,
  resetKey,
  onToken,
}: {
  siteKey: string;
  resetKey: number;
  onToken: (token: string | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const tokenCallback = useRef(onToken);
  tokenCallback.current = onToken;
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [verified, setVerified] = useState(false);
  const [retry, setRetry] = useState(0);
  const [compact, setCompact] = useState(true);
  useEffect(() => {
    const target = container.current;
    if (!target) return;
    const observer = new ResizeObserver(([entry]) =>
      setCompact(entry.contentRect.width < 300),
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    let widget: string | undefined;
    let api: Turnstile | undefined;
    setError("");
    setReady(false);
    setVerified(false);
    tokenCallback.current(null);
    const invalidate = (message: string) => {
      if (!live) return;
      setVerified(false);
      tokenCallback.current(null);
      setError(message);
    };
    loadTurnstile()
      .then((turnstile) => {
        if (!live || !container.current) return;
        api = turnstile;
        widget = api.render(container.current, {
          sitekey: siteKey,
          action: "giveaway-save",
          theme: "light",
          language: "en",
          size: compact ? "compact" : "flexible",
          "response-field": false,
          retry: "never",
          "refresh-expired": "manual",
          "refresh-timeout": "manual",
          callback: (token: string) => {
            if (!live) return;
            setError("");
            setVerified(true);
            tokenCallback.current(token);
          },
          "expired-callback": () =>
            invalidate("Verification expired. Verify again before saving."),
          "timeout-callback": () =>
            invalidate("Verification timed out. Please try again."),
          "error-callback": (code: string) => {
            invalidate(
              code === "110200"
                ? "Verification is not enabled for this site address. Your draft is still here."
                : code.startsWith("1101")
                  ? "Verification is not configured correctly. Your draft is still here."
                  : "Verification could not finish. Check your connection and try again.",
            );
            return true;
          },
        });
        setReady(true);
      })
      .catch((cause: Error) => invalidate(cause.message));
    return () => {
      live = false;
      if (widget !== undefined) api?.remove(widget);
      tokenCallback.current(null);
    };
  }, [siteKey, resetKey, retry, compact]);
  return (
    <section className="save-verification" aria-label="Save verification">
      <p className="save-verification-label">Verify before saving</p>
      <div className="turnstile-slot" data-compact={compact} ref={container} />
      <div className="verification-feedback">
        <p role="status">
          {error ||
            (verified
              ? "Verification complete."
              : ready
                ? "Complete the verification to continue."
                : "Loading verification…")}
        </p>
        {error && (
          <button
            type="button"
            className="text-button"
            onClick={() => setRetry((value) => value + 1)}
          >
            Retry verification
          </button>
        )}
      </div>
    </section>
  );
}
