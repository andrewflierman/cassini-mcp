/**
 * formatter.ts — Output formatting for query results.
 *
 * Supported formats:
 *   table  — Aligned columns with header, dash separator, and row-count footer.
 *   json   — Pretty-printed JSON array (JSON.stringify with 2-space indent).
 *   csv    — RFC 4180-compliant CSV with proper quoting.
 */

const MAX_COL_WIDTH = 40;

// ─── Public API ───────────────────────────────────────────────────────────────

export function formatRows(
  rows: Record<string, unknown>[],
  format: "table" | "json" | "csv"
): string {
  switch (format) {
    case "json":
      return formatJson(rows);
    case "csv":
      return formatCsv(rows);
    case "table":
    default:
      return formatTable(rows);
  }
}

// ─── JSON ─────────────────────────────────────────────────────────────────────

function formatJson(rows: Record<string, unknown>[]): string {
  return JSON.stringify(rows, null, 2);
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

/** Quote a single CSV field if it contains commas, quotes, or newlines. */
function csvField(value: unknown): string {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    // Escape inner double-quotes by doubling them
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";

  const columns = Object.keys(rows[0]);
  const lines: string[] = [];

  // Header row (column names are simple identifiers — no quoting needed unless unusual)
  lines.push(columns.map(csvField).join(","));

  // Data rows
  for (const row of rows) {
    lines.push(columns.map((col) => csvField(row[col])).join(","));
  }

  return lines.join("\n");
}

// ─── Table ────────────────────────────────────────────────────────────────────

/** Truncate a string to MAX_COL_WIDTH chars, appending '…' if truncated. */
function truncate(str: string): string {
  if (str.length > MAX_COL_WIDTH) {
    return str.slice(0, MAX_COL_WIDTH) + "…";
  }
  return str;
}

function formatTable(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "(no results)";

  const columns = Object.keys(rows[0]);

  // Convert every cell (including headers) to its display string, with truncation.
  const headers = columns.map((col) => truncate(col));
  const dataRows = rows.map((row) =>
    columns.map((col) => truncate(String(row[col] ?? "")))
  );

  // Compute column widths: max of header width and all data cell widths.
  // Values are already capped at MAX_COL_WIDTH + 1 (the '…' char) by truncate().
  const colWidths = headers.map((h, i) => {
    const cellWidths = dataRows.map((row) => row[i].length);
    return Math.max(h.length, ...cellWidths);
  });

  // Build a row string: cells padded to their column width, separated by 2 spaces.
  function buildRow(cells: string[]): string {
    return cells.map((cell, i) => cell.padEnd(colWidths[i])).join("  ");
  }

  // Separator: a dash run the same width as each column, with 2-space gaps.
  const separator = colWidths.map((w) => "-".repeat(w)).join("  ");

  const lines: string[] = [
    buildRow(headers),
    separator,
    ...dataRows.map(buildRow),
    "",
    `(${rows.length} ${rows.length === 1 ? "row" : "rows"})`,
  ];

  return lines.join("\n");
}
