/**
 * Tests for task: refactor-callers — Update commands.ts and repl.ts for new AI interface
 *
 * Task: refactor-callers
 * Run with: bun test tests/refactor-callers.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. commands.ts imports and calls validateClaude instead of validateApiKey
 *   2. repl.ts warns about missing claude CLI instead of missing ANTHROPIC_API_KEY
 *   3. handleAsk still validates before calling the AI
 *   4. REPL still allows raw SQL when claude CLI is unavailable
 */

import { describe, it, expect } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const CLI_DIR = path.join(ROOT, "cli");
const COMMANDS_FILE = path.join(CLI_DIR, "src/commands.ts");
const REPL_FILE = path.join(CLI_DIR, "src/repl.ts");
const DB_PATH = path.join(ROOT, "cassini.db");

// Use the absolute path to the bun binary (same pattern as refactor-ai.spec.ts)
const BUN_BIN = process.execPath;

// ─── Helper: spawn the REPL with piped stdin ─────────────────────────────────

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
    [BUN_BIN, path.join(CLI_DIR, "src/index.ts"), "repl", "--db", dbPath],
    {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
      cwd: ROOT,
      env,
    }
  );

  const input = lines.join("\n") + "\n";
  proc.stdin.write(input);
  proc.stdin.end();

  const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([proc.exited, deadline]);
  try { proc.kill(); } catch { /* already exited */ }

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = proc.exitCode ?? 0;

  return { stdout, stderr, exitCode };
}

// ─── Helper: spawn the full CLI ───────────────────────────────────────────────

async function runCli(
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = opts.env ?? (process.env as Record<string, string>);
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const proc = Bun.spawn(
    [BUN_BIN, path.join(CLI_DIR, "src/index.ts"), ...args],
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

// ─── AC1: commands.ts imports validateClaude (not validateApiKey) ─────────────

describe("cli/src/commands.ts — imports validateClaude (AC1)", () => {
  it("source imports 'validateClaude' from ./ai", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("validateClaude");
  });

  it("source does NOT import 'validateApiKey' (old name removed)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).not.toContain("validateApiKey");
  });

  it("import statement references './ai' as the module source", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toMatch(/from ["']\.\/ai(\.js|\.ts)?["']/);
  });

  it("validateClaude appears in the import { ... } list from ./ai", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    // The import must destructure validateClaude from ./ai
    expect(source).toMatch(/import\s*\{[^}]*validateClaude[^}]*\}\s*from ["']\.\/ai/);
  });
});

// ─── AC1 + AC3: commands.ts calls validateClaude() in handleAsk ──────────────

describe("cli/src/commands.ts — calls validateClaude() in handleAsk (AC1, AC3)", () => {
  it("source calls validateClaude() (with parentheses)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toMatch(/validateClaude\s*\(\s*\)/);
  });

  it("validateClaude() call appears before naturalLanguageToSql in source order", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    const validateIdx = source.indexOf("validateClaude()");
    const nlsIdx = source.indexOf("naturalLanguageToSql");
    // validateClaude must be called before the AI call (fast-fail pattern)
    expect(validateIdx).toBeGreaterThanOrEqual(0);
    expect(nlsIdx).toBeGreaterThanOrEqual(0);
    expect(validateIdx).toBeLessThan(nlsIdx);
  });

  it("ask command exits 1 when claude CLI is not on PATH (fast-fail)", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { exitCode } = await runCli(
      ["ask", "--db", DB_PATH, "how many planets are there?"],
      { env: envWithoutClaude, timeoutMs: 8_000 }
    );
    expect(exitCode).toBe(1);
  }, 12_000);

  it("ask command prints an error to stderr when claude CLI is missing", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stderr } = await runCli(
      ["ask", "--db", DB_PATH, "how many planets are there?"],
      { env: envWithoutClaude, timeoutMs: 8_000 }
    );
    expect(stderr.trim().length).toBeGreaterThan(0);
  }, 12_000);

  it("ask command does NOT check ANTHROPIC_API_KEY (commands.ts source)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    // The validation in commands.ts must use validateClaude, not ANTHROPIC_API_KEY
    expect(source).not.toContain("ANTHROPIC_API_KEY");
  });
});

// ─── AC2: repl.ts warns about missing claude CLI, not missing ANTHROPIC_API_KEY

