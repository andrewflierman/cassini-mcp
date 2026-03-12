/**
 * Tests for task: cli-repl — Create cli/src/repl.ts with interactive REPL mode
 *
 * Task: cli-repl
 * Run with: bun test tests/cli-repl.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. cli/src/repl.ts is created and exports a startRepl function
 *   2. The REPL prints a welcome banner and prompts with 'cassini> '
 *   3. Natural language input is translated to SQL via the AI pipeline and results displayed
 *   4. SQL input (SELECT/PRAGMA/EXPLAIN/WITH) is executed directly
 *   5. Generated SQL is printed (dimmed) before results for NL queries
 *   6. All dot-commands work: .help, .tables, .schema, .format, .limit, .sql, .quit, .exit
 *   7. .format switches output format for subsequent queries
 *   8. Errors are caught and printed without crashing
 *   9. Ctrl+C and Ctrl+D exit cleanly
 *  10. Warns if ANTHROPIC_API_KEY is missing but allows raw SQL
 */

import { describe, it, expect } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const CLI_DIR = path.join(ROOT, "cli");
const REPL_FILE = path.join(CLI_DIR, "src/repl.ts");
const DB_PATH = path.join(ROOT, "cassini.db");

// ─── Helper: spawn CLI with piped stdin ───────────────────────────────────────

/**
 * Spawns the REPL via `cassini repl`, writes lines to stdin, then closes stdin
 * (simulating EOF / Ctrl+D). Returns combined stdout + stderr after the process
 * exits (or after the timeout fires).
 */
async function runRepl(
  lines: string[],
  opts: {
    env?: Record<string, string>;
    timeoutMs?: number;
    dbPath?: string;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = opts.env ?? (process.env as Record<string, string>);
  const timeoutMs = opts.timeoutMs ?? 8_000;
  const dbPath = opts.dbPath ?? DB_PATH;

  const proc = Bun.spawn(
    ["bun", path.join(CLI_DIR, "src/index.ts"), "repl", "--db", dbPath],
    {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      cwd: ROOT,
      env,
    }
  );

  // Write all lines, then close stdin to signal EOF (Ctrl+D equivalent)
  const input = lines.join("\n") + "\n";
  proc.stdin.write(input);
  proc.stdin.end();

  // Race between natural exit and timeout
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([proc.exited, deadline]);
  try { proc.kill(); } catch { /* already exited */ }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = proc.exitCode ?? 0;

  return { stdout, stderr, exitCode };
}

// ─── AC1: cli/src/repl.ts — file existence and exports ───────────────────────

describe("cli/src/repl.ts — file existence and exports (AC1)", () => {
  it("cli/src/repl.ts exists", async () => {
    const file = Bun.file(REPL_FILE);
    expect(await file.exists()).toBe(true);
  });

  it("source exports startRepl as a named export", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    expect(source).toMatch(
      /export\s+(async\s+)?function\s+startRepl|export\s*\{[^}]*startRepl/
    );
  });

  it("startRepl is callable after import", async () => {
    const mod = await import(REPL_FILE);
    expect(typeof mod.startRepl).toBe("function");
  });
});

// ─── AC1 (source): imports from local modules ─────────────────────────────────

