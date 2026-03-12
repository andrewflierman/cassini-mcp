/**
 * Tests for task: cli-commands — Create cli/src/commands.ts with handler functions
 *
 * Task: cli-commands
 * Run with: bun test tests/cli-commands.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. cli/src/commands.ts is created with exported handler functions
 *   2. handleAsk calls naturalLanguageToSql, prints explanation + SQL, then runs the query
 *   3. handleAsk --sql flag prints SQL only without executing
 *   4. handleQuery runs arbitrary SQL and formats output
 *   5. handleTables lists table names and row counts
 *   6. handleSchema prints the full schema
 *   7. All handlers respect --format and --limit flags
 *   8. Errors go to stderr and exit with code 1
 *   9. handleAsk validates the API key before calling the AI
 */

import { describe, it, expect } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const CLI_DIR = path.join(ROOT, "cli");
const COMMANDS_FILE = path.join(CLI_DIR, "src/commands.ts");
const DB_PATH = path.join(ROOT, "cassini.db");

// ─── Helper: spawn the full CLI entry point ───────────────────────────────────

async function runCli(
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = opts.env ?? process.env as Record<string, string>;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const proc = Bun.spawn(
    ["bun", path.join(CLI_DIR, "src/index.ts"), ...args],
    {
      stdout: "pipe",
      stderr: "pipe",
      cwd: ROOT,
      env,
    }
  );

  const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([proc.exited, deadline]);
  try { proc.kill(); } catch { /* already exited */ }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = proc.exitCode ?? 1;

  return { stdout, stderr, exitCode };
}

// ─── AC1: cli/src/commands.ts — file existence and exports ───────────────────

describe("cli/src/commands.ts — file existence and exports (AC1)", () => {
  it("cli/src/commands.ts exists", async () => {
    const file = Bun.file(COMMANDS_FILE);
    expect(await file.exists()).toBe(true);
  });

  it("source exports handleAsk", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toMatch(/export\s+(async\s+)?function\s+handleAsk|export\s*\{[^}]*handleAsk/);
  });

  it("source exports handleQuery", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toMatch(/export\s+(async\s+)?function\s+handleQuery|export\s*\{[^}]*handleQuery/);
  });

  it("source exports handleTables", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toMatch(/export\s+(async\s+)?function\s+handleTables|export\s*\{[^}]*handleTables/);
  });

  it("source exports handleSchema", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toMatch(/export\s+(async\s+)?function\s+handleSchema|export\s*\{[^}]*handleSchema/);
  });
});

// ─── AC1: source-level imports ────────────────────────────────────────────────

describe("cli/src/commands.ts — source imports (AC1)", () => {
  it("imports from ./db (local module)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toMatch(/from ["']\.\/db(\.js|\.ts)?["']/);
  });

  it("imports from ./formatter (local module)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toMatch(/from ["']\.\/formatter(\.js|\.ts)?["']/);
  });

  it("imports from ./ai (local module) for the ask handler", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toMatch(/from ["']\.\/ai(\.js|\.ts)?["']/);
  });

  it("does NOT import from ../mcp/ (no cross-package imports)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).not.toContain("../mcp/");
  });
});

// ─── AC2 + AC3: ask command via CLI — translates NL to SQL and runs it ────────

describe("cassini ask — natural language to SQL (AC2, AC3)", () => {
  it("ask with valid API key prints 'Querying:' followed by a SQL statement", async () => {
    // Skip if no real API key is configured — this requires a live Anthropic call
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }

    const { stdout, exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "how many planets are in the database?"],
      { timeoutMs: 30_000 }
    );

    // Should print a line mentioning the SQL (AC3: prints generated SQL before results)
    expect(stdout.toLowerCase()).toMatch(/query(ing)?:/);
    // The SQL line should contain SELECT
    expect(stdout.toUpperCase()).toContain("SELECT");
    expect(exitCode).toBe(0);
  }, 35_000);

  it("ask prints the explanation or the SQL before the results table", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }

    const { stdout } = await runCli(
      ["ask", "--db", DB_PATH, "list all planets"],
      { timeoutMs: 30_000 }
    );

    // The output should contain a formatted query result (table separator dashes) or JSON
    const hasSqlLabel = stdout.toLowerCase().includes("querying:") ||
      stdout.toUpperCase().includes("SELECT");
    expect(hasSqlLabel).toBe(true);
  }, 35_000);
});

// ─── AC3: ask --sql flag — print SQL only, do NOT execute ────────────────────

