import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ExternalLink,
  FileUp,
  Globe2,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { api } from "./api";
import {
  normalize,
  wallet,
  MAX_WEIGHT,
  weightingConflict,
  type Draft,
} from "../shared/core";
import {
  readDraft,
  writeDraft,
  removeDraft,
  type LocalDraft,
} from "./editor-draft";
import PublicAppearance from "./components/PublicAppearance";
import TurnstileWidget from "./components/TurnstileWidget";
import {
  analyzeEntries,
  analyzeEditor,
  formatWeightedEntries,
  extractColumn,
  extractWeights,
  likelyHeader,
  readCsv,
  IMPORT_LIMIT,
  type CsvSheet,
  type Delimiter,
} from "../shared/import";
import { Collapsible, Empty } from "./components/primitives";

type Props = {
  user: { address: string } | null;
  busy: boolean;
  config: {
    jevConfigured: boolean;
    jevEnabled?: boolean;
    turnstileSiteKey?: string | null;
  } | null;
  run: (fn: () => Promise<void>) => void;
  mutate: (
    type: string,
    id: string,
    revision: number,
    payload: unknown,
    progress?: (message: string) => void,
    options?: { turnstileToken?: string },
  ) => Promise<any>;
  notify: (message: string) => void;
  onLogin: () => void;
  refresh: () => void;
};
const blank: Draft = {
  title: "",
  description: "",
  rules: "",
  entries: [],
  winners: 1,
  reserves: 0,
  listed: false,
};
const sample = [
  "Alex Morgan",
  "sam@example.com",
  "@riverstudio",
  "Jordan Lee",
  "0x0000000000000000000000000000000000000001",
  "Community member 06",
];
type Errors = Partial<
  Record<"entries" | "title" | "rules" | "winners" | "reserves", string>
>;

