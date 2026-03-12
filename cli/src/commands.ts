/**
 * commands.ts — Handler functions for each cassini CLI subcommand.
 *
 * Each handler receives the parsed options and performs the full lifecycle:
 *   1. Open the database
 *   2. Run the appropriate DB operation
 *   3. Format and print the results
 *   4. Handle errors → stderr + exit code 1
 */

import { openDb, queryRaw, getTableList, getSchema } from "./db.js";
import { formatRows } from "./formatter.js";
import { naturalLanguageToSql, validateApiKey } from "./ai.js";

// Shared shape for parsed CLI options (mirrors ParsedArgs in index.ts)
interface CommandOpts {
  positionals: string[];
  db: string;
  limit: number;
  format: "table" | "json" | "csv";
  showSql: boolean;
}

// ─── ask ──────────────────────────────────────────────────────────────────────

/**
 * Translates a natural language question into SQL via the Anthropic API,
 * prints the generated SQL, then executes it and prints formatted results.
 *
 * With --sql flag: only prints the generated SQL, does not execute.
 */
export async function handleAsk(opts: CommandOpts): Promise<void> {
  // Validate API key before doing anything else (fast-fail, no HTTP call)
  if (!validateApiKey()) {
    process.exit(1);
  }

  const question = opts.positionals.join(" ");

  let db;
  try {
    db = openDb(opts.db);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  let sql: string;
  let explanation: string;

  try {
    const schema = getSchema(db);
    ({ sql, explanation } = await naturalLanguageToSql(question, schema));
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  // Always print the generated SQL so the user can see what was generated
  console.log(`Querying: ${sql}`);

  // With --sql, stop here — do not execute
  if (opts.showSql) {
    return;
  }

  // Print the explanation as context, then run the query
  if (explanation) {
    console.log(explanation);
  }

  try {
    const rows = queryRaw(db, sql, opts.limit);
    console.log(formatRows(rows, opts.format));
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── query ────────────────────────────────────────────────────────────────────

/**
 * Runs an arbitrary SQL statement directly (no AI translation).
 * Passes through to queryRaw and formats the output.
 */
export async function handleQuery(opts: CommandOpts): Promise<void> {
  const sql = opts.positionals.join(" ");

  let db;
  try {
    db = openDb(opts.db);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  try {
    const rows = queryRaw(db, sql, opts.limit);
    console.log(formatRows(rows, opts.format));
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── tables ───────────────────────────────────────────────────────────────────

/**
 * Lists all tables in the database with their row counts.
 * Formatted as a table (or JSON/CSV if requested).
 */
export async function handleTables(opts: CommandOpts): Promise<void> {
  let db;
  try {
    db = openDb(opts.db);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  try {
    const tables = getTableList(db);
    // Cast to the shape formatRows expects
    const rows = tables as unknown as Record<string, unknown>[];
    console.log(formatRows(rows, opts.format));
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── schema ───────────────────────────────────────────────────────────────────

/**
 * Prints the full database schema as plain text (not as a formatted table).
 * getSchema returns a multi-line string; we print it directly.
 */
export async function handleSchema(opts: CommandOpts): Promise<void> {
  let db;
  try {
    db = openDb(opts.db);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  try {
    const schema = getSchema(db);
    console.log(schema);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
