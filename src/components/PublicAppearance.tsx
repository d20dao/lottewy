import { memo, useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Globe2 } from "lucide-react";
import { mask, MAX_WEIGHT } from "../../shared/core";
import { Collapsible } from "./primitives";
type Props = {
  entries: string[];
  weights?: number[];
  onWeight?: (index: number, value: number) => void;
  title?: string;
};
export default memo(function PublicAppearance({
  entries,
  weights,
  onWeight,
  title = "Public appearance",
}: Props) {
  const [page, setPage] = useState(0),
    [size, setSize] = useState(10),
    [expanded, setExpanded] = useState(true);
  const contentId = useId();
  const pages = Math.max(1, Math.ceil(entries.length / size));
  useEffect(() => {
    setPage((p) => Math.min(p, pages - 1));
  }, [pages]);
  const visiblePage = Math.min(page, pages - 1),
    start = visiblePage * size;
  const labels = useMemo(
    () =>
      entries.slice(start, start + size).map((raw, i) => ({
        index: start + i,
        label: mask(raw, start + i + 1),
      })),
    [entries, start, size],
  );
  const total = useMemo(() => weights?.reduce((a, b) => a + b, 0), [weights]);
  const chance = (value: number) =>
    !Number.isFinite(total) || !value
      ? "Not available"
      : (value / total!) * 100 < 0.001
        ? "<0.001%"
        : `${((value / total!) * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  return (
    <section className="public-appearance" aria-label={title}>
      <div className="section-head">
        <h3>
          <button
            className="preview-disclosure"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            <Globe2 size={16} />
            {title}
            <ChevronDown size={15} className="disclosure-chevron" />
          </button>
        </h3>
        <span>{entries.length.toLocaleString("en-US")} entries</span>
      </div>
      <Collapsible open={expanded} id={contentId}>
        <p>
          Valid wallet addresses appear in full. Other entries are masked.
          {weights && " Weights are public and lock with the list."}
        </p>
        {weights && onWeight && (
          <p className="weight-help">
            Set whole-number weights from 1 to 1,000. Entries start at 1;
            editing an entry’s text resets its weight to 1. First-pick chances
            change after each selection.
          </p>
        )}
        {labels.length ? (
          <>
            <div className={`appearance-head ${weights ? "weighted" : ""}`}>
              <span>Entry</span>
              <span>Public label</span>
              {weights && (
                <>
                  <span>Weight</span>
                  <span>First pick</span>
                </>
              )}
            </div>
            <ol className="appearance-rows">
              {labels.map(({ index, label }) => (
                <li key={index} className={weights ? "weighted" : ""}>
                  <span className="entry-number">
                    #{String(index + 1).padStart(4, "0")}
                  </span>
                  <span className="public-label">{label}</span>
                  {weights && (
                    <>
                      {onWeight ? (
                        <input
                          type="number"
                          min={1}
                          max={MAX_WEIGHT}
                          step={1}
                          aria-label={`Weight for entry ${index + 1}`}
                          value={
                            Number.isFinite(weights[index])
                              ? weights[index]
                              : ""
                          }
                          aria-invalid={
                            !Number.isInteger(weights[index]) ||
                            weights[index] < 1 ||
                            weights[index] > MAX_WEIGHT
                          }
                          onChange={(e) =>
                            onWeight(
                              index,
                              e.target.value === ""
                                ? NaN
                                : Number(e.target.value),
                            )
                          }
                        />
                      ) : (
                        <span className="weight-value">×{weights[index]}</span>
                      )}
                      <span className="first-chance">
                        {chance(weights[index])}
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
            <div className="appearance-pagination">
              <span aria-live="polite">
                {start + 1}–{Math.min(start + size, entries.length)} of{" "}
                {entries.length.toLocaleString("en-US")}
              </span>
              <label>
                Rows{" "}
                <select
                  aria-label={`${title} rows per page`}
                  value={size}
                  onChange={(e) => {
                    setSize(Number(e.target.value));
                    setPage(0);
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <div>
                <button
                  className="icon-button"
                  aria-label={`${title} previous page`}
                  disabled={visiblePage === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <span>
                  {visiblePage + 1} / {pages}
                </span>
                <button
                  className="icon-button"
                  aria-label={`${title} next page`}
                  disabled={visiblePage === pages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="preview-placeholder">
            Add entries to preview their public labels.
          </div>
        )}
      </Collapsible>
    </section>
  );
});