describe("cli/src/repl.ts — warns about claude CLI, not ANTHROPIC_API_KEY (AC2)", () => {
  it("source does NOT check ANTHROPIC_API_KEY env var for the warning", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // The old warning checked process.env.ANTHROPIC_API_KEY — this must be gone
    expect(source).not.toContain("ANTHROPIC_API_KEY");
  });

  it("source imports validateClaude from ./ai", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    expect(source).toContain("validateClaude");
    expect(source).toMatch(/from ["']\.\/ai(\.js|\.ts)?["']/);
  });

  it("source calls validateClaude() to determine CLI availability", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    expect(source).toMatch(/validateClaude\s*\(\s*\)/);
  });

  it("warning message mentions 'claude' CLI (not ANTHROPIC_API_KEY)", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // The warning text must reference the claude CLI
    // Look for a warning string that mentions claude near the validateClaude check
    expect(source.toLowerCase()).toMatch(/claude.*cli|cli.*not.*available|claude.*not.*available/);
  });

  it("warning message mentions that raw SQL still works", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    // Must reassure user that SQL still works even without the claude CLI
    expect(source.toLowerCase()).toMatch(/raw sql|sql.*still|still.*sql|sql.*work/);
  });
});

// ─── AC2: REPL runtime behavior — warns about missing claude CLI ──────────────

describe("REPL — runtime warning when claude CLI is unavailable (AC2)", () => {
  it("REPL warns when claude CLI is not on PATH", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stdout, stderr } = await runRepl(
      [".quit"],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    const combined = stdout + stderr;
    // Must warn that the claude CLI is not available (not that ANTHROPIC_API_KEY is missing)
    expect(combined.toLowerCase()).toMatch(/claude.*cli|claude.*not.*available|cli.*not.*available/);
  }, 14_000);

  it("REPL warning does NOT mention ANTHROPIC_API_KEY when claude CLI is absent", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stdout, stderr } = await runRepl(
      [".quit"],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    const combined = stdout + stderr;
    expect(combined).not.toContain("ANTHROPIC_API_KEY");
  }, 14_000);

  it("REPL still shows the banner when claude CLI is absent (does not exit early)", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stdout } = await runRepl(
      [".quit"],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    expect(stdout).toContain("Cassini DB");
  }, 14_000);
});

// ─── AC4: REPL still allows raw SQL when claude CLI is unavailable ────────────

describe("REPL — raw SQL works when claude CLI is unavailable (AC4)", () => {
  it("SELECT query executes successfully even with no claude on PATH", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stdout, exitCode } = await runRepl(
      ["SELECT name FROM planets ORDER BY name LIMIT 1", ".quit"],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    // A planet name must appear in the output
    expect(stdout).toMatch(/Saturn|Titan|Enceladus|Dione|Rhea|Tethys/);
    expect(exitCode).toBe(0);
  }, 14_000);

  it("REPL exits cleanly (code 0) via .quit when claude CLI is absent", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { exitCode } = await runRepl(
      [".quit"],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    expect(exitCode).toBe(0);
  }, 14_000);

  it("multiple raw SQL queries run sequentially without claude CLI", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stdout } = await runRepl(
      [
        "SELECT count(*) FROM planets",
        "SELECT name FROM planets ORDER BY name LIMIT 2",
        ".quit",
      ],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    // count(*) result: 6 planets
    expect(stdout).toMatch(/\d+/);
    // Planet names from second query
    expect(stdout).toMatch(/Saturn|Titan|Enceladus|Dione|Rhea|Tethys/);
  }, 14_000);

  it(".tables dot-command still works when claude CLI is absent", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stdout, exitCode } = await runRepl(
      [".tables", ".quit"],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    expect(stdout).toContain("planets");
    expect(exitCode).toBe(0);
  }, 14_000);
});

// ─── Source structure: both files use the same new interface ──────────────────

describe("source structure — both callsites updated consistently", () => {
  it("commands.ts references validateClaude, not validateApiKey", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("validateClaude");
    expect(source).not.toContain("validateApiKey");
  });

  it("repl.ts references validateClaude, not validateApiKey", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    expect(source).toContain("validateClaude");
    expect(source).not.toContain("validateApiKey");
  });

  it("neither file checks ANTHROPIC_API_KEY directly", async () => {
    const commandsFile = Bun.file(COMMANDS_FILE);
    const replFile = Bun.file(REPL_FILE);
    const [commandsSrc, replSrc] = await Promise.all([
      commandsFile.text(),
      replFile.text(),
    ]);
    expect(commandsSrc).not.toContain("ANTHROPIC_API_KEY");
    expect(replSrc).not.toContain("ANTHROPIC_API_KEY");
  });

  it("naturalLanguageToSql signature is unchanged in commands.ts (question, schema, sampleValues)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    // The call to naturalLanguageToSql passes 3 args: question, schema, sampleValues
    expect(source).toMatch(/naturalLanguageToSql\s*\(\s*question\s*,\s*schema\s*,\s*sampleValues/);
  });

  it("naturalLanguageToSql signature is unchanged in repl.ts (question, schema, sampleValues)", async () => {
    const file = Bun.file(REPL_FILE);
    const source = await file.text();
    expect(source).toMatch(/naturalLanguageToSql\s*\(\s*\w+\s*,\s*schema\s*,\s*sampleValues/);
  });
});
