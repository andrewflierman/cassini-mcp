/**
 * Tests for task: cli-scaffold — Create cli/ package scaffold and entry point
 *
 * Task: cli-scaffold
 * Run with: bun test tests/cli-scaffold.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. cli/package.json is created with @anthropic-ai/sdk dependency
 *   2. cli/tsconfig.json is created
 *   3. cli/src/index.ts is created with argv parsing and subcommand dispatch
 */

import { describe, it, expect } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const CLI_DIR = path.join(ROOT, "cli");

// ─── AC1: cli/package.json ────────────────────────────────────────────────────

describe("cli/package.json — existence and structure (AC1)", () => {
  async function loadPkg(): Promise<Record<string, unknown>> {
    const file = Bun.file(path.join(CLI_DIR, "package.json"));
    return file.json();
  }

  it("cli/package.json exists", async () => {
    const file = Bun.file(path.join(CLI_DIR, "package.json"));
    expect(await file.exists()).toBe(true);
  });

  it("cli/package.json is valid JSON", async () => {
    const file = Bun.file(path.join(CLI_DIR, "package.json"));
    const text = await file.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("package name is 'cassini-cli'", async () => {
    const pkg = await loadPkg();
    expect(pkg.name).toBe("cassini-cli");
  });

  it("has @anthropic-ai/sdk as a dependency (AC1)", async () => {
    const pkg = await loadPkg();
    const deps = pkg.dependencies as Record<string, unknown>;
    expect(deps).toBeDefined();
    expect(deps).toHaveProperty("@anthropic-ai/sdk");
  });

  it("has @types/bun as a devDependency", async () => {
    const pkg = await loadPkg();
    const devDeps = pkg.devDependencies as Record<string, unknown>;
    expect(devDeps).toBeDefined();
    expect(devDeps).toHaveProperty("@types/bun");
  });

  it("has typescript as a devDependency", async () => {
    const pkg = await loadPkg();
    const devDeps = pkg.devDependencies as Record<string, unknown>;
    expect(devDeps).toBeDefined();
    expect(devDeps).toHaveProperty("typescript");
  });

  it("has a 'dev' script that runs src/index.ts via bun", async () => {
    const pkg = await loadPkg();
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts).toBeDefined();
    expect(scripts.dev).toBeDefined();
    expect(scripts.dev).toContain("bun");
    expect(scripts.dev).toContain("src/index.ts");
  });

  it("has a 'build' script that compiles to dist/cassini", async () => {
    const pkg = await loadPkg();
    const scripts = pkg.scripts as Record<string, string>;
    expect(scripts).toBeDefined();
    expect(scripts.build).toBeDefined();
    expect(scripts.build).toContain("--compile");
    expect(scripts.build).toContain("dist/cassini");
  });
});

// ─── AC2: cli/tsconfig.json ───────────────────────────────────────────────────

describe("cli/tsconfig.json — existence and structure (AC2)", () => {
  async function loadTsconfig(): Promise<Record<string, unknown>> {
    const file = Bun.file(path.join(CLI_DIR, "tsconfig.json"));
    return file.json();
  }

  it("cli/tsconfig.json exists", async () => {
    const file = Bun.file(path.join(CLI_DIR, "tsconfig.json"));
    expect(await file.exists()).toBe(true);
  });

  it("cli/tsconfig.json is valid JSON", async () => {
    const file = Bun.file(path.join(CLI_DIR, "tsconfig.json"));
    const text = await file.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it("has compilerOptions", async () => {
    const tsconfig = await loadTsconfig();
    expect(tsconfig).toHaveProperty("compilerOptions");
  });

  it("target is ESNext (matching mcp/ pattern)", async () => {
    const tsconfig = await loadTsconfig();
    const opts = tsconfig.compilerOptions as Record<string, unknown>;
    expect(opts.target).toBe("ESNext");
  });

  it("moduleResolution is 'bundler' (matching mcp/ pattern)", async () => {
    const tsconfig = await loadTsconfig();
    const opts = tsconfig.compilerOptions as Record<string, unknown>;
    expect(opts.moduleResolution).toBe("bundler");
  });

  it("includes bun-types in types array", async () => {
    const tsconfig = await loadTsconfig();
    const opts = tsconfig.compilerOptions as Record<string, unknown>;
    const types = opts.types as string[];
    expect(Array.isArray(types)).toBe(true);
    expect(types).toContain("bun-types");
  });
});

// ─── AC3: cli/src/index.ts — source structure ────────────────────────────────

describe("cli/src/index.ts — source structure (AC3)", () => {
  async function loadSource(): Promise<string> {
    const file = Bun.file(path.join(CLI_DIR, "src/index.ts"));
    return file.text();
  }

  it("cli/src/index.ts exists", async () => {
    const file = Bun.file(path.join(CLI_DIR, "src/index.ts"));
    expect(await file.exists()).toBe(true);
  });

  it("imports from a local db.ts (not from mcp/)", async () => {
    const source = await loadSource();
    // Must import from a local path — db or ./db
    expect(source).toMatch(/from ["']\.\/db(\.js|\.ts)?["']/);
    // Must NOT import from across packages
    expect(source).not.toContain("../mcp/");
  });

  it("does NOT import commander or yargs (hand-rolled parser)", async () => {
    const source = await loadSource();
    expect(source).not.toContain("commander");
    expect(source).not.toContain("yargs");
  });

  it("references the 'ask' subcommand", async () => {
    const source = await loadSource();
    expect(source).toContain("ask");
  });

  it("references the 'query' subcommand", async () => {
    const source = await loadSource();
    expect(source).toContain("query");
  });

  it("references the 'tables' subcommand", async () => {
    const source = await loadSource();
    expect(source).toContain("tables");
  });

  it("references the 'schema' subcommand", async () => {
    const source = await loadSource();
    expect(source).toContain("schema");
  });

  it("references the 'repl' subcommand", async () => {
    const source = await loadSource();
    expect(source).toContain("repl");
  });

  it("references the --db flag", async () => {
    const source = await loadSource();
    expect(source).toContain("--db");
  });

  it("references the --limit flag", async () => {
    const source = await loadSource();
    expect(source).toContain("--limit");
  });

  it("references the --format flag", async () => {
    const source = await loadSource();
    expect(source).toContain("--format");
  });

  it("references the --help flag", async () => {
    const source = await loadSource();
    expect(source).toContain("--help");
  });

  it("references the --sql flag", async () => {
    const source = await loadSource();
    expect(source).toContain("--sql");
  });

  it("references process.argv for parsing", async () => {
    const source = await loadSource();
    expect(source).toContain("process.argv");
  });
});

// ─── AC3: cli/src/db.ts — local db module ────────────────────────────────────

describe("cli/src/db.ts — local copy of db module (AC3)", () => {
  it("cli/src/db.ts exists (must not import from mcp/)", async () => {
    const file = Bun.file(path.join(CLI_DIR, "src/db.ts"));
    expect(await file.exists()).toBe(true);
  });

  it("cli/src/db.ts exports openDb", async () => {
    const file = Bun.file(path.join(CLI_DIR, "src/db.ts"));
    const source = await file.text();
    expect(source).toContain("export");
    expect(source).toContain("openDb");
  });
});

// ─── AC4: --help flag prints usage ───────────────────────────────────────────

describe("bun cli/src/index.ts --help — prints usage (AC4)", () => {
  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(
      ["bun", path.join(CLI_DIR, "src/index.ts"), ...args],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      }
    );

    await proc.exited;

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = proc.exitCode ?? 0;

    return { stdout, stderr, exitCode };
  }

  it("--help exits with code 0", async () => {
    const { exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
  });

  it("--help prints output to stdout", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout.trim().length).toBeGreaterThan(0);
  });

  it("--help output mentions 'cassini' (the CLI name)", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout.toLowerCase()).toContain("cassini");
  });

  it("--help output mentions 'ask' subcommand", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("ask");
  });

  it("--help output mentions 'query' subcommand", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("query");
  });

  it("--help output mentions 'tables' subcommand", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("tables");
  });

  it("--help output mentions 'schema' subcommand", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("schema");
  });

  it("--help output mentions 'repl' subcommand", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("repl");
  });

  it("--help output mentions --db flag", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("--db");
  });

  it("--help output mentions --limit flag", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("--limit");
  });

  it("--help output mentions --format flag", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("--format");
  });

  it("--help output mentions --sql flag", async () => {
    const { stdout } = await runCli(["--help"]);
    expect(stdout).toContain("--sql");
  });
});

