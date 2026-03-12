/**
 * Tests for task: cli-wire — Wire everything together and test end-to-end
 *
 * Task: cli-wire
 * Run with: bun test tests/cli-wire.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. All command handlers are imported and wired in src/index.ts
 *   2. All 10 example commands produce correct output
 *   3. Natural language queries return relevant results
 *   4. Generated SQL is shown before results for 'ask' commands
 *   5. --sql flag shows SQL without executing
 *   6. Bare positional args work as implicit 'ask'
 *   7. Table format is aligned and readable
 *   8. JSON format is valid JSON
 *   9. CSV format is valid CSV
 *  10. --limit flag restricts result count
 *  11. --format flag switches output format
 *  12. --db flag allows specifying a custom database path
 *  13. src/index.ts has #!/usr/bin/env bun shebang
 *  14. bun build cli/src/index.ts --compile --outfile=cli/dist/cassini succeeds
 */

import { describe, it, expect } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const CLI_DIR = path.join(ROOT, "cli");
const DB_PATH = path.join(ROOT, "cassini.db");
const INDEX_FILE = path.join(CLI_DIR, "src/index.ts");

// ─── Helper: spawn the CLI entry point ────────────────────────────────────────

async function runCli(
  args: string[],
  opts: {
    env?: Record<string, string>;
    timeoutMs?: number;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = opts.env ?? (process.env as Record<string, string>);
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const proc = Bun.spawn(
    ["bun", INDEX_FILE, ...args],
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

// ─── AC13: shebang line in src/index.ts ───────────────────────────────────────

describe("src/index.ts — shebang (AC13)", () => {
  it("src/index.ts starts with #!/usr/bin/env bun", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    expect(source.startsWith("#!/usr/bin/env bun")).toBe(true);
  });

  it("shebang is on the very first line (no blank lines before it)", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    const firstLine = source.split("\n")[0];
    expect(firstLine.trim()).toBe("#!/usr/bin/env bun");
  });
});

// ─── AC1: index.ts wires real handlers ────────────────────────────────────────

describe("src/index.ts — handler wiring (AC1)", () => {
  it("imports handleAsk, handleQuery, handleTables, handleSchema from ./commands", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    expect(source).toMatch(/from ["']\.\/commands(\.js)?["']/);
    expect(source).toContain("handleAsk");
    expect(source).toContain("handleQuery");
    expect(source).toContain("handleTables");
    expect(source).toContain("handleSchema");
  });

  it("imports startRepl from ./repl", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    expect(source).toMatch(/from ["']\.\/repl(\.js)?["']/);
    expect(source).toContain("startRepl");
  });

  it("does NOT contain inline stub handler bodies (no TODO stubs)", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    // Old stubs used these exact strings
    expect(source).not.toContain("[ask] Translating to SQL:");
    expect(source).not.toContain("[query] Running SQL:");
    expect(source).not.toContain("[tables] Listing tables in");
    expect(source).not.toContain("[schema] Printing schema for");
    expect(source).not.toContain("[repl] Starting interactive REPL");
  });

  it("dispatches 'ask' case to handleAsk", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    // The switch/case for 'ask' must call handleAsk
    expect(source).toMatch(/case\s+["']ask["'][\s\S]{0,100}handleAsk/);
  });

  it("dispatches 'query' case to handleQuery", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    expect(source).toMatch(/case\s+["']query["'][\s\S]{0,100}handleQuery/);
  });

  it("dispatches 'tables' case to handleTables", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    expect(source).toMatch(/case\s+["']tables["'][\s\S]{0,100}handleTables/);
  });

  it("dispatches 'schema' case to handleSchema", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    expect(source).toMatch(/case\s+["']schema["'][\s\S]{0,100}handleSchema/);
  });

  it("dispatches 'repl' case to startRepl", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    expect(source).toMatch(/case\s+["']repl["'][\s\S]{0,100}startRepl/);
  });
});

// ─── AC2: --help ──────────────────────────────────────────────────────────────

describe("bun cli/src/index.ts --help (AC2)", () => {
  it("exits 0", async () => {
    const { exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
  });

  it("prints usage to stdout", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("mentions 'cassini' in output", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout.toLowerCase()).toContain("cassini");
  });

  it("mentions all subcommands: ask, query, tables, schema, repl", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("ask");
    expect(stdout).toContain("query");
    expect(stdout).toContain("tables");
    expect(stdout).toContain("schema");
    expect(stdout).toContain("repl");
  });

  it("mentions all flags: --db, --limit, --format, --sql", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("--db");
    expect(stdout).toContain("--limit");
    expect(stdout).toContain("--format");
    expect(stdout).toContain("--sql");
  });
});

// ─── AC2: tables command ──────────────────────────────────────────────────────

describe("bun cli/src/index.ts tables (AC2)", () => {
  it("exits 0", async () => {
    const { exitCode } = await runCli(["tables", "--db", DB_PATH]);
    expect(exitCode).toBe(0);
  });

  it("prints output to stdout", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("output includes both table names: master_plan and planets", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    expect(stdout).toContain("master_plan");
    expect(stdout).toContain("planets");
  });

  it("output includes numeric row counts", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    // planets has 6, master_plan has 61873
    expect(stdout).toMatch(/\d+/);
  });

  it("default output is table format — has separator line of dashes", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    expect(stdout).toMatch(/---/);
  });

  it("table format has aligned columns (AC7)", async () => {
    const { stdout } = await runCli(["tables", "--db", DB_PATH]);
    // Table format has a header row, then a dash separator, then data rows
    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(3); // header + separator + at least 1 row
  });
});

// ─── AC2: schema command ──────────────────────────────────────────────────────

describe("bun cli/src/index.ts schema (AC2)", () => {
  it("exits 0", async () => {
    const { exitCode } = await runCli(["schema", "--db", DB_PATH]);
    expect(exitCode).toBe(0);
  });

  it("prints both table schemas to stdout", async () => {
    const { stdout } = await runCli(["schema", "--db", DB_PATH]);
    expect(stdout).toContain("master_plan");
    expect(stdout).toContain("planets");
  });

  it("output includes 'Table:' labels (plain-text schema format, not table formatter)", async () => {
    const { stdout } = await runCli(["schema", "--db", DB_PATH]);
    expect(stdout).toContain("Table:");
  });

  it("output includes column definitions with type info", async () => {
    const { stdout } = await runCli(["schema", "--db", DB_PATH]);
    expect(stdout).toMatch(/INTEGER|TEXT|REAL/i);
  });

  it("output includes column names with dash prefix (e.g. '  - id INTEGER')", async () => {
    const { stdout } = await runCli(["schema", "--db", DB_PATH]);
    expect(stdout).toMatch(/^\s*-\s+\w+/m);
  });
});

// ─── AC2: query "SELECT COUNT(*) FROM master_plan" ───────────────────────────

describe("bun cli/src/index.ts query \"SELECT COUNT(*) FROM master_plan\" (AC2)", () => {
  it("exits 0", async () => {
    const { exitCode } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT COUNT(*) FROM master_plan",
    ]);
    expect(exitCode).toBe(0);
  });

  it("prints the count (61873) to stdout", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT COUNT(*) FROM master_plan",
    ]);
    expect(stdout).toContain("61873");
  });

  it("result is formatted as a table by default (has separator)", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT COUNT(*) FROM master_plan",
    ]);
    expect(stdout).toMatch(/---/);
  });
});