describe("cli/src/repl.ts — source imports (AC1)", () => {
  it("imports from ./db (local module)", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    expect(source).toMatch(/from ["']\.\/db(\.js|\.ts)?["']/);
  });

  it("imports from ./formatter (local module)", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    expect(source).toMatch(/from ["']\.\/formatter(\.js|\.ts)?["']/);
  });

  it("does NOT import from ../mcp/ (no cross-package imports)", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    expect(source).not.toContain("../mcp/");
  });

  it("does NOT import readline from node — uses Bun built-in or process.stdin", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Must NOT import the Node readline module (no external deps rule)
    expect(source).not.toMatch(/from ['"]readline['"]/);
    expect(source).not.toMatch(/require\(['"]readline['"]\)/);
  });
});

// ─── AC2: welcome banner and prompt ───────────────────────────────────────────

describe("REPL — welcome banner and prompt (AC2)", () => {
  it("prints the welcome banner on startup", async () => {
    const { stdout } = await runRepl([".quit"]);
    expect(stdout).toContain("Cassini DB");
    expect(stdout.toLowerCase()).toContain("interactive");
  });

  it("banner mentions 'English' or 'natural language'", async () => {
    const { stdout } = await runRepl([".quit"]);
    expect(stdout.toLowerCase()).toMatch(/english|natural language/);
  });

  it("banner mentions SQL", async () => {
    const { stdout } = await runRepl([".quit"]);
    expect(stdout.toUpperCase()).toContain("SQL");
  });

  it("prints the 'cassini> ' prompt", async () => {
    const { stdout } = await runRepl([".quit"]);
    expect(stdout).toContain("cassini>");
  });
});

// ─── AC4: direct SQL execution ────────────────────────────────────────────────

describe("REPL — direct SQL execution (AC4)", () => {
  it("SELECT query returns results and exits cleanly", async () => {
    const { stdout, exitCode } = await runRepl([
      "SELECT name FROM planets ORDER BY name LIMIT 3",
      ".quit",
    ]);
    // Should contain at least one planet name
    expect(stdout).toMatch(/Saturn|Titan|Enceladus|Dione|Rhea|Tethys/);
    expect(exitCode).toBe(0);
  });

  it("PRAGMA (case-insensitive) is treated as SQL and executed", async () => {
    const { stdout } = await runRepl([
      "PRAGMA table_info(planets)",
      ".quit",
    ]);
    // PRAGMA result should include column metadata (e.g. 'name', 'type' columns)
    expect(stdout).toMatch(/name|cid|type/i);
  });

  it("select (lowercase) is treated as SQL and executed", async () => {
    const { stdout } = await runRepl([
      "select count(*) from planets",
      ".quit",
    ]);
    // Should return a count — planets has 6 rows
    expect(stdout).toMatch(/\d+/);
  });

  it("EXPLAIN keyword triggers direct SQL execution", async () => {
    const { stdout } = await runRepl([
      "EXPLAIN SELECT * FROM planets",
      ".quit",
    ]);
    // EXPLAIN output is some kind of result from SQLite
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("WITH (CTE) keyword triggers direct SQL execution", async () => {
    const { stdout } = await runRepl([
      "WITH p AS (SELECT name FROM planets) SELECT * FROM p LIMIT 2",
      ".quit",
    ]);
    expect(stdout).toMatch(/Saturn|Titan|Enceladus|Dione|Rhea|Tethys/);
  });
});

// ─── AC6: dot-commands ────────────────────────────────────────────────────────

describe("REPL — .help dot-command (AC6)", () => {
  it(".help prints available commands", async () => {
    const { stdout } = await runRepl([".help", ".quit"]);
    // Should list the known dot-commands
    expect(stdout.toLowerCase()).toContain(".help");
  });

  it(".help output includes .tables", async () => {
    const { stdout } = await runRepl([".help", ".quit"]);
    expect(stdout).toContain(".tables");
  });

  it(".help output includes .schema", async () => {
    const { stdout } = await runRepl([".help", ".quit"]);
    expect(stdout).toContain(".schema");
  });

  it(".help output includes .format", async () => {
    const { stdout } = await runRepl([".help", ".quit"]);
    expect(stdout).toContain(".format");
  });

  it(".help output includes .limit", async () => {
    const { stdout } = await runRepl([".help", ".quit"]);
    expect(stdout).toContain(".limit");
  });

  it(".help output includes .sql", async () => {
    const { stdout } = await runRepl([".help", ".quit"]);
    expect(stdout).toContain(".sql");
  });

  it(".help output includes .quit or .exit", async () => {
    const { stdout } = await runRepl([".help", ".quit"]);
    expect(stdout).toMatch(/\.quit|\.exit/);
  });
});

describe("REPL — .tables dot-command (AC6)", () => {
  it(".tables lists table names", async () => {
    const { stdout } = await runRepl([".tables", ".quit"]);
    expect(stdout).toContain("planets");
    expect(stdout).toContain("master_plan");
  });

  it(".tables shows row counts (numeric values present)", async () => {
    const { stdout } = await runRepl([".tables", ".quit"]);
    expect(stdout).toMatch(/\d+/);
  });
});

describe("REPL — .schema dot-command (AC6)", () => {
  it(".schema prints the database schema", async () => {
    const { stdout } = await runRepl([".schema", ".quit"]);
    expect(stdout).toContain("planets");
    expect(stdout).toContain("master_plan");
  });

  it(".schema output includes column type information", async () => {
    const { stdout } = await runRepl([".schema", ".quit"]);
    expect(stdout).toMatch(/INTEGER|TEXT|REAL|NUMERIC/i);
  });
});

describe("REPL — .quit and .exit dot-commands (AC6)", () => {
  it(".quit exits with code 0", async () => {
    const { exitCode } = await runRepl([".quit"]);
    expect(exitCode).toBe(0);
  });

  it(".exit exits with code 0", async () => {
    const { exitCode } = await runRepl([".exit"]);
    expect(exitCode).toBe(0);
  });

  it(".quit prints a goodbye or bye message", async () => {
    const { stdout } = await runRepl([".quit"]);
    // Should say something on exit — "bye", "goodbye", "exit", or similar
    expect(stdout.toLowerCase()).toMatch(/bye|goodbye|exit|quit/);
  });
});

// ─── AC6 + AC7: .format dot-command ──────────────────────────────────────────

describe("REPL — .format dot-command (AC6, AC7)", () => {
  it(".format json switches subsequent query output to JSON", async () => {
    const { stdout } = await runRepl([
      ".format json",
      "SELECT name FROM planets ORDER BY name LIMIT 2",
      ".quit",
    ]);
    // After switching to json, the result should be valid JSON (starts with [)
    // Extract the part after the prompt lines
    expect(stdout).toContain("[");
    expect(stdout).toContain("]");
    // JSON output should contain a planet name in JSON form (with quotes)
    expect(stdout).toMatch(/"(Saturn|Titan|Enceladus|Dione|Rhea|Tethys)"/);
  });

  it(".format csv switches subsequent query output to CSV", async () => {
    const { stdout } = await runRepl([
      ".format csv",
      "SELECT name FROM planets ORDER BY name LIMIT 2",
      ".quit",
    ]);
    // CSV output: header row + data rows, comma-separated
    // After format switch, planets should appear with CSV commas or headers
    expect(stdout).toContain("name");
    // Data in CSV — planet names without JSON quotes (just plain values)
    expect(stdout).toMatch(/Enceladus|Dione/);
  });

  it(".format table switches back to table format", async () => {
    const { stdout } = await runRepl([
      ".format json",
      ".format table",
      "SELECT name FROM planets LIMIT 2",
      ".quit",
    ]);
    // Table format has a dash separator line
    expect(stdout).toMatch(/---/);
  });

  it(".format with invalid value prints an error without crashing", async () => {
    const { stdout, stderr, exitCode } = await runRepl([
      ".format invalid",
      ".quit",
    ]);
    const combined = stdout + stderr;
    // Should print an error mentioning valid formats
    expect(combined.toLowerCase()).toMatch(/error|invalid|table|json|csv/);
    // Must not crash — should exit cleanly
    expect(exitCode).toBe(0);
  });
});

// ─── AC6: .limit dot-command ──────────────────────────────────────────────────

describe("REPL — .limit dot-command (AC6)", () => {
  it(".limit <n> changes the row limit for subsequent queries (json format)", async () => {
    const { stdout } = await runRepl([
      ".format json",
      ".limit 2",
      "SELECT * FROM master_plan",
      ".quit",
    ]);
    // After .limit 2, only 2 rows should be returned from the large master_plan table
    // Parse the JSON array from output — be lenient about surrounding text
    const jsonMatch = stdout.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as unknown[];
      expect(parsed.length).toBeLessThanOrEqual(2);
    } else {
      // JSON block not found means .limit didn't work — fail
      expect(jsonMatch).not.toBeNull();
    }
  });

  it(".limit with invalid value prints error without crashing", async () => {
    const { stdout, stderr, exitCode } = await runRepl([
      ".limit notanumber",
      ".quit",
    ]);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).toMatch(/error|invalid|number/);
    // Should continue running — clean exit via .quit
    expect(exitCode).toBe(0);
  });

  it(".limit with negative value prints error without crashing", async () => {
    const { stdout, stderr, exitCode } = await runRepl([
      ".limit -5",
      ".quit",
    ]);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).toMatch(/error|invalid|positive/);
    expect(exitCode).toBe(0);
  });
});

// ─── AC6: .sql toggle ─────────────────────────────────────────────────────────

describe("REPL — .sql toggle dot-command (AC6)", () => {
  it("source code references .sql toggle handling", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Must handle the .sql command in some branch
    expect(source).toMatch(/["']\.sql["']|\.sql/);
  });

  it(".sql command prints a toggle-state confirmation without crashing", async () => {
    const { stdout, stderr, exitCode } = await runRepl([".sql", ".quit"]);
    const combined = stdout + stderr;
    // Should acknowledge the toggle — mention sql or show/hide
    expect(combined.toLowerCase()).toMatch(/sql|show|hide|toggle|on|off/);
    expect(exitCode).toBe(0);
  });
});

// ─── AC8: error handling — print error, continue ─────────────────────────────

describe("REPL — error handling (AC8)", () => {
  it("bad SQL prints an error but does not crash (subsequent commands work)", async () => {
    const { stdout, stderr, exitCode } = await runRepl([
      "SELECT * FROM table_that_does_not_exist_xyz",
      // After the error, the REPL should still be alive and process .quit
      ".quit",
    ]);
    // An error must have been reported somewhere
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).toMatch(/error|no such table|not found/);
    // Process must exit cleanly via .quit (not crash with code > 1)
    expect(exitCode).toBe(0);
  });

  it("invalid SQL syntax prints an error and continues", async () => {
    const { stdout, stderr, exitCode } = await runRepl([
      "SELECT ??? FROM ???",
      ".quit",
    ]);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).toMatch(/error|syntax/);
    expect(exitCode).toBe(0);
  });

  it("error output does not crash the process (exit code is 0 after recovery)", async () => {
    const { exitCode } = await runRepl([
      "SELECT * FROM nonexistent_table",
      "SELECT name FROM planets LIMIT 1",
      ".quit",
    ]);
    expect(exitCode).toBe(0);
  });

  it("after a SQL error, subsequent valid SQL still runs", async () => {
    const { stdout } = await runRepl([
      "SELECT * FROM no_such_table",
      "SELECT name FROM planets ORDER BY name LIMIT 1",
      ".quit",
    ]);
    // The second query (valid) should produce a planet name in output
    expect(stdout).toMatch(/Saturn|Titan|Enceladus|Dione|Rhea|Tethys/);
  });
});

// ─── AC9: Ctrl+D (EOF) exits cleanly ─────────────────────────────────────────

describe("REPL — Ctrl+D (EOF) exits cleanly (AC9)", () => {
  it("EOF on stdin exits with code 0", async () => {
    // runRepl closes stdin after the provided lines — sending no lines
    // means immediate EOF, simulating Ctrl+D
    const { exitCode } = await runRepl([]);
    expect(exitCode).toBe(0);
  });

  it("EOF after some commands exits cleanly", async () => {
    const { exitCode } = await runRepl([
      "SELECT name FROM planets LIMIT 1",
      // stdin closes → EOF → clean exit
    ]);
    expect(exitCode).toBe(0);
  });
});

// ─── AC10: API key warning ────────────────────────────────────────────────────

describe("REPL — API key warning (AC10)", () => {
  it("warns when ANTHROPIC_API_KEY is missing, but does not exit immediately", async () => {
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const { stdout, stderr } = await runRepl(
      [".quit"],
      { env: envWithoutKey }
    );
    const combined = stdout + stderr;
    // Should print a warning mentioning the missing API key
    expect(combined.toUpperCase()).toMatch(/ANTHROPIC_API_KEY|API.?KEY|WARNING|WARN/);
  });

  it("without API key, raw SQL still executes successfully", async () => {
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const { stdout, exitCode } = await runRepl(
      ["SELECT name FROM planets ORDER BY name LIMIT 1", ".quit"],
      { env: envWithoutKey }
    );
    // Raw SQL must still work even without an API key
    expect(stdout).toMatch(/Saturn|Titan|Enceladus|Dione|Rhea|Tethys/);
    expect(exitCode).toBe(0);
  });

  it("without API key, REPL starts and shows banner (does not hard-exit)", async () => {
    const envWithoutKey: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k !== "ANTHROPIC_API_KEY" && v !== undefined) {
        envWithoutKey[k] = v;
      }
    }
    envWithoutKey.ANTHROPIC_API_KEY = "";

    const { stdout } = await runRepl(
      [".quit"],
      { env: envWithoutKey }
    );
    // Banner must still appear even when key is missing
    expect(stdout).toContain("Cassini DB");
  });
});

// ─── AC3 + AC5: Natural language via AI pipeline ──────────────────────────────

describe("REPL — natural language queries via AI (AC3, AC5)", () => {
  it("source code imports naturalLanguageToSql or ai module for NL handling", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Must import from the ai module to handle NL queries
    expect(source).toMatch(/naturalLanguageToSql|from ["']\.\/ai(\.js|\.ts)?["']/);
  });

  it("source code checks if input starts with SQL keywords to decide execution path", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Must detect SELECT/PRAGMA/EXPLAIN/WITH (case-insensitive)
    expect(source).toMatch(/SELECT|PRAGMA|EXPLAIN|WITH/i);
    // Must use a regex or startsWith check against the input
    expect(source).toMatch(/startsWith|test\(|match\(|\.trim\(\)/);
  });

  it("source code prints the generated SQL before results for NL queries", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Must print the SQL for NL queries — look for dimmed/print reference near sql variable
    // The task says "print the generated SQL (dimmed)" — must reference the sql result
    expect(source).toMatch(/\.sql|sql\b.*print|console.*sql|dim/i);
  });

  it("NL query with valid API key prints generated SQL and results", async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.log("  [skip] ANTHROPIC_API_KEY not set");
      return;
    }

    const { stdout, exitCode } = await runRepl(
      ["how many planets are in the database?", ".quit"],
      { timeoutMs: 30_000 }
    );

    // Should print the generated SQL (the query)
    expect(stdout.toUpperCase()).toContain("SELECT");
    // Should show some numeric result
    expect(stdout).toMatch(/\d/);
    expect(exitCode).toBe(0);
  }, 35_000);
});