export default function Editor({
  user,
  busy,
  config,
  run,
  mutate,
  notify,
  onLogin,
}: Props) {
  const id = location.pathname.startsWith("/edit/")
    ? location.pathname.split("/")[2]
    : null;
  const [initial] = useState(() => (!id ? readDraft(user?.address, id) : null));
  const [dataOwner, setDataOwner] = useState(user?.address || "guest");
  const [draft, setDraft] = useState<Draft>({ ...blank, ...initial?.fields }),
    [text, setText] = useState(initial?.text || ""),
    [step, setStep] = useState(initial?.step || 0),
    [revision, setRevision] = useState(0),
    [loadError, setLoadError] = useState(""),
    [loadedOwner, setLoadedOwner] = useState<string | null>(null),
    [errors, setErrors] = useState<Errors>({}),
    [saveError, setSaveError] = useState(""),
    [saveErrorCode, setSaveErrorCode] = useState(""),
    [phase, setPhase] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null),
    [verificationReset, setVerificationReset] = useState(0);
  const [importOpen, setImportOpen] = useState(false),
    [undo, setUndo] = useState<{
      text: string;
      message: string;
      weights: Map<string, number>;
      weighted: boolean;
    } | null>(null),
    [notice, setNotice] = useState("");
  const [weighted, setWeighted] = useState(initial?.weighted || false),
    [weightMap, setWeightMap] = useState(() => new Map<string, number>());
  const textarea = useRef<HTMLTextAreaElement>(null),
    importTrigger = useRef<HTMLButtonElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    previousUser = useRef(user?.address),
    saved = useRef(false);
  const deferredText = useDeferredValue(text),
    stats = useMemo(
      () => analyzeEditor(deferredText, weighted),
      [deferredText, weighted],
    ),
    analyzing = deferredText !== text;
  const weightValues = useMemo(
    () => stats.weights ?? stats.keys.map((key) => weightMap.get(key) ?? 1),
    [stats.keys, stats.weights, weightMap],
  );
  const dirty = !!(text || draft.title || draft.rules || draft.description);
  useEffect(() => {
    if (previousUser.current && previousUser.current !== user?.address) {
      setDraft({ ...blank });
      setText("");
      setStep(0);
      setLoadedOwner(null);
      setErrors({});
      setUndo(null);
      setImportOpen(false);
      setSaveError("");
      setWeighted(false);
      setWeightMap(new Map());
      setDataOwner(user?.address || "guest");
    }
    previousUser.current = user?.address;
  }, [user?.address]);
  useEffect(() => {
    if (id) return;
    const owner = user?.address || "guest";
    if (dataOwner === owner) return;
    if (dataOwner === "guest" && user) {
      const cached = readDraft(user.address, id);
      if (cached && !text.trim() && !draft.title) {
        setDraft({ ...blank, ...cached.fields });
        setText(cached.text);
        setWeighted(cached.weighted);
        setStep(cached.step);
      }
      setDataOwner(owner);
    }
  }, [user?.address, id, dataOwner]);
  useEffect(() => {
    if (!id || !user) return;
    let live = true;
    setLoadError("");
    api(`/giveaways/${id}/private`)
      .then((g) => {
        if (!live) return;
        if (g.status !== "draft")
          throw new Error(
            "This giveaway is locked. Its entries and rules can no longer be edited.",
          );
        const cached = readDraft(user.address, id),
          restore = cached?.revision === g.revision ? cached : null;
        setDraft(
          restore
            ? { ...g.private.draft, listed: !!g.listed, ...restore.fields }
            : { ...g.private.draft, listed: !!g.listed },
        );
        setWeighted(restore ? restore.weighted : !!g.private.draft.weights);
        const keys = analyzeEntries(g.private.draft.entries.join("\n")).keys;
        setWeightMap(
          new Map(
            keys.map((key, i) => [key, g.private.draft.weights?.[i] ?? 1]),
          ),
        );
        setText(
          restore
            ? restore.text
            : g.private.draft.weights
              ? formatWeightedEntries(
                  g.private.draft.entries,
                  g.private.draft.weights,
                )
              : g.private.draft.entries.join("\n"),
        );
        if (restore) {
          setStep(restore.step);
          setNotice("Unsaved changes restored in this tab.");
        }
        setRevision(g.revision);
        setLoadedOwner(user.address);
        setDataOwner(user.address);
      })
      .catch((e) => live && setLoadError(e.message));
    return () => {
      live = false;
    };
  }, [id, user?.address]);
  const localSnapshot = (): LocalDraft => ({
    fields: {
      title: draft.title,
      description: draft.description,
      rules: draft.rules,
      winners: draft.winners,
      reserves: draft.reserves,
      listed: !!draft.listed,
    },
    text,
    weighted,
    step,
    revision,
  });
  useEffect(() => {
    if (
      saved.current ||
      dataOwner !== (user?.address || "guest") ||
      (id && loadedOwner !== user?.address)
    )
      return;
    const timer = setTimeout(() => {
      writeDraft(user?.address, id, localSnapshot());
      if (user && !id) removeDraft(undefined, null);
    }, 200);
    return () => clearTimeout(timer);
  }, [
    text,
    draft.title,
    draft.description,
    draft.rules,
    draft.winners,
    draft.reserves,
    draft.listed,
    weighted,
    step,
    revision,
    user?.address,
    id,
    dataOwner,
    loadedOwner,
  ]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty && !saved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const editText = (value: string) => {
    setText(value.replace(/\r\n?/g, "\n"));
    setErrors((e) => ({ ...e, entries: undefined }));
    setSaveError("");
    setUndo(null);
    setNotice("");
  };
  const toggleWeighted = (enabled: boolean) => {
    const current = analyzeEditor(text, weighted);
    if (current.formatError) {
      setErrors({ entries: current.formatError });
      return;
    }
    if (enabled)
      setText(
        formatWeightedEntries(
          current.entries,
          current.keys.map((key) => weightMap.get(key) ?? 1),
        ),
      );
    else {
      setWeightMap(
        new Map(current.keys.map((key, i) => [key, current.weights?.[i] ?? 1])),
      );
      setText(current.entries.join("\n"));
    }
    setWeighted(enabled);
    setErrors((e) => ({ ...e, entries: undefined }));
    setUndo(null);
  };
  const replaceText = (next: string, message: string) => {
    setUndo({ text, message, weights: weightMap, weighted });
    setText(next);
    setNotice(message);
    setErrors((e) => ({ ...e, entries: undefined }));
  };
  const jump = (index: number) => {
    const range = stats.offsets[index];
    if (!range || !textarea.current) return;
    textarea.current.focus();
    textarea.current.setSelectionRange(range.start, range.end);
    textarea.current.scrollTop = (stats.sourceRows[index] - 1) * 27;
  };
  const validate = (): Draft | null => {
    const current = analyzeEditor(text, weighted),
      next: Errors = {};
    if (current.entries.length < 2 || current.entries.length > 10000)
      next.entries = "Add between 2 and 10,000 entries.";
    else if (current.long.length)
      next.entries = `Shorten entries on lines ${current.long
        .slice(0, 8)
        .map((i) => current.sourceRows[i])
        .join(", ")} to 256 UTF-8 bytes or fewer.`;
    else if (current.duplicates.length)
      next.entries = `Resolve ${current.duplicates.length} repeated ${current.duplicates.length === 1 ? "entry" : "entries"} before continuing.`;
    if (draft.title.trim().length < 3)
      next.title = "Give this giveaway a title of at least 3 characters.";
    if (draft.rules.trim().length < 5)
      next.rules =
        "Explain who is included and how any prize will be delivered.";
    if (
      !Number.isInteger(draft.winners) ||
      draft.winners < 1 ||
      draft.winners > 100
    )
      next.winners = "Choose a whole number from 1 to 100.";
    if (
      !Number.isInteger(draft.reserves) ||
      draft.reserves < 0 ||
      draft.reserves > 100
    )
      next.reserves = "Choose a whole number from 0 to 100.";
    else if (draft.winners + draft.reserves > current.entries.length)
      next.reserves = `Winners and alternates total ${draft.winners + draft.reserves}, but the list has ${current.entries.length} entries.`;
    if (
      weighted &&
      current.weights?.some((w) => {
        return !Number.isInteger(w) || w < 1 || w > MAX_WEIGHT;
      })
    )
      next.entries =
        "Every entry needs a whole-number weight from 1 to 1,000. Check the entry,weight rows.";
    if (current.formatError) next.entries = current.formatError;
    const conflict = weightingConflict(
      draft.rules,
      weighted ? current.weights : undefined,
    );
    if (conflict) next.rules = conflict;
    setErrors(next);
    if (Object.keys(next).length) {
      setStep(0);
      requestAnimationFrame(() =>
        document
          .getElementById(
            Object.keys(next)[0] === "entries"
              ? "entries"
              : `giveaway-${Object.keys(next)[0]}`,
          )
          ?.focus(),
      );
      return null;
    }
    try {
      return normalize({
        ...draft,
        entries: current.entries,
        weights: weighted ? current.weights : undefined,
      });
    } catch (e) {
      setErrors({ entries: (e as Error).message });
      return null;
    }
  };
  const review = () => {
    const d = validate();
    if (d) {
      setDraft(d);
      setSaveError("");
      setStep(1);
      setSaveErrorCode("");
      requestAnimationFrame(() => heading.current?.focus());
    }
  };
  const save = () =>
    run(async () => {
      const d = validate();
      if (!d) return;
      if (config?.turnstileSiteKey && !turnstileToken) {
        setSaveError("Complete the verification before saving.");
        setSaveErrorCode("");
        return;
      }
      setSaveError("");
      setSaveErrorCode("");
      setPhase("Preparing your signature…");
      writeDraft(user?.address, id, localSnapshot());
      try {
        const result = await mutate(
          id ? "edit" : "create",
          id || crypto.randomUUID(),
          revision,
          d,
          setPhase,
          { turnstileToken: turnstileToken || undefined },
        );
        saved.current = true;
        removeDraft(user?.address, id);
        notify("Signed revision saved.");
        location.assign(`/g/${result.slug}`);
      } catch (e) {
        setSaveError((e as Error).message);
        setSaveErrorCode((e as Error & { code?: string }).code || "");
      } finally {
        setPhase("");
        setTurnstileToken(null);
        setVerificationReset((value) => value + 1);
      }
    });
  const field = (key: keyof Draft, value: string | number | boolean) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setSaveError("");
  };
  if (!id && dataOwner !== "guest" && dataOwner !== user?.address)
    return (
      <Empty title="Switching wallet…">
        <p>The previous wallet’s draft is not shown to another account.</p>
      </Empty>
    );
  if (loadError)
    return (
      <Empty title="Could not open the editor">
        <p role="alert">{loadError}</p>
        <a className="button secondary" href="/dashboard">
          Back to my giveaways
        </a>
      </Empty>
    );
  if (id && (!user || loadedOwner !== user.address))
    return (
      <Empty
        title={user ? "Loading your list…" : "Sign in to edit this giveaway"}
      >
        <p>Only the organizer can access the private list.</p>
        {!user && (
          <button className="button primary" onClick={onLogin}>
            Connect wallet
          </button>
        )}
      </Empty>
    );
  return (
    <div className="composer">
      <a href="/dashboard" className="back">
        <ArrowLeft size={16} />
        My giveaways
      </a>
      <div className="page-head">
        <div>
          <p className="eyebrow">MAKE CHANCE ACCOUNTABLE</p>
          <h1 ref={heading} tabIndex={-1}>
            {step === 1
              ? "One last look."
              : id
                ? "Edit your giveaway."
                : "Start with your people."}
          </h1>
          <p>
            {step === 1
              ? "This is what everyone will see when you save."
              : "A pasted list, a spreadsheet, a community. Set the rules, then share the proof."}
          </p>
        </div>
        <span className="subtle-label">
          {id ? `Revision ${revision + 1}` : "Not saved yet"}
        </span>
      </div>
      <ol className="steps">
        <li
          className={step === 0 ? "current" : ""}
          aria-current={step === 0 ? "step" : undefined}
        >
          <span>{step === 1 ? <Check size={16} /> : 1}</span>List and rules
        </li>
        <li
          className={step === 1 ? "current" : ""}
          aria-current={step === 1 ? "step" : undefined}
        >
          <span>2</span>Final review
        </li>
      </ol>
      {step === 0 ? (
        <div className="composer-layout">
          <section className="composer-list" aria-labelledby="entries-heading">
            <div className="section-head">
              <div>
                <h2 id="entries-heading">Who’s in?</h2>
                <p>
                  One entry per line. Names, emails, usernames, wallets or a
                  mix.
                </p>
              </div>
            </div>
            <div className="source-toolbar">
              <button
                className="text-button"
                ref={importTrigger}
                onClick={() => setImportOpen(!importOpen)}
                aria-expanded={importOpen}
                aria-controls="csv-import-panel"
              >
                <FileUp size={17} />
                Import CSV or spreadsheet
                <ChevronDown size={14} className="disclosure-chevron" />
              </button>
              <button
                className="text-button"
                disabled={!!text.trim()}
                onClick={() =>
                  replaceText(
                    weighted
                      ? formatWeightedEntries(sample, [1, 2, 3, 1, 4, 1])
                      : sample.join("\n"),
                    "Sample entries added.",
                  )
                }
              >
                Use sample list
              </button>
            </div>
            <Collapsible open={importOpen} id="csv-import-panel">
              <CsvImport
                key={`${dataOwner}:${id}`}
                currentCount={stats.entries.length}
                onCancel={() => {
                  setImportOpen(false);
                  importTrigger.current?.focus({ preventScroll: true });
                }}
                onApply={(entries, mode, importedWeights) => {
                  if (mode === "append" && stats.formatError) {
                    setErrors({
                      entries:
                        "Fix the weighted text before adding more entries. The current list has not changed.",
                    });
                    return;
                  }
                  const nextWeighted = weighted || !!importedWeights,
                    combined =
                      mode === "append"
                        ? [...stats.entries, ...entries]
                        : entries,
                    combinedWeights =
                      mode === "append"
                        ? [
                            ...weightValues,
                            ...(importedWeights ?? entries.map(() => 1)),
                          ]
                        : (importedWeights ?? entries.map(() => 1));
                  replaceText(
                    nextWeighted
                      ? formatWeightedEntries(combined, combinedWeights)
                      : combined.join("\n"),
                    `${entries.length} entries ${mode === "append" ? "added" : "imported"}.`,
                  );
                  const mapped = new Map<string, number>(
                    mode === "append"
                      ? stats.keys.map((key, i) => [key, weightValues[i]])
                      : [],
                  );
                  entries.forEach((entry, i) => {
                    const key = wallet(entry) ? entry.toLowerCase() : entry;
                    if (!mapped.has(key))
                      mapped.set(key, importedWeights?.[i] ?? 1);
                  });
                  setWeightMap(mapped);
                  setWeighted(nextWeighted);
                  setImportOpen(false);
                  requestAnimationFrame(() =>
                    textarea.current?.focus({ preventScroll: true }),
                  );
                }}
              />
            </Collapsible>
            <label className="sr-only" htmlFor="entries">
              Entry list
            </label>
            <Collapsible open={weighted} id="weighted-entry-guide">
              <div className="weighted-input-guide">
                <strong>Entry, weight</strong>
                <span>
                  One per line · <code>alex@example.com,3</code>
                </span>
                <p>
                  Weights are parsed as you type. Use 1–1,000; omitted weights
                  default to 1. Quote names containing commas:{" "}
                  <code>"Morgan, Alex",2</code>.
                </p>
              </div>
            </Collapsible>
            <textarea
              ref={textarea}
              id="entries"
              className="entries-input"
              value={text}
              spellCheck={false}
              aria-describedby="entry-help entry-issues"
              aria-invalid={!!errors.entries}
              placeholder={
                weighted
                  ? "Alex Morgan,1\nsam@example.com,3\n@riverstudio,2"
                  : "Alex Morgan\nsam@example.com\n@riverstudio\n0x…"
              }
              onChange={(e) => editText(e.target.value)}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData("text");
                if (pasted.includes("\t"))
                  setNotice(
                    "Pasting spreadsheet columns? Use Import CSV or spreadsheet to select one column.",
                  );
              }}
            />
            <div className="list-health" aria-busy={analyzing}>
              <strong>
                <Users size={17} />
                {stats.entries.length.toLocaleString("en-US")}{" "}
                {stats.entries.length === 1 ? "entry" : "entries"}
              </strong>
              <span>
                {stats.blanks
                  ? `${stats.blanks} blank ${stats.blanks === 1 ? "line" : "lines"} ignored`
                  : "Order is preserved"}
              </span>
              <span
                className={stats.duplicates.length ? "warning-text" : "muted"}
              >
                {stats.duplicates.length
                  ? `${stats.duplicates.length} repeated ${stats.duplicates.length === 1 ? "entry" : "entries"}`
                  : "No duplicates"}
              </span>
            </div>
            <div className="edit-notice" role="status">
              {notice}
              {undo && (
                <button
                  className="text-button"
                  onClick={() => {
                    setText(undo.text);
                    setWeightMap(undo.weights);
                    setWeighted(undo.weighted);
                    setUndo(null);
                    setNotice("Previous list restored.");
                  }}
                >
                  <RotateCcw size={14} />
                  Undo
                </button>
              )}
            </div>
            <div id="entry-issues" className="entry-issues">
              {stats.formatError && !errors.entries && (
                <p className="field-error" role="status">
                  {stats.formatError}
                </p>
              )}
              {errors.entries && (
                <p className="field-error" role="alert">
                  {errors.entries}
                </p>
              )}
              {!!stats.duplicates.length && (
                <details open>
                  <summary>
                    Review {stats.duplicates.length} repeated{" "}
                    {stats.duplicates.length === 1 ? "entry" : "entries"}
                  </summary>
                  <p>
                    Exact repeats cannot enter twice. Similar names stay
                    separate; add a distinguishing label if these are different
                    people.
                  </p>
                  <ul>
                    {stats.duplicates.slice(0, 8).map((d) => (
                      <li key={d.entry}>
                        <span>
                          Line {d.line} repeats line {d.firstLine}
                        </span>
                        <button
                          className="text-button"
                          onClick={() => jump(d.entry)}
                        >
                          Find in list
                        </button>
                      </li>
                    ))}
                  </ul>
                  {stats.duplicates.length > 8 && (
                    <p className="small">Showing the first 8 repeats.</p>
                  )}
                  <button
                    className="button secondary"
                    onClick={() => {
                      const repeat = new Set(
                        stats.duplicates.map((d) => d.entry),
                      );
                      replaceText(
                        weighted
                          ? formatWeightedEntries(
                              stats.entries.filter((_, i) => !repeat.has(i)),
                              weightValues.filter((_, i) => !repeat.has(i)),
                            )
                          : stats.entries
                              .filter((_, i) => !repeat.has(i))
                              .join("\n"),
                        `${repeat.size} repeated entries removed. First occurrences kept in order.`,
                      );
                    }}
                  >
                    Remove {stats.duplicates.length} repeated{" "}
                    {stats.duplicates.length === 1 ? "entry" : "entries"}
                  </button>
                </details>
              )}
              {!!stats.addressLike.length && (
                <p className="small warning-text">
                  {stats.addressLike.length}{" "}
                  {stats.addressLike.length === 1
                    ? "row contains"
                    : "rows contain"}{" "}
                  an address with extra text or an invalid address. These stay
                  masked.{" "}
                  <button
                    className="text-button"
                    onClick={() => jump(stats.addressLike[0])}
                  >
                    Review the first
                  </button>
                </p>
              )}
            </div>
            <p id="entry-help" className="small muted">
              2–10,000 entries · up to 256 UTF-8 bytes each. One entry is not
              proof of one person. Each entry can be selected only once.
            </p>
            <PublicAppearance
              entries={stats.entries}
              weights={weighted ? weightValues : undefined}
            />
          </section>
          <section
            className="composer-settings"
            aria-labelledby="details-heading"
          >
            <h2 id="details-heading">Set the details</h2>
            <p className="section-intro">
              Your title, description and rules will be public.
            </p>
            <label htmlFor="giveaway-title">Giveaway title</label>
            <input
              id="giveaway-title"
              value={draft.title}
              maxLength={120}
              placeholder="e.g. Community thank-you"
              aria-invalid={!!errors.title}
              aria-describedby="title-error"
              onChange={(e) => field("title", e.target.value)}
            />
            <p id="title-error" className="field-error">
              {errors.title}
            </p>
            <div className="count-fields">
              <div>
                <label htmlFor="giveaway-winners">Winners</label>
                <input
                  id="giveaway-winners"
                  type="number"
                  min="1"
                  max="100"
                  value={Number.isNaN(draft.winners) ? "" : draft.winners}
                  aria-invalid={!!errors.winners}
                  onChange={(e) =>
                    field(
                      "winners",
                      e.target.value === "" ? NaN : Number(e.target.value),
                    )
                  }
                />
                <p className="field-error">{errors.winners}</p>
              </div>
              <div>
                <label htmlFor="giveaway-reserves">Alternates</label>
                <input
                  id="giveaway-reserves"
                  type="number"
                  min="0"
                  max="100"
                  value={Number.isNaN(draft.reserves) ? "" : draft.reserves}
                  aria-invalid={!!errors.reserves}
                  onChange={(e) =>
                    field(
                      "reserves",
                      e.target.value === "" ? NaN : Number(e.target.value),
                    )
                  }
                />
              </div>
            </div>
            <p className="field-error">{errors.reserves}</p>
            <p className="field-help">
              Choose one winner or several. Alternates are selected in order
              after the winners. Set alternates to 0 if you don’t need them.
            </p>
            <div className="weighted-setting">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={weighted}
                  aria-controls="weighted-entry-guide"
                  aria-expanded={weighted}
                  onChange={(e) => toggleWeighted(e.target.checked)}
                />
                Weighted selection
              </label>
              <p>
                {weighted
                  ? "Paste entry,weight rows in the editor, or select a weight column when importing CSV. A selected entry is removed with its full weight."
                  : "Off by default: every entry has an equal chance. Enable to assign public, relative weights."}
              </p>
            </div>
            <label htmlFor="giveaway-description">
              Description <span className="muted">(optional)</span>
            </label>
            <textarea
              id="giveaway-description"
              rows={2}
              maxLength={4000}
              value={draft.description}
              onChange={(e) => field("description", e.target.value)}
              placeholder="What is this giveaway for?"
            />
            <label htmlFor="giveaway-rules">Entry and prize rules</label>
            <textarea
              id="giveaway-rules"
              rows={5}
              maxLength={4000}
              value={draft.rules}
              onChange={(e) => field("rules", e.target.value)}
              aria-invalid={!!errors.rules}
              aria-describedby="rules-help rules-error"
              placeholder="Who is included? What can they win? Who delivers the prize?"
            />
            <p id="rules-error" className="field-error">
              {errors.rules}
            </p>
            <p id="rules-help" className="field-help">
              You organize the giveaway and deliver any prizes. Lottewy only
              selects entries.
            </p>
            <div className="composer-next">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={!!draft.listed}
                  onChange={(e) => field("listed", e.target.checked)}
                  aria-describedby="listing-help"
                />
                Show in Explorer
              </label>
              <p id="listing-help" className="field-help">
                {draft.listed
                  ? "Anyone can discover this giveaway in Explorer."
                  : "Unlisted: only people with the share link can find this giveaway. The link is public, not password-protected."}
              </p>
              <button
                className="button lime full"
                onClick={review}
                disabled={busy}
              >
                Review your giveaway <ArrowRight size={18} />
              </button>
              <p>Nothing is published until you sign and save.</p>
            </div>
          </section>
        </div>
      ) : (
        <div className="composer-layout review-layout">
          <section className="review-public">
            <p className="eyebrow">PUBLIC PREVIEW</p>
            <p className="field-help">
              {draft.listed
                ? "Listed in Explorer"
                : "Unlisted · accessible by share link"}
            </p>
            <h2>{draft.title}</h2>
            {draft.description && (
              <p className="preserve">{draft.description}</p>
            )}
            <div className="review-counts">
              <span>
                <strong>{stats.entries.length.toLocaleString("en-US")}</strong>{" "}
                entries
              </span>
              <span>
                <strong>{draft.winners}</strong>{" "}
                {draft.winners === 1 ? "winner" : "winners"}
              </span>
              <span>
                <strong>{draft.reserves}</strong>{" "}
                {draft.reserves === 1 ? "alternate" : "alternates"}
              </span>
            </div>
            <PublicAppearance
              entries={stats.entries}
              weights={weighted ? weightValues : undefined}
              title="Entry preview"
            />
            <h3>Rules</h3>
            <p className="preserve">{draft.rules}</p>
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setStep(0);
                requestAnimationFrame(() => heading.current?.focus());
              }}
            >
              <ArrowLeft size={16} />
              Back to editing
            </button>
          </section>
          <section className="review-save">
            <h2>Ready to make it public?</h2>
            <p>
              Saving publishes your giveaway. It requires a wallet signature and
              content review.
            </p>
            <div className="save-facts">
              <p>
                <Globe2 size={18} />
                {draft.listed
                  ? "Listed in the public explorer, with a permanent link."
                  : "Unlisted, with a permanent share link. Anyone with the link can view it."}
              </p>
              <p>
                <LockKeyhole size={18} />
                The raw entry list is available only to you. Valid wallet
                addresses remain public.
              </p>
              <p>
                <Check size={18} />
                Saving does not start the draw. You can edit until the
                randomness request is submitted.
              </p>
            </div>
            <div className="cost-lines">
              <div>
                <span>Lottewy fee</span>
                <strong>0</strong>
              </div>
              <div>
                <span>D20DAO fee + network gas</span>
                <span>Shown before starting</span>
              </div>
            </div>
            <p className="save-balance-note">
              Your wallet needs native USDC on Arc Testnet to save. Saving
              checks your balance and does not spend it.
            </p>
            {config && config.jevEnabled !== false && !config.jevConfigured && (
              <p className="field-error">
                Saving is temporarily unavailable. Your list remains here.
              </p>
            )}
            {user &&
              config?.turnstileSiteKey &&
              saveErrorCode !== "CONTENT_REVIEW_REJECTED" && (
                <TurnstileWidget
                  key={`${user.address}:${id || "new"}`}
                  siteKey={config.turnstileSiteKey}
                  resetKey={verificationReset}
                  onToken={setTurnstileToken}
                />
              )}
            {!user ? (
              <button
                className="button lime full"
                disabled={
                  busy ||
                  (!!config &&
                    config.jevEnabled !== false &&
                    !config.jevConfigured)
                }
                onClick={onLogin}
              >
                Connect wallet to save <ArrowRight size={18} />
              </button>
            ) : saveErrorCode === "CONTENT_REVIEW_REJECTED" ? (
              <button
                className="button lime full"
                disabled={busy}
                onClick={() => {
                  setStep(0);
                  requestAnimationFrame(() => heading.current?.focus());
                }}
              >
                Edit giveaway <ArrowLeft size={18} />
              </button>
            ) : (
              <button
                className="button lime full"
                disabled={
                  busy ||
                  !(config?.jevEnabled === false || config?.jevConfigured) ||
                  (!!config.turnstileSiteKey && !turnstileToken)
                }
                onClick={save}
              >
                {phase || "Sign and save"}
                {!phase && <ArrowRight size={18} />}
              </button>
            )}
            <p className="save-progress" role="status">
              {phase
                ? phase
                : !user
                  ? "You can sign in now without losing your draft."
                  : saveErrorCode === "CONTENT_REVIEW_REJECTED"
                    ? "Update the flagged wording, then review and save again."
                    : "This signature is not a payment or token approval."}
            </p>
            {saveError && (
              <p className="field-error save-error" role="alert">
                {saveError}
              </p>
            )}
            {saveError && saveErrorCode === "ARC_USDC_REQUIRED" && (
              <section
                className="save-funding-help"
                aria-labelledby="funding-heading"
              >
                <h3 id="funding-heading">Fund the connected wallet</h3>
                <p>
                  Choose USDC and Arc Testnet in Circle’s faucet, then enter
                  your connected wallet address. Once the funds arrive,
                  {config?.turnstileSiteKey ? " verify again and" : ""} select
                  Sign and save. Your entries and review stay here.
                </p>
                <div className="actions">
                  <a
                    className="text-button"
                    href="https://faucet.circle.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Get testnet USDC <ExternalLink size={14} />
                  </a>
                  <a
                    className="text-button"
                    href="https://docs.arc.io/arc/references/connect-to-arc"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Arc Testnet setup <ExternalLink size={14} />
                  </a>
                </div>
              </section>
            )}
          </section>
        </div>
      )}
      <div className="offchain-footnote">
        <ShieldCheck size={19} />
        <p>
          The list stays offchain. Starting the draw binds its commitment and
          rules onchain. Every saved giveaway is public; names and emails are
          masked, while valid wallet addresses are shown in full.
        </p>
      </div>
    </div>
  );
}