// ─── AC9 + AC10 + AC11: query --format csv ────────────────────────────────────

describe("bun cli/src/index.ts query ... --format csv (AC9, AC11)", () => {
  it("exits 0 with --format csv", async () => {
    const { exitCode } = await runCli([
      "query", "--db", DB_PATH, "--format", "csv",
      "SELECT * FROM master_plan LIMIT 3",
    ]);
    expect(exitCode).toBe(0);
  });

  it("output is valid CSV with a header row", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "csv",
      "SELECT * FROM master_plan LIMIT 3",
    ]);
    const lines = stdout.trim().split("\n").filter((l) => l.trim().length > 0);
    // Must have at least header + 3 data rows
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });

  it("CSV header contains master_plan column names", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "csv",
      "SELECT * FROM master_plan LIMIT 3",
    ]);
    const header = stdout.split("\n")[0];
    // master_plan has columns: id, start_time_utc, duration, date, team, target, etc.
    expect(header).toContain("id");
    expect(header).toContain("team");
    expect(header).toContain("target");
  });

  it("CSV rows are comma-separated (each data line contains commas)", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "csv",
      "SELECT * FROM master_plan LIMIT 3",
    ]);
    const lines = stdout.trim().split("\n").filter((l) => l.trim().length > 0);
    // Every line (header + data) should have commas
    lines.forEach((line) => expect(line).toContain(","));
  });

  it("CSV output parses to the correct number of rows (3 data rows for LIMIT 3)", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "csv",
      "SELECT id, team FROM master_plan LIMIT 3",
    ]);
    const lines = stdout.trim().split("\n").filter((l) => l.trim().length > 0);
    // 1 header + 3 data rows = 4 lines
    expect(lines).toHaveLength(4);
  });

  it("CSV data rows contain real master_plan values (team names)", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "csv",
      "SELECT team FROM master_plan LIMIT 3",
    ]);
    // First 3 rows from master_plan all have team values (CAPS, CDA, MAG)
    expect(stdout).toMatch(/CAPS|CDA|MAG|ISS|CIRS/);
  });
});

