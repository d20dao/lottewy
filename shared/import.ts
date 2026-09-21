import { lines, wallet } from "./core";
export type Delimiter = "," | ";" | "\t";
export type CsvSheet = {
  rows: string[][];
  delimiter: Delimiter;
  width: number;
};
export const IMPORT_LIMIT = 4 * 1024 * 1024;
/** A local, bounded CSV parser. Files are never sent to the Worker. */
export function parseDelimited(source: string, delimiter: Delimiter): CsvSheet {
  if (new TextEncoder().encode(source).length > IMPORT_LIMIT)
    throw new Error("Choose a file smaller than 4 MiB.");
  const input = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > 100)
      throw new Error(
        "This file has more than 100 columns. Export only the columns you need.",
      );
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > 20001)
      throw new Error(
        "This file has too many rows. Import at most 10,000 entries.",
      );
  };
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
      continue;
    }
    if (char === '"') {
      if (cell !== "" || closed)
        throw new Error(
          `Unexpected quote in CSV row ${rows.length + 1}. Export a valid CSV and try again.`,
        );
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      pushCell();
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      pushRow();
      continue;
    }
    if (closed) {
      if (char === " " || char === "\t") continue;
      throw new Error(
        `Unexpected text after a quote in CSV row ${rows.length + 1}.`,
      );
    }
    cell += char;
  }
  if (quoted)
    throw new Error(
      "An opening quote has no closing quote. Check the CSV export.",
    );
  if (cell !== "" || row.length || closed) pushRow();
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (!rows.some((r) => r.some((s) => s.trim())))
    throw new Error(
      "This file is empty. Choose a CSV with at least two entries.",
    );
  return { rows, delimiter, width };
}
export function readCsv(source: string, delimiter?: Delimiter): CsvSheet {
  if (delimiter) return parseDelimited(source, delimiter);
  const results: CsvSheet[] = [];
  for (const d of [",", ";", "\t"] as const) {
    try {
      results.push(parseDelimited(source, d));
    } catch {}
  }
  if (!results.length) return parseDelimited(source, ",");
  const score = (s: CsvSheet) => {
    const rows = s.rows.filter((r) => r.some((c) => c.trim())).slice(0, 40);
    const counts = new Map<number, number>();
    for (const r of rows) counts.set(r.length, (counts.get(r.length) || 0) + 1);
    let best = 0;
    for (const [width, n] of counts)
      if (width > 1)
        best = Math.max(best, (n / rows.length) * 100 + Math.min(width, 20));
    return best;
  };
  return results.sort((a, b) => score(b) - score(a))[0];
}
export function likelyHeader(sheet: CsvSheet) {
  return (
    sheet.rows[0]?.some((s) =>
      /^(name|full[ _-]?name|email|e-mail|wallet|wallet[ _-]?address|address|username|user[ _-]?name|handle|participant|entry|label|id)$/i.test(
        s.trim(),
      ),
    ) || false
  );
}
export function extractColumn(
  sheet: CsvSheet,
  column: number,
  header: boolean,
) {
  if (!Number.isInteger(column) || column < 0 || column >= sheet.width)
    throw new Error("Choose the column to use as entries.");
  const sourceRows: number[] = [];
  const entries: string[] = [],
    multiline: number[] = [],
    tooLong: number[] = [];
  let blanks = 0;
  for (let i = header ? 1 : 0; i < sheet.rows.length; i++) {
    const value = (sheet.rows[i][column] || "").normalize("NFC").trim();
    if (!value) {
      blanks++;
      continue;
    }
    if (/[\r\n]/.test(value)) multiline.push(i + 1);
    if (new TextEncoder().encode(value).length > 256) tooLong.push(i + 1);
    entries.push(value);
    sourceRows.push(i + 1);
  }
  return { entries, blanks, multiline, tooLong, sourceRows };
}
export function analyzeEntries(text: string) {
  const stats = lines(text),
    original = text.replace(/\r\n?/g, "\n").split("\n");
  const sourceRows: number[] = [],
    offsets: { start: number; end: number }[] = [];
  let offset = 0;
  original.forEach((raw, i) => {
    if (raw.normalize("NFC").trim()) {
      sourceRows.push(i + 1);
      offsets.push({ start: offset, end: offset + raw.length });
    }
    offset += raw.length + 1;
  });
  const first = new Map<string, number>(),
    duplicates: {
      entry: number;
      first: number;
      line: number;
      firstLine: number;
    }[] = [],
    long: number[] = [],
    addressLike: number[] = [];
  let publicWallets = 0;
  const keys: string[] = [];
  stats.entries.forEach((entry, i) => {
    const isWallet = wallet(entry),
      key = isWallet ? entry.toLowerCase() : entry;
    keys.push(key);
    if (first.has(key)) {
      const f = first.get(key)!;
      duplicates.push({
        entry: i,
        first: f,
        line: sourceRows[i],
        firstLine: sourceRows[f],
      });
    } else first.set(key, i);
    if (new TextEncoder().encode(entry).length > 256) long.push(i);
    if (isWallet) publicWallets++;
    else if (/0x[\da-fA-F]{6}/.test(entry)) addressLike.push(i);
  });
  return {
    ...stats,
    keys,
    blanks: text.length ? stats.blanks : 0,
    duplicates,
    offsets,
    sourceRows,
    long,
    addressLike,
    publicWallets,
    masked: stats.entries.length - publicWallets,
  };
}
export function extractWeights(
  sheet: CsvSheet,
  sourceRows: number[],
  column: number,
) {
  const invalidRows: number[] = [],
    weights = sourceRows.map((row) => {
      const raw = (sheet.rows[row - 1]?.[column] || "").trim();
      if (!raw) return 1;
      const value = Number(raw);
      if (!/^[1-9]\d*$/.test(raw) || !Number.isInteger(value) || value > 1000) {
        invalidRows.push(row);
        return NaN;
      }
      return value;
    });
  return { weights, invalidRows };
}
export function formatWeightedEntries(entries: string[], weights: number[]) {
  return entries
    .map(
      (entry, i) =>
        `${/[",\r\n]/.test(entry) ? '"' + entry.replaceAll('"', '""') + '"' : entry},${weights[i] ?? 1}`,
    )
    .join("\n");
}
export function analyzeEditor(text: string, weighted: boolean) {
  if (!weighted)
    return {
      ...analyzeEntries(text),
      weights: undefined as number[] | undefined,
      formatError: "",
    };
  if (!text.trim())
    return { ...analyzeEntries(""), weights: [] as number[], formatError: "" };
  try {
    const sheet = parseDelimited(text, ","),
      header =
        sheet.rows[0]?.length === 2 &&
        /^(entry|name|wallet|address|email|username|label)$/i.test(
          sheet.rows[0][0].trim(),
        ) &&
        /^weight$/i.test(sheet.rows[0][1].trim());
    const values = extractColumn(sheet, 0, header),
      parsedWeights = extractWeights(sheet, values.sourceRows, 1),
      badColumns = sheet.rows.flatMap((row, i) =>
        i < (header ? 1 : 0) || row.every((c) => !c.trim())
          ? []
          : row.length > 2
            ? [i + 1]
            : [],
      );
    let formatError = badColumns.length
      ? `Rows ${badColumns.slice(0, 8).join(", ")} have extra columns. Use entry,weight; quote entries containing commas.`
      : values.multiline.length
        ? `Rows ${values.multiline.slice(0, 8).join(", ")} contain line breaks inside an entry.`
        : parsedWeights.invalidRows.length
          ? `Invalid weights on rows ${parsedWeights.invalidRows.slice(0, 8).join(", ")}. Use whole numbers from 1 to 1,000.`
          : "";
    const analysis = analyzeEntries(values.entries.join("\n")),
      rawRows = text.replace(/\r\n?/g, "\n").split("\n");
    let offset = 0;
    const positions = rawRows.map((raw) => {
      const p = { start: offset, end: offset + raw.length };
      offset += raw.length + 1;
      return p;
    });
    return {
      ...analysis,
      blanks: values.blanks,
      sourceRows: values.sourceRows,
      offsets: values.sourceRows.map(
        (row) => positions[row - 1] || { start: 0, end: 0 },
      ),
      duplicates: analysis.duplicates.map((d) => ({
        ...d,
        line: values.sourceRows[d.entry],
        firstLine: values.sourceRows[d.first],
      })),
      weights: parsedWeights.weights,
      formatError,
    };
  } catch (e) {
    return {
      ...analyzeEntries(""),
      weights: [] as number[],
      formatError: (e as Error).message,
    };
  }
}
