/**
 * Tests for task: cli-formatter — Create cli/src/formatter.ts
 *
 * Task: cli-formatter
 * Run with: bun test tests/cli-formatter.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. cli/src/formatter.ts is created
 *   2. formatRows(rows, format) is exported from it
 *   3. All three formats (table, json, csv) are implemented per spec
 */

import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";

const FORMATTER_PATH = path.resolve(
  import.meta.dir,
  "../cli/src/formatter.ts"
);

// ─── AC1: file existence and export ──────────────────────────────────────────

describe("cli/src/formatter.ts — file existence and export (AC1)", () => {
  it("cli/src/formatter.ts exists", async () => {
    const file = Bun.file(FORMATTER_PATH);
    expect(await file.exists()).toBe(true);
  });

  it("source exports a formatRows function", async () => {
    const file = Bun.file(FORMATTER_PATH);
    const source = await file.text();
    expect(source).toMatch(/export\s+(function|const)\s+formatRows/);
  });

  it("formatRows is callable after import", async () => {
    const mod = await import(FORMATTER_PATH);
    expect(typeof mod.formatRows).toBe("function");
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Dynamically import and call formatRows — avoids top-level static import
 *  failing when the file does not yet exist. */
async function fmt(
  rows: Record<string, unknown>[],
  format: "table" | "json" | "csv"
): Promise<string> {
  const mod = await import(FORMATTER_PATH);
  return mod.formatRows(rows, format);
}

const PLANETS = [
  { name: "Saturn", moons: 146, radius_km: 58232 },
  { name: "Titan",  moons: 0,   radius_km: 2574  },
  { name: "Enceladus", moons: 0, radius_km: 252  },
];

// ─── AC3: JSON format ─────────────────────────────────────────────────────────

describe("formatRows — JSON format (AC3)", () => {
  it("returns a string", async () => {
    const result = await fmt(PLANETS, "json");
    expect(typeof result).toBe("string");
  });

  it("output is valid JSON", async () => {
    const result = await fmt(PLANETS, "json");
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("output parses to an array", async () => {
    const result = await fmt(PLANETS, "json");
    expect(Array.isArray(JSON.parse(result))).toBe(true);
  });

  it("array length matches input rows", async () => {
    const result = await fmt(PLANETS, "json");
    expect(JSON.parse(result)).toHaveLength(3);
  });

  it("preserves all fields on each row", async () => {
    const result = await fmt(PLANETS, "json");
    const parsed = JSON.parse(result) as Record<string, unknown>[];
    expect(parsed[0].name).toBe("Saturn");
    expect(parsed[0].moons).toBe(146);
    expect(parsed[0].radius_km).toBe(58232);
  });

  it("is pretty-printed (indented with 2 spaces)", async () => {
    const result = await fmt(PLANETS, "json");
    // Pretty-printed JSON has newlines and leading spaces
    expect(result).toContain("\n");
    expect(result).toContain("  ");
  });

  it("matches JSON.stringify(rows, null, 2) exactly", async () => {
    const result = await fmt(PLANETS, "json");
    expect(result).toBe(JSON.stringify(PLANETS, null, 2));
  });
});

// ─── AC5 (JSON): empty results → '[]' ────────────────────────────────────────

describe("formatRows — JSON format, empty input (AC5)", () => {
  it("returns '[]' for an empty rows array", async () => {
    const result = await fmt([], "json");
    expect(result).toBe("[]");
  });
});

// ─── AC4: CSV format ──────────────────────────────────────────────────────────

describe("formatRows — CSV format (AC4)", () => {
  it("returns a string", async () => {
    const result = await fmt(PLANETS, "csv");
    expect(typeof result).toBe("string");
  });

  it("first line is a header row with column names", async () => {
    const result = await fmt(PLANETS, "csv");
    const lines = result.split("\n").filter((l) => l.length > 0);
    const header = lines[0];
    expect(header).toContain("name");
    expect(header).toContain("moons");
    expect(header).toContain("radius_km");
  });

  it("has N+1 non-empty lines (1 header + N data rows)", async () => {
    const result = await fmt(PLANETS, "csv");
    const lines = result.split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(PLANETS.length + 1);
  });

  it("data rows contain the correct values", async () => {
    const result = await fmt(PLANETS, "csv");
    expect(result).toContain("Saturn");
    expect(result).toContain("Titan");
    expect(result).toContain("Enceladus");
  });

  it("columns are comma-separated", async () => {
    const result = await fmt(PLANETS, "csv");
    const lines = result.split("\n").filter((l) => l.length > 0);
    // Every line should have at least 2 commas for 3 columns
    lines.forEach((line) => {
      expect(line.split(",").length).toBeGreaterThanOrEqual(3);
    });
  });

  it("quotes fields that contain a comma", async () => {
    const rows = [{ description: "big, round", value: 1 }];
    const result = await fmt(rows, "csv");
    // The field with a comma must be wrapped in quotes
    expect(result).toContain('"big, round"');
  });

  it("quotes fields that contain a double-quote, and escapes inner quotes by doubling", async () => {
    const rows = [{ description: 'He said "hello"', value: 2 }];
    const result = await fmt(rows, "csv");
    // Inner quotes must be doubled: "He said ""hello"""
    expect(result).toContain('"He said ""hello"""');
  });

  it("quotes fields that contain a newline", async () => {
    const rows = [{ description: "line1\nline2", value: 3 }];
    const result = await fmt(rows, "csv");
    // Field with newline must be quoted
    expect(result).toContain('"line1\nline2"');
  });

  it("does not quote plain fields that need no escaping", async () => {
    const result = await fmt(PLANETS, "csv");
    const lines = result.split("\n").filter((l) => l.length > 0);
    // The header line should not wrap simple column names in quotes
    expect(lines[0]).not.toMatch(/^"/);
  });
});

// ─── AC5 (CSV): empty results ─────────────────────────────────────────────────

describe("formatRows — CSV format, empty input (AC5)", () => {
  it("returns an empty string for an empty rows array", async () => {
    const result = await fmt([], "csv");
    expect(result.trim()).toBe("");
  });
});

// ─── AC2: table format ────────────────────────────────────────────────────────

describe("formatRows — table format (AC2)", () => {
  let output: string;
  let lines: string[];

  beforeAll(async () => {
    output = await fmt(PLANETS, "table");
    lines = output.split("\n");
  });

  it("returns a string", async () => {
    expect(typeof output).toBe("string");
  });

  it("first line is a header row containing all column names", () => {
    const header = lines[0];
    expect(header).toContain("name");
    expect(header).toContain("moons");
    expect(header).toContain("radius_km");
  });

  it("second line is a separator made entirely of dashes and spaces", () => {
    const separator = lines[1];
    // Must contain at least some dashes and nothing else (except spaces)
    expect(separator).toMatch(/^[\- ]+$/);
    expect(separator).toContain("---");
  });

  it("data rows follow the separator", () => {
    // Lines 2+ (after header + separator) should include planet names
    const dataSection = lines.slice(2).join("\n");
    expect(dataSection).toContain("Saturn");
    expect(dataSection).toContain("Titan");
    expect(dataSection).toContain("Enceladus");
  });

  it("last non-empty line is a footer showing row count", () => {
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    const footer = nonEmpty[nonEmpty.length - 1].trim();
    expect(footer).toMatch(/\(3 rows?\)/i);
  });

  it("columns are aligned — values in the same column share the same horizontal offset", () => {
    // Check that 'Saturn', 'Titan', 'Enceladus' all start at the same column offset
    const dataLines = lines.slice(2).filter(
      (l) =>
        l.includes("Saturn") ||
        l.includes("Titan") ||
        l.includes("Enceladus")
    );
    expect(dataLines).toHaveLength(3);

    // All name values should start at the same character index (column 0 or after separator)
    const firstCharIndices = dataLines.map((l) => l.search(/\S/));
    const uniqueOffsets = new Set(firstCharIndices);
    expect(uniqueOffsets.size).toBe(1);
  });

  it("uses at least 2-space gaps between columns", () => {
    // The separator line should have runs of dashes separated by 2+ spaces
    const separator = lines[1];
    expect(separator).toMatch(/--\s{2,}--/);
  });
});

// ─── AC5 (table): empty results → '(no results)' ─────────────────────────────

describe("formatRows — table format, empty input (AC5)", () => {
  it("returns '(no results)' for an empty rows array", async () => {
    const result = await fmt([], "table");
    expect(result.trim()).toBe("(no results)");
  });
});

// ─── AC6: table format — long value truncation ───────────────────────────────

describe("formatRows — table format, long value truncation (AC6)", () => {
  it("truncates values longer than 40 characters with '…'", async () => {
    const long = "A".repeat(50); // 50 chars, well over the 40-char cap
    const rows = [{ col: long }];
    const result = await fmt(rows, "table");
    // The output must not contain the full 50-char string
    expect(result).not.toContain(long);
    // It must contain an ellipsis character
    expect(result).toContain("…");
  });

  it("truncated value is exactly 40 characters before the ellipsis (41 chars total with '…')", async () => {
    const long = "B".repeat(60);
    const rows = [{ col: long }];
    const result = await fmt(rows, "table");
    // Find the line that contains the truncated value
    const dataLine = result
      .split("\n")
      .find((l) => l.includes("B".repeat(40) + "…"));
    expect(dataLine).toBeDefined();
  });

  it("values of exactly 40 characters are NOT truncated", async () => {
    const exact = "C".repeat(40);
    const rows = [{ col: exact }];
    const result = await fmt(rows, "table");
    expect(result).toContain(exact);
    // And the ellipsis should NOT appear adjacent to it
    const dataLine = result
      .split("\n")
      .find((l) => l.includes(exact));
    expect(dataLine).toBeDefined();
    // The cell value should not be followed by '…'
    expect(dataLine).not.toContain(exact + "…");
  });

  it("column widths are capped at 40 in the header as well", async () => {
    const longHeader = "x".repeat(50); // column name itself is long
    const rows = [{ [longHeader]: "value" }];
    const result = await fmt(rows, "table");
    expect(result).not.toContain(longHeader);
    expect(result).toContain("…");
  });

  it("long value truncation does not affect JSON output", async () => {
    const long = "D".repeat(60);
    const rows = [{ col: long }];
    const result = await fmt(rows, "json");
    // JSON must preserve the full value
    expect(result).toContain(long);
  });

  it("long value truncation does not affect CSV output", async () => {
    const long = "E".repeat(60);
    const rows = [{ col: long }];
    const result = await fmt(rows, "csv");
    // CSV must preserve the full value
    expect(result).toContain(long);
  });
});

// ─── AC2 (table): multi-row footer count ─────────────────────────────────────

describe("formatRows — table format, footer count (AC2)", () => {
  it("footer says '(1 row)' for a single row", async () => {
    const rows = [{ a: 1 }];
    const result = await fmt(rows, "table");
    const nonEmpty = result
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const footer = nonEmpty[nonEmpty.length - 1].trim();
    expect(footer).toMatch(/\(1 rows?\)/i);
  });

  it("footer says '(N rows)' for multiple rows", async () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }];
    const result = await fmt(rows, "table");
    const nonEmpty = result
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const footer = nonEmpty[nonEmpty.length - 1].trim();
    expect(footer).toMatch(/\(5 rows?\)/i);
  });
});

// ─── AC2 (table): default format is 'table' ──────────────────────────────────

describe("formatRows — default format behaviour", () => {
  it("calling formatRows with 'table' produces table-like output (not raw JSON)", async () => {
    const result = await fmt(PLANETS, "table");
    // Table output should contain dashes (separator) and NOT start with '['
    expect(result.trimStart()).not.toMatch(/^\[/);
    expect(result).toMatch(/---/);
  });
});