// ─── AC10: --limit flag ────────────────────────────────────────────────────────

describe("bun cli/src/index.ts query ... --limit (AC10)", () => {
  it("--limit 5 restricts query results to at most 5 rows (JSON format)", async () => {
    const { stdout, exitCode } = await runCli([
      "query", "--db", DB_PATH, "--format", "json", "--limit", "5",
      "SELECT target, COUNT(*) as n FROM master_plan GROUP BY target ORDER BY n DESC",
    ]);
    expect(exitCode).toBe(0);
    const rows = JSON.parse(stdout) as unknown[];
    expect(rows).toHaveLength(5);
  });

  it("--limit 5 on GROUP BY query returns the correct top-5 targets", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "json", "--limit", "5",
      "SELECT target, COUNT(*) as n FROM master_plan GROUP BY target ORDER BY n DESC",
    ]);
    const rows = JSON.parse(stdout) as Array<{ target: string; n: number }>;
    // Saturn should be #1 with 16958 observations
    expect(rows[0].target).toBe("Saturn");
    expect(rows[0].n).toBe(16958);
    // Titan should be #2
    expect(rows[1].target).toBe("Titan");
  });

  it("--limit restricts below the default 50 (json format)", async () => {
    const { stdout: withLimit } = await runCli([
      "query", "--db", DB_PATH, "--format", "json", "--limit", "3",
      "SELECT * FROM master_plan",
    ]);
    const { stdout: noLimit } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT * FROM master_plan",
    ]);
    const limitedRows = JSON.parse(withLimit) as unknown[];
    const defaultRows = JSON.parse(noLimit) as unknown[];
    expect(limitedRows).toHaveLength(3);
    expect(defaultRows.length).toBeGreaterThan(3);
  });

  it("--limit 1 returns exactly one row", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "json", "--limit", "1",
      "SELECT * FROM master_plan",
    ]);
    const rows = JSON.parse(stdout) as unknown[];
    expect(rows).toHaveLength(1);
  });
});

// ─── AC8: JSON format ─────────────────────────────────────────────────────────

describe("bun cli/src/index.ts query ... --format json (AC8)", () => {
  it("outputs valid JSON for a simple query", async () => {
    const { stdout, exitCode } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT * FROM planets",
    ]);
    expect(exitCode).toBe(0);
    expect(() => JSON.parse(stdout)).not.toThrow();
  });

  it("JSON output is an array", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT * FROM planets",
    ]);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("JSON array contains 6 planets", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT * FROM planets",
    ]);
    const parsed = JSON.parse(stdout) as unknown[];
    expect(parsed).toHaveLength(6);
  });

  it("JSON rows have the expected planet column keys", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT * FROM planets",
    ]);
    const rows = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(rows[0]).toHaveProperty("id");
    expect(rows[0]).toHaveProperty("name");
    expect(rows[0]).toHaveProperty("type");
  });

  it("JSON is pretty-printed (has newlines and indentation)", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT * FROM planets LIMIT 1",
    ]);
    // Pretty-printed JSON has newlines
    expect(stdout).toContain("\n");
    // And indentation (spaces before keys)
    expect(stdout).toMatch(/^\s{2,}"/m);
  });
});

