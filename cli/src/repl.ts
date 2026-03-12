/**
 * repl.ts — Interactive REPL for the Cassini CLI.
 *
 * Reads lines from process.stdin line-by-line (Bun built-in).
 * SQL keywords trigger direct execution; everything else goes through the AI pipeline.
 */

import { openDb, getSchema, getTableList, queryRaw } from "./db.js";
import { formatRows } from "./formatter.js";
import { naturalLanguageToSql } from "./ai.js";
import type { Database } from "bun:sqlite";

// ANSI escape codes for dim/reset
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

// Pattern that identifies lines to be treated as raw SQL
const SQL_PREFIX = /^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b/i;

// ─── REPL state ───────────────────────────────────────────────────────────────

let currentFormat: "table" | "json" | "csv" = "table";
let currentLimit = 50;
let showSql = true;

// ─── Public entry point ───────────────────────────────────────────────────────

export async function startRepl(opts: {
  db: string;
  limit?: number;
  format?: "table" | "json" | "csv";
}): Promise<void> {
  // Initialise mutable state from options
  currentFormat = opts.format ?? "table";
  currentLimit = opts.limit ?? 50;
  showSql = true;

  // Open the database
  const db = openDb(opts.db);

  // Print welcome banner
  process.stdout.write(
    "Cassini DB — interactive mode. Ask questions in English or type SQL directly.\n" +
      `Type .help for available commands.\n\n`
  );

  // Warn if API key is missing, but continue (raw SQL still works)
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    process.stderr.write(
      "Warning: ANTHROPIC_API_KEY is not set. Natural language queries will not work.\n" +
        "Raw SQL queries will still execute normally.\n\n"
    );
  }

  // Clean exit on Ctrl+C (SIGINT)
  process.on("SIGINT", () => {
    process.stdout.write("\nBye!\n");
    db.close();
    process.exit(0);
  });

  // Read lines from stdin
  await readLines(db);

  // EOF reached (Ctrl+D)
  process.stdout.write("\nBye!\n");
  db.close();
  process.exit(0);
}

// ─── stdin line reader (Bun built-in) ────────────────────────────────────────

async function readLines(db: Database): Promise<void> {
  // Print the initial prompt before waiting for the first line
  process.stdout.write("cassini> ");

  for await (const line of console) {
    const trimmed = line.trim();

    if (trimmed.length > 0) {
      const shouldContinue = await handleLine(db, trimmed);
      if (!shouldContinue) return;
    }

    // Print next prompt
    process.stdout.write("cassini> ");
  }
}

// ─── Line dispatcher ──────────────────────────────────────────────────────────

/**
 * Processes a single input line.
 * Returns false when the REPL should exit (.quit / .exit).
 */
async function handleLine(db: Database, line: string): Promise<boolean> {
  // Dot-commands
  if (line.startsWith(".")) {
    return handleDotCommand(db, line);
  }

  // Direct SQL execution
  if (SQL_PREFIX.test(line)) {
    await runSql(db, line);
    return true;
  }

  // Natural language → SQL via AI
  await runNaturalLanguage(db, line);
  return true;
}

// ─── Dot-command handler ──────────────────────────────────────────────────────

function handleDotCommand(db: Database, line: string): boolean {
  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  switch (cmd) {
    case ".quit":
    case ".exit": {
      process.stdout.write("Bye!\n");
      db.close();
      process.exit(0);
    }

    case ".help": {
      process.stdout.write(
        [
          "Available dot-commands:",
          "  .help              — Show this help message",
          "  .tables            — List all tables with row counts",
          "  .schema            — Show the full database schema",
          "  .format <table|json|csv>  — Switch output format (current: " + currentFormat + ")",
          "  .limit <n>         — Change row limit (current: " + currentLimit + ")",
          "  .sql               — Toggle showing/hiding generated SQL for NL queries",
          "  .quit / .exit      — Exit the REPL",
          "",
        ].join("\n")
      );
      return true;
    }

    case ".tables": {
      try {
        const tables = getTableList(db);
        const rows = tables.map(({ name, count }) => ({ name, rows: count }));
        process.stdout.write(formatRows(rows, currentFormat) + "\n");
      } catch (err) {
        printError(err);
      }
      return true;
    }

    case ".schema": {
      try {
        const schema = getSchema(db);
        process.stdout.write(schema + "\n");
      } catch (err) {
        printError(err);
      }
      return true;
    }

    case ".format": {
      const fmt = parts[1]?.toLowerCase();
      if (fmt !== "table" && fmt !== "json" && fmt !== "csv") {
        process.stderr.write(
          `Error: invalid format '${parts[1] ?? ""}'. Use one of: table, json, csv\n`
        );
      } else {
        currentFormat = fmt;
        process.stdout.write(`Format set to: ${currentFormat}\n`);
      }
      return true;
    }

    case ".limit": {
      const n = parseInt(parts[1] ?? "", 10);
      if (isNaN(n)) {
        process.stderr.write(
          `Error: invalid number '${parts[1] ?? ""}'. Usage: .limit <positive number>\n`
        );
      } else if (n <= 0) {
        process.stderr.write(
          `Error: limit must be a positive number (got ${n})\n`
        );
      } else {
        currentLimit = n;
        process.stdout.write(`Row limit set to: ${currentLimit}\n`);
      }
      return true;
    }

    case ".sql": {
      showSql = !showSql;
      process.stdout.write(
        `Generated SQL display: ${showSql ? "on" : "off"}\n`
      );
      return true;
    }

    default: {
      process.stderr.write(
        `Unknown command: ${cmd}. Type .help for available commands.\n`
      );
      return true;
    }
  }
}

// ─── SQL execution ────────────────────────────────────────────────────────────

async function runSql(db: Database, sql: string): Promise<void> {
  try {
    const rows = queryRaw(db, sql, currentLimit);
    process.stdout.write(formatRows(rows, currentFormat) + "\n");
  } catch (err) {
    printError(err);
  }
}

// ─── Natural language query ───────────────────────────────────────────────────

async function runNaturalLanguage(db: Database, question: string): Promise<void> {
  try {
    const schema = getSchema(db);
    const { sql } = await naturalLanguageToSql(question, schema);

    // Print the generated SQL (dimmed) if showSql is on
    if (showSql) {
      process.stdout.write(`${DIM}${sql}${RESET}\n`);
    }

    await runSql(db, sql);
  } catch (err) {
    printError(err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function printError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
}
