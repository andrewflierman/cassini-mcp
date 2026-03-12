import { Database } from "bun:sqlite";
import path from "path";

// Patterns that indicate a write (mutating) SQL statement.
// PRAGMA with = is also considered a write (it changes a setting).
const WRITE_PATTERN =
  /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE|ATTACH|DETACH|REINDEX|VACUUM)\b|^\s*PRAGMA\s+\w+\s*=/i;

/** Opens the SQLite database at dbPath in read-only mode. */
export function openDb(dbPath: string): Database {
  const resolved = path.resolve(dbPath);
  return new Database(resolved, { readonly: true });
}

/** Returns a human-readable schema string describing all user tables. */
export function getSchema(db: Database): string {
  // Fetch all user-created tables from sqlite_master
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all();

  const lines: string[] = [];

  for (const { name } of tables) {
    lines.push(`Table: ${name}`);

    // PRAGMA table_info does not support ? placeholders in bun:sqlite;
    // the table name is safe here since it comes from sqlite_master.
    const columns = db
      .query<
        {
          cid: number;
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        },
        []
      >(`PRAGMA table_info(${JSON.stringify(name)})`)
      .all();

    for (const col of columns) {
      const flags: string[] = [];
      if (col.pk) flags.push("PK");
      if (col.notnull) flags.push("NOT NULL");
      const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
      lines.push(`  - ${col.name} ${col.type}${flagStr}`);
    }

    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Executes a read-only SQL query against the database.
 * Rejects write statements before execution.
 * Returns a JSON string of { rows } capped at 100 rows.
 * If more rows exist, adds a note to the result.
 */
export function query(db: Database, sql: string): string {
  if (WRITE_PATTERN.test(sql)) {
    throw new Error(`Write statements are not allowed: ${sql.trim()}`);
  }

  // Fetch up to 101 rows so we can detect truncation without a full table scan
  const stmt = db.query<Record<string, unknown>, []>(sql);
  const allRows = stmt.all();

  if (allRows.length > 100) {
    return JSON.stringify({
      rows: allRows.slice(0, 100),
      note: `Results truncated to 100 rows (${allRows.length} total rows matched). Refine your query to see more.`,
    });
  }

  return JSON.stringify({ rows: allRows });
}