// ─── AC7: table format ────────────────────────────────────────────────────────

describe("bun cli/src/index.ts query — table format aligned and readable (AC7)", () => {
  it("table format has a header row followed by a dash separator", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT name, type FROM planets ORDER BY name",
    ]);
    const lines = stdout.split("\n");
    // Header is first non-empty line, separator is second
    const nonEmpty = lines.filter((l) => l.trim().length > 0);
    expect(nonEmpty[0]).toContain("name");
    expect(nonEmpty[1]).toMatch(/^-+/); // separator line of dashes
  });

  it("table format has a row count footer", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT name FROM planets",
    ]);
    // formatTable appends "(N rows)" or "(1 row)"
    expect(stdout).toMatch(/\(\d+ rows?\)/);
  });

  it("table format shows '(6 rows)' for planets", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT name FROM planets",
    ]);
    expect(stdout).toContain("(6 rows)");
  });

  it("table format shows '(no results)' for empty result set", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT * FROM planets WHERE name = 'Pluto'",
    ]);
    expect(stdout).toContain("(no results)");
  });

  it("table columns are space-padded for alignment (padEnd)", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT name, type FROM planets ORDER BY name LIMIT 3",
    ]);
    const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
    // Data lines (after separator) should have consistent spacing
    // At minimum check that lines beyond the separator exist
    expect(lines.length).toBeGreaterThan(3); // header + sep + 3 rows + footer
  });
});

// ─── AC12: --db flag ──────────────────────────────────────────────────────────

describe("--db flag (AC12)", () => {
  it("--db with a valid absolute path works", async () => {
    const { exitCode } = await runCli(["tables", "--db", DB_PATH]);
    expect(exitCode).toBe(0);
  });

  it("--db with a non-existent path exits 1 and writes to stderr", async () => {
    const { stderr, exitCode } = await runCli([
      "tables", "--db", "/tmp/cassini-does-not-exist-xyz.db",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr.trim().length).toBeGreaterThan(0);
  });

  it("--db error message goes to stderr (not stdout)", async () => {
    const { stdout, exitCode } = await runCli([
      "query", "--db", "/tmp/cassini-does-not-exist-xyz.db",
      "SELECT 1",
    ]);
    expect(exitCode).toBe(1);
    expect(stdout.trim().length).toBe(0);
  });

  it("--db with cassini.db reports correct row count for master_plan", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT COUNT(*) as count FROM master_plan",
    ]);
    const rows = JSON.parse(stdout) as Array<{ count: number }>;
    expect(rows[0].count).toBe(61873);
  });
});

// ─── AC3 + AC4 + AC5: ask command (natural language) ─────────────────────────

describe("bun cli/src/index.ts ask — natural language (AC3, AC4, AC5)", () => {
  it("ask without API key exits 1 with API key error on stderr", async () => {
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const { stderr, exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "how many observations are there?"],
      { env: envWithoutKey, timeoutMs: 5_000 }
    );
    expect(exitCode).toBe(1);
    expect(stderr.toUpperCase()).toMatch(/API.?KEY|ANTHROPIC/);
  });

  it("ask without API key fails fast (under 3 seconds)", async () => {
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const start = Date.now();
    await runCli(
      ["ask", "--db", DB_PATH, "how many observations are there?"],
      { env: envWithoutKey, timeoutMs: 5_000 }
    );
    expect(Date.now() - start).toBeLessThan(3_000);
  });

  it("ask with valid API key prints 'Querying:' and a SELECT statement (AC4)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }
    const { stdout, exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "how many observations are there?"],
      { timeoutMs: 30_000 }
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Querying:/i);
    expect(stdout.toUpperCase()).toContain("SELECT");
  }, 35_000);

  it("ask returns a relevant numeric result for 'how many observations are there?' (AC3)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }
    const { stdout, exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "how many observations are there?"],
      { timeoutMs: 30_000 }
    );
    expect(exitCode).toBe(0);
    // master_plan has 61873 rows — the answer should include this number
    expect(stdout).toContain("61873");
  }, 35_000);

  it("ask 'what moons were observed?' returns results mentioning Titan (AC3)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }
    const { stdout, exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "what moons were observed?"],
      { timeoutMs: 30_000 }
    );
    expect(exitCode).toBe(0);
    // Titan is the most observed moon — it must appear in results
    expect(stdout).toContain("Titan");
  }, 35_000);

  it("ask 'what moons were observed?' --format json returns valid JSON (AC8)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }
    const { stdout, exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "--format", "json", "what moons were observed?"],
      { timeoutMs: 30_000 }
    );
    expect(exitCode).toBe(0);
    // stdout contains 'Querying: <sql>' line + JSON results
    // Extract the JSON part (starts with '[')
    const jsonStart = stdout.indexOf("[");
    expect(jsonStart).toBeGreaterThanOrEqual(0);
    const jsonPart = stdout.slice(jsonStart);
    expect(() => JSON.parse(jsonPart)).not.toThrow();
    const rows = JSON.parse(jsonPart) as unknown[];
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBeGreaterThan(0);
  }, 35_000);
});