// ─── index.ts wiring: 'cassini repl' dispatches to startRepl ─────────────────

describe("cli/src/index.ts — wires up repl (AC1)", () => {
  it("index.ts imports startRepl from ./repl", async () => {
    const file = Bun.file(path.join(CLI_DIR, "src/index.ts"));
    const source = await file.text();
    expect(source).toMatch(/startRepl|from ["']\.\/repl(\.js|\.ts)?["']/);
  });

  it("index.ts dispatches 'repl' subcommand to startRepl (not the stub handler)", async () => {
    const file = Bun.file(path.join(CLI_DIR, "src/index.ts"));
    const source = await file.text();
    // The repl case should call startRepl, not the old stub console.log
    expect(source).toContain("startRepl");
    // The old stub must be gone
    expect(source).not.toContain("[repl] Starting interactive REPL");
  });

  it("'cassini repl' exits 0 when given .quit via stdin", async () => {
    const { exitCode } = await runRepl([".quit"]);
    expect(exitCode).toBe(0);
  });
});

// ─── Source structure: REPL state machine ────────────────────────────────────

describe("cli/src/repl.ts — source structure", () => {
  it("startRepl function is async", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    expect(source).toMatch(/async\s+function\s+startRepl|startRepl\s*=\s*async/);
  });

  it("handles process.stdin for reading lines", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Uses process.stdin (Bun's built-in readline approach)
    expect(source).toMatch(/process\.stdin|stdin/);
  });

  it("tracks a mutable format state variable", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Format starts as 'table' and can be switched — must be a mutable variable
    expect(source).toMatch(/let\s+\w*[Ff]ormat|format\s*=/);
  });

  it("tracks a mutable limit state variable", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Limit starts at some default and can be changed with .limit
    expect(source).toMatch(/let\s+\w*[Ll]imit|limit\s*=/);
  });

  it("tracks a mutable showSql state variable for .sql toggle", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // .sql toggles showing/hiding the generated SQL
    expect(source).toMatch(/let\s+\w*[Ss]how[Ss]ql|showSql\s*=|let\s+show/i);
  });

  it("handles SIGINT (Ctrl+C) for clean exit", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Must register a SIGINT handler or handle it via readline/stdin
    expect(source).toMatch(/SIGINT|process\.on\(['"]SIGINT/);
  });
});