describe("cassini ask --sql — prints SQL without executing (AC4)", () => {
  it("source code references the showSql / --sql flag in the ask handler", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    // The handler must branch on showSql or sql flag
    expect(source).toMatch(/showSql|sql/i);
  });

  it("ask --sql with valid API key prints a SELECT statement and exits 0", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }

    const { stdout, exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "--sql", "how many planets are there?"],
      { timeoutMs: 30_000 }
    );

    expect(stdout.toUpperCase()).toContain("SELECT");
    expect(exitCode).toBe(0);
  }, 35_000);

  it("ask --sql does NOT output a table-format result (no dash separator)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }

    const { stdout } = await runCli(
      ["ask", "--db", DB_PATH, "--sql", "show all planets"],
      { timeoutMs: 30_000 }
    );

    // Table format includes a dash separator line like "---  ---"
    // With --sql only the SQL is printed, so no table rows should appear
    expect(stdout).not.toMatch(/^[\- ]{5,}$/m); // no separator-only lines
  }, 35_000);
});

// ─── AC5: query command — runs arbitrary SQL ──────────────────────────────────

describe("cassini query — runs arbitrary SQL (AC5)", () => {
  it("query command with a valid SQL statement exits 0", async () => {
    const { exitCode } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT name FROM planets ORDER BY name LIMIT 3",
    ]);
    expect(exitCode).toBe(0);
  });

  it("query command prints the query results to stdout", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT name FROM planets ORDER BY name LIMIT 3",
    ]);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("query command results contain expected planet names", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT name FROM planets ORDER BY name",
    ]);
    // planets table has Saturn — it must appear in output
    expect(stdout).toContain("Saturn");
  });

  it("query command default output is table format (has separator line)", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT name FROM planets LIMIT 2",
    ]);
    // Table format has a dash separator like "----"
    expect(stdout).toMatch(/---/);
  });

  it("query with --format json outputs valid JSON", async () => {
    const { stdout, exitCode } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT name FROM planets ORDER BY name LIMIT 3",
    ]);
    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("query with --format csv outputs comma-separated lines", async () => {
    const { stdout, exitCode } = await runCli([
      "query", "--db", DB_PATH, "--format", "csv",
      "SELECT name FROM planets ORDER BY name LIMIT 3",
    ]);
    expect(exitCode).toBe(0);
    // CSV has a header line with column name
    expect(stdout).toContain("name");
    // Data rows are present — Enceladus is first alphabetically, so it appears in LIMIT 3
    expect(stdout).toContain("Enceladus");
  });

  it("query respects --limit flag (limits number of rows returned)", async () => {
    // planets has 6 rows; with --limit 2 we should get only 2 data rows
    const { stdout: noLimit } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT name FROM planets ORDER BY name",
    ]);
    const { stdout: withLimit } = await runCli([
      "query", "--db", DB_PATH, "--format", "json", "--limit", "2",
      "SELECT name FROM planets ORDER BY name",
    ]);

    const noLimitRows = JSON.parse(noLimit) as unknown[];
    const limitedRows = JSON.parse(withLimit) as unknown[];
    expect(noLimitRows.length).toBeGreaterThan(limitedRows.length);
    expect(limitedRows).toHaveLength(2);
  });

  it("query command with a non-existent db path prints to stderr and exits 1", async () => {
    const { stderr, exitCode } = await runCli([
      "query", "--db", "/tmp/does-not-exist-cassini.db",
      "SELECT 1",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.trim().length).toBeGreaterThan(0);
  });

  it("query with a write statement (INSERT) prints to stderr and exits 1", async () => {
    const { stderr, exitCode } = await runCli([
      "query", "--db", DB_PATH,
      "INSERT INTO planets (name) VALUES ('Pluto')",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.trim().length).toBeGreaterThan(0);
  });
});

// ─── AC6: tables command ──────────────────────────────────────────────────────