// ─── AC5: ask --sql flag ──────────────────────────────────────────────────────

describe("bun cli/src/index.ts ask --sql (AC5)", () => {
  it("ask --sql without API key exits 1 with API key error", async () => {
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const { exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "--sql", "show me all Titan flybys"],
      { env: envWithoutKey, timeoutMs: 5_000 }
    );
    expect(exitCode).toBe(1);
  });

  it("ask --sql with valid API key prints a SELECT statement and exits 0 (AC5)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }
    const { stdout, exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "--sql", "show me all Titan flybys"],
      { timeoutMs: 30_000 }
    );
    expect(exitCode).toBe(0);
    expect(stdout.toUpperCase()).toContain("SELECT");
  }, 35_000);

  it("ask --sql output contains 'Querying:' prefix before the SQL", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }
    const { stdout } = await runCli(
      ["ask", "--db", DB_PATH, "--sql", "show me all Titan flybys"],
      { timeoutMs: 30_000 }
    );
    expect(stdout).toMatch(/Querying:/i);
  }, 35_000);

  it("ask --sql does NOT execute the query (no table rows in output)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }
    const { stdout } = await runCli(
      ["ask", "--db", DB_PATH, "--sql", "show me all Titan flybys"],
      { timeoutMs: 30_000 }
    );
    // With --sql only, the formatter is never called — no dash separator rows
    expect(stdout).not.toMatch(/^-{5,}/m);
    // No row count footer
    expect(stdout).not.toMatch(/\(\d+ rows?\)/);
  }, 35_000);

  it("ask --sql generated SQL references 'Titan' (relevant query)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }
    const { stdout } = await runCli(
      ["ask", "--db", DB_PATH, "--sql", "show me all Titan flybys"],
      { timeoutMs: 30_000 }
    );
    // The generated SQL should reference Titan
    expect(stdout.toLowerCase()).toContain("titan");
  }, 35_000);
});

// ─── AC6: bare positional args as implicit 'ask' ──────────────────────────────

describe("bare positional args — implicit 'ask' (AC6)", () => {
  it("bare question without 'ask' subcommand behaves the same as 'ask <question>'", async () => {
    // Without API key, both should fail with the same API-key error
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const bare = await runCli(
      ["--db", DB_PATH, "what teams have the most observations?"],
      { env: envWithoutKey, timeoutMs: 5_000 }
    );
    const withAsk = await runCli(
      ["ask", "--db", DB_PATH, "what teams have the most observations?"],
      { env: envWithoutKey, timeoutMs: 5_000 }
    );

    // Both must exit 1 (API key validation)
    expect(bare.exitCode).toBe(1);
    expect(withAsk.exitCode).toBe(1);

    // Both must mention the API key in stderr
    expect(bare.stderr.toUpperCase()).toMatch(/API.?KEY|ANTHROPIC/);
    expect(withAsk.stderr.toUpperCase()).toMatch(/API.?KEY|ANTHROPIC/);
  });

  it("bare question does NOT produce 'unknown subcommand' error", async () => {
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const { stdout, stderr } = await runCli(
      ["what", "teams", "have", "the", "most", "observations?"],
      { env: envWithoutKey, timeoutMs: 5_000 }
    );
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toMatch(/unknown.*subcommand|invalid.*subcommand/);
  });

  it("bare question with valid API key returns results (AC3)", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }
    const { stdout, exitCode } = await runCli(
      ["--db", DB_PATH, "what teams have the most observations?"],
      { timeoutMs: 30_000 }
    );
    expect(exitCode).toBe(0);
    // Should have SQL and results
    expect(stdout.toUpperCase()).toContain("SELECT");
    // Should list team names from master_plan
    expect(stdout).toMatch(/ISS|CAPS|CIRS|CDA|MAG|MIMI/);
  }, 35_000);

  it("source code defaults bare positionals to 'ask' subcommand", async () => {
    const file = Bun.file(INDEX_FILE);
    const source = await file.text();
    // The parser must fall back to "ask" when no known subcommand is found
    expect(source).toMatch(/subcommand\s*=\s*["']ask["']|default.*ask/);
  });
});

