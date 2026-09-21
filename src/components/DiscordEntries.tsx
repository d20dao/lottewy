import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Dialog } from "./primitives";
import Pagination from "./Pagination";
type Entry = { userId: string; displayName: string; joinedAt: number };
type Result = { entries: Entry[]; total: number; status: string };
export default function DiscordEntries({
  id,
  count,
  address,
}: {
  id: string;
  count: number;
  address: string;
}) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(0),
    [size, setSize] = useState(20),
    [data, setData] = useState<Result | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setOpen(false);
    setData(null);
    setError("");
  }, [address, id]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setBusy(true);
    setError("");
    setData(null);
    api<Result>(`/discord/campaigns/${id}/entries?page=${page}&size=${size}`)
      .then((result) => {
        if (!live) return;
        const last = Math.max(0, Math.ceil(result.total / size) - 1);
        if (page > last) {
          setPage(last);
          return;
        }
        setData(result);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [open, page, size, refresh, address, id]);
  return (
    <>
      <button
        type="button"
        className="text-button discord-entry-count"
        aria-label={`View ${count} Discord entries`}
        onClick={() => {
          setPage(0);
          setOpen(true);
        }}
      >
        {count.toLocaleString("en-US")} entries
      </button>
      {createPortal(
        <Dialog
          open={open}
          close={() => {
            setOpen(false);
            setData(null);
          }}
          title="Discord participants"
          wide
        >
          <p className="muted">
            Private to the organizer. Display names are captured when members
            join.
          </p>
          <div className="actions wrap">
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setRefresh((n) => n + 1)}
            >
              Refresh entries
            </button>
          </div>
          <div className="discord-entry-list" aria-busy={busy}>
            {busy ? (
              <p role="status">Loading participants…</p>
            ) : error ? (
              <p role="alert">{error}</p>
            ) : data?.entries.length ? (
              <ul>
                {data.entries.map((entry) => (
                  <li key={entry.userId}>
                    <div>
                      <strong>{entry.displayName}</strong>
                      <span>Discord ID: {entry.userId}</span>
                    </div>
                    <time
                      dateTime={new Date(entry.joinedAt * 1000).toISOString()}
                    >
                      {new Date(entry.joinedAt * 1000).toLocaleString("en", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </time>
                  </li>
                ))}
              </ul>
            ) : data ? (
              <p>No participants have joined yet.</p>
            ) : null}
          </div>
          <Pagination
            kind="entry"
            page={page}
            size={size}
            total={data?.total ?? count}
            busy={busy}
            onPage={setPage}
            onSize={(value) => {
              setSize(value);
              setPage(0);
            }}
          />
        </Dialog>,
        document.body,
      )}
    </>
  );
}
