import { describe, it, expect } from "vitest";
import { analyzeEditor, formatWeightedEntries } from "../shared/import";
import { weightingConflict } from "../shared/core";
import { projection } from "../worker/jev";
describe("bulk weighted input", () => {
  it("parses headers, quoted commas and missing weights without altering entries", () => {
    const data = analyzeEditor(
      'entry,weight\n"Morgan, Alex",3\nsam@example.com,2\n@community',
      true,
    );
    expect(data.entries).toEqual([
      "Morgan, Alex",
      "sam@example.com",
      "@community",
    ]);
    expect(data.weights).toEqual([3, 2, 1]);
    expect(data.formatError).toBe("");
    expect(
      analyzeEditor(formatWeightedEntries(data.entries, data.weights!), true)
        .weights,
    ).toEqual([3, 2, 1]);
  });
  it("reports invalid weights and extra columns instead of silently treating them as labels", () => {
    expect(analyzeEditor("Alex,0\nSam,2", true).formatError).toContain(
      "Invalid weights on rows 1",
    );
    expect(analyzeEditor("Morgan, Alex,3", true).formatError).toContain(
      "quote entries",
    );
    expect(analyzeEditor('"unfinished', true).formatError).toContain(
      "closing quote",
    );
  });
  it("detects repeated entries independently of their weights and keeps real row numbers", () => {
    const data = analyzeEditor("entry,weight\n\nAlex,2\nSam,1\nAlex,5", true);
    expect(data.duplicates[0]).toMatchObject({ line: 5, firstLine: 3 });
  });
  it("gives an actionable mismatch while allowing equal weights in weighted mode", () => {
    const rules =
      "Participation is free. Each synthetic entry has an equal chance.";
    expect(weightingConflict(rules, [1, 3])).toContain("different weights");
    expect(weightingConflict(rules, [2, 2])).toBeNull();
    expect(
      weightingConflict(
        "Entries do not have equal chances; weights are public.",
        [1, 3],
      ),
    ).toBeNull();
    expect(
      projection({
        title: "Test",
        description: "",
        rules,
        entries: ["A", "B"],
        winners: 1,
        reserves: 0,
        weights: [2, 2],
      }).equalChances,
    ).toBe(true);
  });
});