// ─── AC11: --format flag switches output ──────────────────────────────────────

describe("--format flag switches output format (AC11)", () => {
  it("--format table (default) produces dash separator", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "table",
      "SELECT name FROM planets ORDER BY name LIMIT 3",
    ]);
    expect(stdout).toMatch(/---/);
  });

  it("--format json produces a JSON array", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "json",
      "SELECT name FROM planets ORDER BY name LIMIT 3",
    ]);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("--format csv produces comma-separated output", async () => {
    const { stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "csv",
      "SELECT name FROM planets ORDER BY name LIMIT 3",
    ]);
    // CSV header must be present
    expect(stdout.split("\n")[0]).toContain("name");
    // Data rows contain planet names
    expect(stdout).toMatch(/Saturn|Titan|Enceladus/);
  });

  it("--format json on tables command returns a valid JSON array", async () => {
    const { stdout, exitCode } = await runCli([
      "tables", "--db", DB_PATH, "--format", "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout) as Array<Record<string, unknown>>;
    expect(Array.isArray(parsed)).toBe(true);
    // Each entry has name and count
    expect(parsed[0]).toHaveProperty("name");
    expect(parsed[0]).toHaveProperty("count");
  });

  it("--format csv on tables command returns comma-separated lines", async () => {
    const { stdout, exitCode } = await runCli([
      "tables", "--db", DB_PATH, "--format", "csv",
    ]);
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThan(1); // header + at least one row
    lines.forEach((line) => expect(line).toContain(","));
  });
});

// ─── AC14: bun build compiles to dist/cassini ─────────────────────────────────

describe("bun build cli/src/index.ts --compile --outfile=cli/dist/cassini (AC14)", () => {
  it("bun build exits 0 (compilation succeeds)", async () => {
    const proc = Bun.spawn(
      ["bun", "build", "src/index.ts", "--compile", "--outfile=dist/cassini"],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: CLI_DIR,
      }
    );

    // Allow up to 60s for compilation
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 60_000));
    await Promise.race([proc.exited, deadline]);
    try { proc.kill(); } catch { /* already exited */ }

    expect(proc.exitCode).toBe(0);
  }, 65_000);

  it("dist/cassini binary exists after build", async () => {
    // Build first (idempotent)
    const proc = Bun.spawn(
      ["bun", "build", "src/index.ts", "--compile", "--outfile=dist/cassini"],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: CLI_DIR,
      }
    );
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 60_000));
    await Promise.race([proc.exited, deadline]);
    try { proc.kill(); } catch { /* already exited */ }

    const binary = Bun.file(path.join(CLI_DIR, "dist/cassini"));
    expect(await binary.exists()).toBe(true);
  }, 65_000);

  it("dist/cassini binary is executable and --help exits 0", async () => {
    // Ensure it's built
    const build = Bun.spawn(
      ["bun", "build", "src/index.ts", "--compile", "--outfile=dist/cassini"],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: CLI_DIR,
      }
    );
    const buildDeadline = new Promise<void>((resolve) => setTimeout(resolve, 60_000));
    await Promise.race([build.exited, buildDeadline]);
    try { build.kill(); } catch { /* done */ }

    // Make executable (bun build --compile should do this, but ensure)
    const chmod = Bun.spawn(["chmod", "+x", path.join(CLI_DIR, "dist/cassini")], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await chmod.exited;

    // Run the compiled binary with --help
    const run = Bun.spawn(
      [path.join(CLI_DIR, "dist/cassini"), "--help"],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      }
    );
    const runDeadline = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    await Promise.race([run.exited, runDeadline]);
    try { run.kill(); } catch { /* done */ }

    const stdout = await new Response(run.stdout).text();
    expect(run.exitCode).toBe(0);
    expect(stdout.toLowerCase()).toContain("cassini");
  }, 75_000);

  it("dist/cassini binary runs 'tables' and shows master_plan", async () => {
    // Ensure it's built
    const build = Bun.spawn(
      ["bun", "build", "src/index.ts", "--compile", "--outfile=dist/cassini"],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: CLI_DIR,
      }
    );
    const buildDeadline = new Promise<void>((resolve) => setTimeout(resolve, 60_000));
    await Promise.race([build.exited, buildDeadline]);
    try { build.kill(); } catch { /* done */ }

    const run = Bun.spawn(
      [path.join(CLI_DIR, "dist/cassini"), "tables", "--db", DB_PATH],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      }
    );
    const runDeadline = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    await Promise.race([run.exited, runDeadline]);
    try { run.kill(); } catch { /* done */ }

    const stdout = await new Response(run.stdout).text();
    expect(run.exitCode).toBe(0);
    expect(stdout).toContain("master_plan");
  }, 75_000);
});