describe("cassini tables — lists tables with row counts (AC6)", () => {
  it("tables command exits 0", async () => {
    const { exitCode } = await runCli(["tables", "--db", DB_PATH]);
    expect(exitCode).toBe(0);
  });

  it("tables command prints something to stdout", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("tables output includes 'planets' table name", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    expect(stdout).toContain("planets");
  });

  it("tables output includes 'master_plan' table name", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    expect(stdout).toContain("master_plan");
  });

  it("tables output shows row counts (numeric values present)", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    // The row count for planets (6) or a large number for master_plan should appear
    expect(stdout).toMatch(/\d+/);
  });

  it("tables output in default (table) format has a separator line", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    expect(stdout).toMatch(/---/);
  });

  it("tables with --format json outputs a valid JSON array", async () => {
    const { stdout, exitCode } = await runCli([
      "tables", "--db", DB_PATH, "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  it("tables json output has 'name' and 'count' fields on each entry", async () => {
    const { stdout } = await runCli([
      "tables", "--db", DB_PATH, "--format", "json",
    ]);
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    const planets = parsed.find((t) => t.name === "planets");
    expect(planets).toBeDefined();
    expect(typeof planets!.count).toBe("number");
    expect(planets!.count).toBe(6);
  });

  it("tables with --format csv outputs comma-separated lines", async () => {
    const { stdout, exitCode } = await runCli([
      "tables", "--db", DB_PATH, "--format", "csv",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("planets");
    // CSV rows are comma-separated
    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(1); // header + at least one data row
    lines.forEach((line) => expect(line).toContain(","));
  });

  it("tables with a non-existent db prints to stderr and exits 1", async () => {
    const { stderr, exitCode } = await runCli([
      "tables", "--db", "/tmp/no-such-db.db",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.trim().length).toBeGreaterThan(0);
  });
});

// ─── AC7: schema command ──────────────────────────────────────────────────────

describe("cassini schema — prints full schema (AC7)", () => {
  it("schema command exits 0", async () => {
    const { exitCode } = await runCli(["schema", "--db", DB_PATH]);
    expect(exitCode).toBe(0);
  });

  it("schema command prints something to stdout", async () => {
    const { stdout } = await runCli(["schema", "--db", DB_PATH]);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("schema output includes 'planets' table", async () => {
    const { stdout } = await runCli(["schema", "--db", DB_PATH]);
    expect(stdout).toContain("planets");
  });

  it("schema output includes 'master_plan' table", async () => {
    const { stdout } = await runCli(["schema", "--db", DB_PATH]);
    expect(stdout).toContain("master_plan");
  });

  it("schema output includes column type information (INTEGER, TEXT, or REAL)", async () => {
    const { stdout } = await runCli(["schema", "--db", DB_PATH]);
    expect(stdout).toMatch(/INTEGER|TEXT|REAL|NUMERIC/i);
  });

  it("schema output is printed as-is (plain text, not formatted as a table with dashes)", async () => {
    const { stdout } = await runCli(["schema", "--db", DB_PATH]);
    // getSchema returns lines like "Table: name" and "  - col TYPE"
    // It should NOT look like a formatRows table (no dash separator rows)
    expect(stdout).toContain("Table:");
    // The output should list columns with a dash prefix (from getSchema format)
    expect(stdout).toMatch(/^\s*-\s+\w+/m);
  });

  it("schema with a non-existent db prints to stderr and exits 1", async () => {
    const { stderr, exitCode } = await runCli([
      "schema", "--db", "/tmp/no-such-schema-db.db",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.trim().length).toBeGreaterThan(0);
  });
});

// ─── AC8: --limit flag is respected across all commands ──────────────────────

describe("--limit flag respected across commands (AC8)", () => {
  it("query: --limit 1 returns only 1 row in json format", async () => {
    const { stdout, exitCode } = await runCli([
      "query", "--db", DB_PATH, "--format", "json", "--limit", "1",
      "SELECT name FROM planets ORDER BY name",
    ]);
    expect(exitCode).toBe(0);
    const rows = JSON.parse(stdout) as unknown[];
    expect(rows).toHaveLength(1);
  });

  it("query: --limit 3 returns no more than 3 rows in json format", async () => {
    const { stdout, exitCode } = await runCli([
      "query", "--db", DB_PATH, "--format", "json", "--limit", "3",
      "SELECT * FROM master_plan",
    ]);
    expect(exitCode).toBe(0);
    const rows = JSON.parse(stdout) as unknown[];
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it("tables: --limit is accepted without error (even if not meaningful for table listing)", async () => {
    const { exitCode } = await runCli([
      "tables", "--db", DB_PATH, "--limit", "5",
    ]);
    expect(exitCode).toBe(0);
  });
});

// ─── AC9: errors go to stderr and exit code is 1 ─────────────────────────────

describe("error handling — stderr + exit code 1 (AC9)", () => {
  it("query: bad SQL prints error to stderr, not stdout, and exits 1", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT * FROM table_that_does_not_exist_xyz",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.trim().length).toBeGreaterThan(0);
    // Error must not be swallowed silently to stdout
    expect(stdout.trim().length).toBe(0);
  });

  it("query: write statement prints error to stderr and exits 1", async () => {
    const { stderr, exitCode } = await runCli([
      "query", "--db", DB_PATH,
      "DELETE FROM planets WHERE 1=1",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.toLowerCase()).toMatch(/error|not allowed|write/);
  });

  it("tables: missing db exits 1 with stderr message", async () => {
    const { stderr, exitCode } = await runCli([
      "tables", "--db", "/tmp/definitely-missing-db.db",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.trim().length).toBeGreaterThan(0);
  });

  it("schema: missing db exits 1 with stderr message", async () => {
    const { stderr, exitCode } = await runCli([
      "schema", "--db", "/tmp/definitely-missing-schema.db",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.trim().length).toBeGreaterThan(0);
  });

  it("error message does NOT appear on stdout (errors go to stderr only)", async () => {
    const { stdout, exitCode } = await runCli([
      "query", "--db", "/tmp/no-db-here.db",
      "SELECT 1",
    ]);
    expect(exitCode).toBe(1);
    // stdout should be empty (the error must only be on stderr)
    expect(stdout.trim().length).toBe(0);
  });
});

// ─── AC10: ask command validates API key before calling the API ───────────────

describe("cassini ask — API key validation (AC10)", () => {
  it("source code calls validateApiKey in the ask handler", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("validateApiKey");
  });

  it("ask without ANTHROPIC_API_KEY prints an error to stderr and exits 1", async () => {
    const envWithoutKey: Record<string, string> = {};
    // Copy current env but strip the API key
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const { stderr, exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "what planets exist?"],
      { env: envWithoutKey, timeoutMs: 5_000 }
    );

    expect(exitCode).toBe(1);
    expect(stderr.trim().length).toBeGreaterThan(0);
    // Should mention the API key
    expect(stderr.toUpperCase()).toMatch(/API.?KEY|ANTHROPIC/);
  });

  it("ask with no API key does NOT make an HTTP request (fails fast)", async () => {
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const start = Date.now();
    await runCli(
      ["ask", "--db", DB_PATH, "what planets exist?"],
      { env: envWithoutKey, timeoutMs: 5_000 }
    );
    const elapsed = Date.now() - start;

    // Should exit almost immediately (< 3 seconds) — not hang on an HTTP call
    expect(elapsed).toBeLessThan(3_000);
  });
});

// ─── Source structure: handleAsk calls naturalLanguageToSql ──────────────────

describe("cli/src/commands.ts — handleAsk source structure (AC2)", () => {
  it("handleAsk calls naturalLanguageToSql", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("naturalLanguageToSql");
  });

  it("handleAsk calls getSchema to provide the schema to naturalLanguageToSql", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("getSchema");
  });

  it("handleAsk calls queryRaw (or similar) to execute the generated SQL", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    // Should call queryRaw to run the AI-generated SQL
    expect(source).toMatch(/queryRaw|query\(/);
  });

  it("handleAsk calls formatRows to format the output", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("formatRows");
  });

  it("handleAsk prints the generated SQL (references explanation or 'Querying:')", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    // Must print the SQL or a "Querying:" prefix before results
    expect(source).toMatch(/Querying:|explanation|\.sql/);
  });
});

// ─── Source structure: handleQuery ───────────────────────────────────────────

describe("cli/src/commands.ts — handleQuery source structure (AC5)", () => {
  it("handleQuery calls queryRaw", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("queryRaw");
  });

  it("handleQuery calls formatRows", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("formatRows");
  });

  it("handleQuery does NOT call naturalLanguageToSql (no AI for raw SQL)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    // handleQuery must be a plain pass-through — no AI call
    // We check by looking at the structure: handleQuery function body should not reference naturalLanguageToSql
    // A loose check: if naturalLanguageToSql is only called once in the file, it's in handleAsk
    const occurrences = (source.match(/naturalLanguageToSql/g) || []).length;
    // There should be at most 1-2 occurrences (import + one call in handleAsk)
    // handleQuery must NOT add another call
    expect(occurrences).toBeLessThanOrEqual(3);
  });
});

// ─── Source structure: handleTables ──────────────────────────────────────────

describe("cli/src/commands.ts — handleTables source structure (AC6)", () => {
  it("handleTables calls getTableList", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("getTableList");
  });

  it("handleTables calls formatRows to display the result", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("formatRows");
  });
});

