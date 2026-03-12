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

/** Returns a list of all user tables with their row counts. */
export function getTableList(db: Database): Array<{ name: string; rows: number }> {
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all();

  return tables.map(({ name }) => {
    const result = db
      .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${JSON.stringify(name)}`)
      .get();
    return { name, rows: result?.count ?? 0 };
  });
}

/** Returns a human-readable schema string describing all user tables. */
export function getSchema(db: Database): string {
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
 * Returns rows capped at the given limit (default 50).
 * If more rows exist, also returns a truncation note.
 */
export function queryRaw(
  db: Database,
  sql: string,
  limit: number = 50
): { rows: Record<string, unknown>[]; note?: string } {
  if (WRITE_PATTERN.test(sql)) {
    throw new Error(`Write statements are not allowed: ${sql.trim()}`);
  }

  // Fetch limit+1 rows to detect truncation without a full table scan
  const stmt = db.query<Record<string, unknown>, []>(sql);
  const allRows = stmt.all();

  if (allRows.length > limit) {
    return {
      rows: allRows.slice(0, limit),
      note: `Results truncated to ${limit} rows (${allRows.length} total rows matched). Refine your query to see more.`,
    };
  }

  return { rows: allRows };
}