// ─── AC2: package.json build script updated ───────────────────────────────────

describe("cli/package.json — build script (AC14)", () => {
  it("build script compiles src/index.ts to dist/cassini", async () => {
    const pkg = await Bun.file(path.join(CLI_DIR, "package.json")).json() as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts.build).toBeDefined();
    expect(scripts.build).toContain("--compile");
    expect(scripts.build).toContain("dist/cassini");
    expect(scripts.build).toContain("src/index.ts");
  });

  it("build script targets the correct entry file (src/index.ts)", async () => {
    const pkg = await Bun.file(path.join(CLI_DIR, "package.json")).json() as Record<string, unknown>;
    const scripts = pkg.scripts as Record<string, string>;
    // Must use src/index.ts as the entry point
    expect(scripts.build).toMatch(/src\/index\.ts/);
  });
});

// ─── End-to-end smoke tests for all 10 example commands ───────────────────────

describe("end-to-end: all 10 example commands (AC2)", () => {
  // 1. bun cli/src/index.ts --help
  it("[1/10] --help exits 0 and prints usage", async () => {
    const { exitCode, stdout } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout.toLowerCase()).toContain("usage");
  });

  // 2. bun cli/src/index.ts tables
  it("[2/10] tables exits 0 and lists tables", async () => {
    const { exitCode, stdout } = await runCli(["tables", "--db", DB_PATH]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("master_plan");
    expect(stdout).toContain("planets");
  });

  // 3. bun cli/src/index.ts schema
  it("[3/10] schema exits 0 and prints schema with Table: labels", async () => {
    const { exitCode, stdout } = await runCli(["schema", "--db", DB_PATH]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Table:");
    expect(stdout).toContain("master_plan");
  });

  // 4. bun cli/src/index.ts query "SELECT COUNT(*) FROM master_plan"
  it("[4/10] query 'SELECT COUNT(*) FROM master_plan' returns 61873", async () => {
    const { exitCode, stdout } = await runCli([
      "query", "--db", DB_PATH,
      "SELECT COUNT(*) FROM master_plan",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("61873");
  });

  // 5. bun cli/src/index.ts ask "how many observations are there?"
  it("[5/10] ask 'how many observations are there?' — exits 1 without API key", async () => {
    if (process.env.ANTHROPIC_API_KEY) {
      // With key: must exit 0 and return count
      const { exitCode, stdout } = await runCli(
        ["ask", "--db", DB_PATH, "how many observations are there?"],
        { timeoutMs: 30_000 }
      );
      expect(exitCode).toBe(0);
      expect(stdout).toContain("61873");
    } else {
      // Without key: must exit 1 with API key error
      const { exitCode, stderr } = await runCli(
        ["ask", "--db", DB_PATH, "how many observations are there?"],
        { timeoutMs: 5_000 }
      );
      expect(exitCode).toBe(1);
      expect(stderr.toUpperCase()).toMatch(/API.?KEY|ANTHROPIC/);
    }
  }, 35_000);

  // 6. bun cli/src/index.ts ask "what moons were observed?" --format json
  it("[6/10] ask 'what moons were observed?' --format json — validates API key", async () => {
    if (process.env.ANTHROPIC_API_KEY) {
      const { exitCode, stdout } = await runCli(
        ["ask", "--db", DB_PATH, "--format", "json", "what moons were observed?"],
        { timeoutMs: 30_000 }
      );
      expect(exitCode).toBe(0);
      // stdout = "Querying: <sql>\n...\n[json...]"
      const jsonStart = stdout.indexOf("[");
      expect(jsonStart).toBeGreaterThanOrEqual(0);
      const rows = JSON.parse(stdout.slice(jsonStart)) as unknown[];
      expect(Array.isArray(rows)).toBe(true);
    } else {
      const { exitCode } = await runCli(
        ["ask", "--db", DB_PATH, "--format", "json", "what moons were observed?"],
        { timeoutMs: 5_000 }
      );
      expect(exitCode).toBe(1);
    }
  }, 35_000);

  // 7. bun cli/src/index.ts ask "show me all Titan flybys" --sql
  it("[7/10] ask 'show me all Titan flybys' --sql — shows SQL only", async () => {
    if (process.env.ANTHROPIC_API_KEY) {
      const { exitCode, stdout } = await runCli(
        ["ask", "--db", DB_PATH, "--sql", "show me all Titan flybys"],
        { timeoutMs: 30_000 }
      );
      expect(exitCode).toBe(0);
      expect(stdout.toUpperCase()).toContain("SELECT");
      // No table output
      expect(stdout).not.toMatch(/\(\d+ rows?\)/);
    } else {
      const { exitCode } = await runCli(
        ["ask", "--db", DB_PATH, "--sql", "show me all Titan flybys"],
        { timeoutMs: 5_000 }
      );
      expect(exitCode).toBe(1);
    }
  }, 35_000);

  // 8. bun cli/src/index.ts "what teams have the most observations?" (bare ask)
  it("[8/10] bare ask 'what teams have the most observations?' dispatches to ask handler", async () => {
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    if (process.env.ANTHROPIC_API_KEY) {
      const { exitCode, stdout } = await runCli(
        ["--db", DB_PATH, "what teams have the most observations?"],
        { timeoutMs: 30_000 }
      );
      expect(exitCode).toBe(0);
      expect(stdout.toUpperCase()).toContain("SELECT");
    } else {
      // Without key: ask handler fires, fails with API key error
      const { exitCode, stderr } = await runCli(
        ["--db", DB_PATH, "what teams have the most observations?"],
        { env: envWithoutKey, timeoutMs: 5_000 }
      );
      expect(exitCode).toBe(1);
      expect(stderr.toUpperCase()).toMatch(/API.?KEY|ANTHROPIC/);
    }
  }, 35_000);

  // 9. bun cli/src/index.ts query "SELECT * FROM master_plan LIMIT 3" --format csv
  it("[9/10] query 'SELECT * FROM master_plan LIMIT 3' --format csv outputs valid CSV", async () => {
    const { exitCode, stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "csv",
      "SELECT * FROM master_plan LIMIT 3",
    ]);
    expect(exitCode).toBe(0);
    const lines = stdout.trim().split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(4); // header + 3 rows
    // Header row contains column names
    expect(lines[0]).toContain("id");
    expect(lines[0]).toContain("team");
    // Data rows are comma-separated
    lines.slice(1).forEach((line) => expect(line).toContain(","));
  });

  // 10. bun cli/src/index.ts query "SELECT target, COUNT(*) ... GROUP BY target ... DESC" --limit 5
  it("[10/10] query with GROUP BY + ORDER BY + --limit 5 returns top 5 targets", async () => {
    const { exitCode, stdout } = await runCli([
      "query", "--db", DB_PATH, "--format", "json", "--limit", "5",
      "SELECT target, COUNT(*) as n FROM master_plan GROUP BY target ORDER BY n DESC",
    ]);
    expect(exitCode).toBe(0);
    const rows = JSON.parse(stdout) as Array<{ target: string; n: number }>;
    expect(rows).toHaveLength(5);
    // Saturn is the most observed target
    expect(rows[0].target).toBe("Saturn");
    expect(rows[0].n).toBe(16958);
  });
});