// ─── AC5: no args prints usage and exits ─────────────────────────────────────

describe("bun cli/src/index.ts (no args) — prints usage and exits (AC5)", () => {
  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(
      ["bun", path.join(CLI_DIR, "src/index.ts"), ...args],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      }
    );

    await proc.exited;

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = proc.exitCode ?? 0;

    return { stdout, stderr, exitCode };
  }

  it("exits with a non-zero exit code when no args given", async () => {
    const { exitCode } = await runCli([]);
    expect(exitCode).not.toBe(0);
  });

  it("prints usage information (to stdout or stderr) when no args given", async () => {
    const { stdout, stderr } = await runCli([]);
    const combined = stdout + stderr;
    expect(combined.trim().length).toBeGreaterThan(0);
  });

  it("usage output mentions 'Usage' or 'usage' when no args given", async () => {
    const { stdout, stderr } = await runCli([]);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).toContain("usage");
  });

  it("usage output lists at least one subcommand when no args given", async () => {
    const { stdout, stderr } = await runCli([]);
    const combined = stdout + stderr;
    // Should show at least one of the known subcommands
    const hasSubcommand =
      combined.includes("ask") ||
      combined.includes("query") ||
      combined.includes("schema") ||
      combined.includes("tables") ||
      combined.includes("repl");
    expect(hasSubcommand).toBe(true);
  });
});