function CsvImport({
  currentCount,
  onCancel,
  onApply,
}: {
  currentCount: number;
  onCancel: () => void;
  onApply: (
    entries: string[],
    mode: "append" | "replace",
    weights?: number[],
  ) => void;
}) {
  const [source, setSource] = useState(""),
    [name, setName] = useState(""),
    [sheet, setSheet] = useState<CsvSheet | null>(null),
    [column, setColumn] = useState(-1),
    [weightColumn, setWeightColumn] = useState(-1),
    [header, setHeader] = useState(false),
    [mode, setMode] = useState<"append" | "replace">("append"),
    [error, setError] = useState(""),
    [reading, setReading] = useState(false),
    [pasted, setPasted] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const read = (content: string, label: string, delimiter?: Delimiter) => {
    try {
      const next = readCsv(content, delimiter);
      setSource(content);
      setName(label);
      setSheet(next);
      setHeader(likelyHeader(next));
      setColumn(next.width === 1 ? 0 : -1);
      setWeightColumn(-1);
      setMode("append");
      setError("");
    } catch (e) {
      setSheet(null);
      setColumn(-1);
      setError((e as Error).message);
    }
  };
  const file = async (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    setSheet(null);
    setColumn(-1);
    if (chosen.size > IMPORT_LIMIT) {
      setError("Choose a CSV file smaller than 4 MiB.");
      return;
    }
    setReading(true);
    try {
      read(await chosen.text(), chosen.name);
    } catch {
      setError("This file could not be read. Try exporting it as a UTF-8 CSV.");
    } finally {
      setReading(false);
      e.target.value = "";
    }
  };
  const selected = useMemo(
    () => (sheet && column >= 0 ? extractColumn(sheet, column, header) : null),
    [sheet, column, header],
  );
  const resulting = selected
    ? selected.entries.length + (mode === "append" ? currentCount : 0)
    : 0;
  const importedWeights = useMemo(
    () =>
      sheet && selected && weightColumn >= 0
        ? extractWeights(sheet, selected.sourceRows, weightColumn)
        : null,
    [sheet, selected, weightColumn],
  );
  const valid =
    selected &&
    selected.entries.length > 0 &&
    !selected.multiline.length &&
    !selected.tooLong.length &&
    resulting <= 10000 &&
    (!importedWeights || !importedWeights.invalidRows.length) &&
    weightColumn !== column;
  return (
    <section className="csv-helper" aria-labelledby="csv-heading">
      <div className="section-head">
        <div>
          <h3 id="csv-heading">Choose the entries to import</h3>
          <p>
            The file is read in your browser. Only selected entries are
            submitted when you save.
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Close import"
          onClick={onCancel}
        >
          <X size={18} />
        </button>
      </div>
      <div className="file-control">
        <button
          className="button secondary"
          disabled={reading}
          onClick={() => fileInput.current?.click()}
        >
          <FileUp size={16} />
          Choose CSV or TSV file
        </button>
        <input
          ref={fileInput}
          hidden
          aria-label="CSV or TSV file"
          type="file"
          accept=".csv,.tsv,text/csv,text/tab-separated-values"
          onChange={file}
        />
      </div>
      <details className="paste-sheet">
        <summary>Or paste cells from a spreadsheet</summary>
        <label className="sr-only" htmlFor="spreadsheet-paste">
          Spreadsheet cells
        </label>
        <textarea
          id="spreadsheet-paste"
          rows={4}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder={"Name\tEmail\nAlex\talex@example.com"}
        />
        <button
          className="button secondary"
          disabled={!pasted.trim()}
          onClick={() => read(pasted, "Pasted spreadsheet")}
        >
          Read pasted cells
        </button>
      </details>
      {reading && <p role="status">Reading locally…</p>}
      {error && (
        <p className="field-error" role="alert">
          {error} Your existing list has not changed.
        </p>
      )}
      <Collapsible open={!!sheet}>
        {sheet && (
          <>
            <p className="csv-source">
              {name} · {sheet.rows.length.toLocaleString("en-US")} rows ·{" "}
              {sheet.width} {sheet.width === 1 ? "column" : "columns"}
            </p>
            <div className="csv-options">
              <label>
                Separator
                <select
                  aria-label="Separator"
                  value={sheet.delimiter}
                  onChange={(e) =>
                    read(source, name, e.target.value as Delimiter)
                  }
                >
                  <option value=",">Comma</option>
                  <option value=";">Semicolon</option>
                  <option value={"\t"}>Tab</option>
                </select>
              </label>
              <label>
                Entry column
                <select
                  aria-label="Entry column"
                  value={column}
                  onChange={(e) => setColumn(Number(e.target.value))}
                >
                  <option value={-1}>Choose a column…</option>
                  {Array.from({ length: sheet.width }, (_, i) => (
                    <option key={i} value={i}>
                      {header
                        ? sheet.rows[0][i] || `Column ${i + 1}`
                        : `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={header}
                onChange={(e) => setHeader(e.target.checked)}
              />
              First row contains headers
            </label>
            <label className="csv-weight-column">
              Weight column <span className="muted">(optional)</span>
              <select
                aria-label="Weight column"
                value={weightColumn}
                onChange={(e) => setWeightColumn(Number(e.target.value))}
              >
                <option value={-1}>No weights — equal chances</option>
                {Array.from({ length: sheet.width }, (_, i) => (
                  <option key={i} value={i} disabled={i === column}>
                    {header
                      ? sheet.rows[0][i] || `Column ${i + 1}`
                      : `Column ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <>
                {importedWeights && (
                  <p className="small">
                    Weighted selection will be enabled. Whole-number weights
                    must be 1–1,000; blank weights use 1. Weights are public.
                  </p>
                )}
                {!!importedWeights?.invalidRows.length && (
                  <p className="field-error">
                    Invalid weights in CSV rows{" "}
                    {importedWeights.invalidRows.slice(0, 8).join(", ")}. Use
                    whole numbers from 1 to 1,000.
                  </p>
                )}
                <ol className="csv-values">
                  {selected.entries.slice(0, 5).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
                <p className="small">
                  {selected.entries.length} selected entries · {selected.blanks}{" "}
                  blank cells ignored. Other columns will not be imported.
                </p>
                {!!selected.multiline.length && (
                  <p className="field-error">
                    CSV rows {selected.multiline.slice(0, 8).join(", ")} contain
                    line breaks in the selected cell. Choose another column or
                    correct the file; one cell must represent one entry.
                  </p>
                )}
                {!!selected.tooLong.length && (
                  <p className="field-error">
                    CSV rows {selected.tooLong.slice(0, 8).join(", ")} exceed
                    256 bytes per entry.
                  </p>
                )}
                {resulting > 10000 && (
                  <p className="field-error">
                    This would create {resulting.toLocaleString("en-US")}{" "}
                    entries. The limit is 10,000.
                  </p>
                )}
              </>
            )}
            {currentCount > 0 && (
              <fieldset className="import-mode">
                <legend>Apply to your current list</legend>
                <label>
                  <input
                    type="radio"
                    name="import-mode"
                    value="append"
                    checked={mode === "append"}
                    onChange={() => setMode("append")}
                  />
                  Add to {currentCount} existing entries
                </label>
                <label>
                  <input
                    type="radio"
                    name="import-mode"
                    value="replace"
                    checked={mode === "replace"}
                    onChange={() => setMode("replace")}
                  />
                  Replace the current list
                </label>
              </fieldset>
            )}
            <div className="actions">
              <button
                className="button lime"
                disabled={!valid}
                onClick={() => {
                  if (valid)
                    onApply(selected!.entries, mode, importedWeights?.weights);
                }}
              >
                {mode === "replace" && currentCount ? "Replace with" : "Add"}{" "}
                {selected?.entries.length || 0} entries <ArrowRight size={16} />
              </button>
              <button className="text-button" onClick={onCancel}>
                Cancel import
              </button>
            </div>
          </>
        )}
      </Collapsible>
    </section>
  );
}