// ─── Source structure: handleSchema ──────────────────────────────────────────

describe("cli/src/commands.ts — handleSchema source structure (AC7)", () => {
  it("handleSchema calls getSchema", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("getSchema");
  });

  it("handleSchema prints directly (console.log / process.stdout.write) rather than through formatRows", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    // Schema is printed as-is, not as a formatted table
    expect(source).toMatch(/console\.log|process\.stdout\.write/);
  });
});

// ─── index.ts wiring: handlers imported from commands.ts ─────────────────────

describe("cli/src/index.ts — wires up commands.ts (AC1)", () => {
  it("index.ts imports from ./commands", async () => {
    const file = Bun.file(path.join(CLI_DIR, "src/index.ts"));
    const source = await file.text();
    expect(source).toMatch(/from ["']\.\/commands(\.js|\.ts)?["']/);
  });

  it("index.ts no longer contains inline stub handlers (delegates to commands.ts)", async () => {
    const file = Bun.file(path.join(CLI_DIR, "src/index.ts"));
    const source = await file.text();
    // The stubs had TODO comments — once commands.ts exists, the stubs should be removed
    // We check that the index does NOT contain the old stub log messages
    expect(source).not.toContain("[ask] Translating to SQL:");
    expect(source).not.toContain("[query] Running SQL:");
    expect(source).not.toContain("[tables] Listing tables in");
    expect(source).not.toContain("[schema] Printing schema for");
  });
});