// ─── AC6: bare positional args treated as 'ask' ──────────────────────────────

describe("bare positional args dispatched as 'ask' (AC6)", () => {
  async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(
      ["bun", path.join(CLI_DIR, "src/index.ts"), ...args],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      }
    );

    // Give it a short time to start up and produce output before killing it
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 3000));
    await Promise.race([proc.exited, timeout]);

    // Kill if still running (e.g. waiting on stdin / API call)
    try { proc.kill(); } catch { /* already exited */ }

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = proc.exitCode ?? 0;

    return { stdout, stderr, exitCode };
  }

  it("bare positional args produce 'ask'-related output (not 'unknown subcommand')", async () => {
    const { stdout, stderr } = await runCli(["what", "moons", "did", "we", "observe"]);
    const combined = stdout + stderr;
    // Should NOT treat bare words as an unknown subcommand error
    expect(combined.toLowerCase()).not.toMatch(/unknown.*subcommand|invalid.*subcommand/);
  });

  it("'cassini ask ...' and 'cassini ...' produce the same style of output", async () => {
    // Both should invoke the 'ask' handler stub — we just check neither errors
    // out with an 'unknown subcommand' message
    const withAsk = await runCli(["ask", "what", "moons", "did", "we", "observe"]);
    const withoutAsk = await runCli(["what", "moons", "did", "we", "observe"]);

    // Neither should claim an unknown subcommand
    const combinedWithAsk = (withAsk.stdout + withAsk.stderr).toLowerCase();
    const combinedWithoutAsk = (withoutAsk.stdout + withoutAsk.stderr).toLowerCase();

    expect(combinedWithAsk).not.toMatch(/unknown.*subcommand|invalid.*subcommand/);
    expect(combinedWithoutAsk).not.toMatch(/unknown.*subcommand|invalid.*subcommand/);
  });

  it("source code shows bare positional args fall through to ask handler", async () => {
    const file = Bun.file(path.join(CLI_DIR, "src/index.ts"));
    const source = await file.text();
    // The default/fallback branch must relate to 'ask'
    // (e.g. `default: ... ask` or `else ... ask` or treating positionals as ask)
    // This is a structural check — the word 'ask' must appear in a default/else branch
    // We check loosely: 'ask' appears as the fallback when no known subcommand is matched
    expect(source).toMatch(/ask/);
  });
});

// ─── AC7: bun install in cli/ succeeds ───────────────────────────────────────

describe("bun install in cli/ (AC7)", () => {
  it("cli/package.json exists and is installable (has required fields)", async () => {
    const file = Bun.file(path.join(CLI_DIR, "package.json"));
    expect(await file.exists()).toBe(true);

    const pkg = await file.json() as Record<string, unknown>;

    // Must have a name (required for a valid package)
    expect(typeof pkg.name).toBe("string");
    expect((pkg.name as string).length).toBeGreaterThan(0);

    // Must have a dependencies object containing @anthropic-ai/sdk
    const deps = pkg.dependencies as Record<string, unknown>;
    expect(deps).toBeDefined();
    expect(deps).toHaveProperty("@anthropic-ai/sdk");

    // The @anthropic-ai/sdk version string must be non-empty
    expect(typeof deps["@anthropic-ai/sdk"]).toBe("string");
    expect((deps["@anthropic-ai/sdk"] as string).length).toBeGreaterThan(0);
  });

  it("bun install in cli/ exits with code 0", async () => {
    const proc = Bun.spawn(["bun", "install"], {
      cwd: CLI_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });

    await proc.exited;
    expect(proc.exitCode).toBe(0);
  }, 60_000); // allow up to 60s for network install

  it("cli/node_modules/@anthropic-ai/sdk exists after install", async () => {
    // Run install first (idempotent)
    const proc = Bun.spawn(["bun", "install"], {
      cwd: CLI_DIR,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;

    const sdkDir = Bun.file(
      path.join(CLI_DIR, "node_modules/@anthropic-ai/sdk/package.json")
    );
    expect(await sdkDir.exists()).toBe(true);
  }, 60_000);
});
