import { ChevronLeft, ChevronRight } from "lucide-react";
export default function Pagination({
  page,
  total,
  size,
  onPage,
  onSize,
  busy = false,
  kind = "giveaway",
}: {
  page: number;
  total: number;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
  busy?: boolean;
  kind?: "giveaway" | "entry";
}) {
  const plural = kind === "entry" ? "entries" : "giveaways",
    capital = kind === "entry" ? "Entry" : "Giveaway";
  const pages = Math.max(1, Math.ceil(total / size)),
    numbers = [
      ...new Set([
        0,
        Math.max(0, page - 1),
        page,
        Math.min(pages - 1, page + 1),
        pages - 1,
      ]),
    ].sort((a, b) => a - b);
  return (
    <nav
      className="explorer-pagination"
      aria-label={capital + " pages"}
      aria-busy={busy}
    >
      <span className="pagination-summary" aria-live="polite">
        {total
          ? `${page * size + 1}–${Math.min((page + 1) * size, total)}`
          : "0"}{" "}
        of {total.toLocaleString("en-US")} {total === 1 ? kind : plural}
      </span>
      <label>
        Per page
        <select
          aria-label={
            (kind === "entry" ? "Entries" : "Giveaways") + " per page"
          }
          disabled={busy}
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          <option value={10}>10</option>
          <option value={20}>20</option>
          <option value={50}>50</option>
        </select>
      </label>
      <div className="pagination-pages">
        <button
          className="icon-button"
          aria-label={"Previous " + kind + " page"}
          disabled={busy || page === 0}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        {numbers.map((n, i) => (
          <span key={n}>
            {i > 0 && n - numbers[i - 1] > 1 && (
              <span className="page-ellipsis">…</span>
            )}
            <button
              className={`page-number ${page === n ? "current" : ""}`}
              aria-label={`Go to page ${n + 1}`}
              aria-current={page === n ? "page" : undefined}
              disabled={busy}
              onClick={() => onPage(n)}
            >
              {n + 1}
            </button>
          </span>
        ))}
        <button
          className="icon-button"
          aria-label={"Next " + kind + " page"}
          disabled={busy || page >= pages - 1}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </nav>
  );
}
