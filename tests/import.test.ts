import { describe, it, expect } from "vitest";
import {
  readCsv,
  extractColumn,
  likelyHeader,
  analyzeEntries,
} from "../shared/import";
describe("local-only CSV import", () => {
  it("parses BOM, quoted commas, escaped quotes, CRLF and trailing empty cells", () => {
    const s = readCsv(
      '\uFEFFName,Email,Note\r\n"Smith, Ada",ada@example.com,"A ""quote"""\r\nBen,ben@example.com,\r\n',
    );
    expect(s.width).toBe(3);
    expect(s.rows[1]).toEqual(["Smith, Ada", "ada@example.com", 'A "quote"']);
    expect(extractColumn(s, 1, true).entries).toEqual([
      "ada@example.com",
      "ben@example.com",
    ]);
    expect(likelyHeader(s)).toBe(true);
  });
  it("detects tab and semicolon sheets without silently guessing a column", () => {
    expect(readCsv("Name\tEmail\nAda\tada@example.com").delimiter).toBe("\t");
    expect(readCsv("Name;Email\nAda;ada@example.com").delimiter).toBe(";");
    expect(() =>
      extractColumn(readCsv("Name,Email\nAda,ada@example.com"), -1, true),
    ).toThrow("Choose");
  });
  it("reports selected multiline cells rather than splitting them into entries", () => {
    const s = readCsv(
      'Name,Email\n"Ada\nSmith",ada@example.com\nBen,ben@example.com',
    );
    expect(extractColumn(s, 0, true).multiline).toEqual([2]);
    expect(extractColumn(s, 1, true).multiline).toEqual([]);
  });
  it("counts blank selected cells and treats formulas as inert text", () => {
    const s = readCsv(
      "Name,Email\nAda,\nBen,ben@example.com\n=SUM(A1),formula@example.com",
    );
    expect(extractColumn(s, 1, true).blanks).toBe(1);
    expect(extractColumn(s, 0, true).entries[2]).toBe("=SUM(A1)");
  });
  it("rejects malformed quotes and preserves a headerless first participant", () => {
    expect(() => readCsv('"unfinished')).toThrow();
    const s = readCsv("Ada\nBen");
    expect(likelyHeader(s)).toBe(false);
    expect(extractColumn(s, 0, false).entries).toEqual(["Ada", "Ben"]);
  });
  it("maps duplicate entry IDs to original textarea line numbers", () => {
    const result = analyzeEntries("\nAda\n\nBen\nAda");
    expect(result.duplicates[0]).toEqual({
      entry: 2,
      first: 0,
      line: 5,
      firstLine: 2,
    });
    expect(analyzeEntries("").blanks).toBe(0);
    expect(result.offsets[2]).toEqual({ start: 10, end: 13 });
  });
});
