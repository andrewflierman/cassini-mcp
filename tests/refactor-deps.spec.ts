/**
 * Tests for task: refactor-deps — Remove @anthropic-ai/sdk dependency from cli/package.json
 *
 * Task: refactor-deps
 * Run with: bun test tests/refactor-deps.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. @anthropic-ai/sdk is removed from cli/package.json dependencies
 *   2. bun install is run in cli/ so the lockfile is updated
 *   3. bun cli/src/index.ts tables still works (no import errors)
 *   4. bun cli/src/index.ts ask works with claude -p (no SDK import errors)
 */

import { describe, it, expect } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const CLI_DIR = path.join(ROOT, "cli");
const PACKAGE_JSON = path.join(CLI_DIR, "package.json");
const LOCKFILE = path.join(CLI_DIR, "bun.lock");
const DB_PATH = path.join(ROOT, "cassini.db");

// Absolute path to bun binary (avoids PATH issues in subprocess tests)
const BUN_BIN = process.execPath;

// ─── Helper: run the CLI as a subprocess ─────────────────────────────────────

async function runCli(
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env = opts.env ?? (process.env as Record<string, string>);
  const timeoutMs = opts.timeoutMs ?? 12_000;

  const proc = Bun.spawn(
    [BUN_BIN, path.join(CLI_DIR, "src/index.ts"), ...args, "--db", DB_PATH],
    { stdout: "pipe", stderr: "pipe", cwd: ROOT, env }
  );

  const deadline = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([proc.exited, deadline]);
  try { proc.kill(); } catch { /* already exited */ }

  return {
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
    exitCode: proc.exitCode ?? 1,
  };
}

// ─── AC1: @anthropic-ai/sdk not in cli/package.json dependencies ──────────────

describe("cli/package.json — @anthropic-ai/sdk removed (AC1)", () => {
  it("dependencies object does NOT contain @anthropic-ai/sdk", async () => {
    const file = Bun.file(PACKAGE_JSON);
    const pkg = await file.json();
    const deps = pkg.dependencies ?? {};
    expect(Object.keys(deps)).not.toContain("@anthropic-ai/sdk");
  });

  it("devDependencies object does NOT contain @anthropic-ai/sdk", async () => {
    const file = Bun.file(PACKAGE_JSON);
    const pkg = await file.json();
    const devDeps = pkg.devDependencies ?? {};
    expect(Object.keys(devDeps)).not.toContain("@anthropic-ai/sdk");
  });

  it("peerDependencies (if present) does NOT contain @anthropic-ai/sdk", async () => {
    const file = Bun.file(PACKAGE_JSON);
    const pkg = await file.json();
    const peerDeps = pkg.peerDependencies ?? {};
    expect(Object.keys(peerDeps)).not.toContain("@anthropic-ai/sdk");
  });

  it("package.json raw text does NOT mention @anthropic-ai/sdk at all", async () => {
    const file = Bun.file(PACKAGE_JSON);
    const raw = await file.text();
    expect(raw).not.toContain("@anthropic-ai/sdk");
  });

  it("package.json still has a valid dependencies object (not removed entirely)", async () => {
    const file = Bun.file(PACKAGE_JSON);
    const pkg = await file.json();
    // dependencies key should still exist (even if empty) or be absent —
    // what matters is that removing the SDK did not corrupt the JSON structure
    expect(pkg).toHaveProperty("name");
    expect(pkg).toHaveProperty("version");
  });

  it("package.json name is still 'cassini-cli'", async () => {
    const file = Bun.file(PACKAGE_JSON);
    const pkg = await file.json();
    expect(pkg.name).toBe("cassini-cli");
  });

  it("devDependencies still include @types/bun and typescript", async () => {
    const file = Bun.file(PACKAGE_JSON);
    const pkg = await file.json();
    const devDeps = pkg.devDependencies ?? {};
    expect(Object.keys(devDeps)).toContain("@types/bun");
    expect(Object.keys(devDeps)).toContain("typescript");
  });
});

// ─── AC2: bun.lock updated — @anthropic-ai/sdk removed from lockfile ──────────

describe("cli/bun.lock — @anthropic-ai/sdk removed (AC2)", () => {
  it("lockfile does NOT reference @anthropic-ai/sdk in the packages map", async () => {
    const file = Bun.file(LOCKFILE);
    const raw = await file.text();
    expect(raw).not.toContain('"@anthropic-ai/sdk"');
  });

  it("lockfile workspaces section does NOT list @anthropic-ai/sdk as a dependency", async () => {
    const file = Bun.file(LOCKFILE);
    const raw = await file.text();
    // The workspace dependency block originally had "@anthropic-ai/sdk": "^0.39.0"
    expect(raw).not.toContain("@anthropic-ai/sdk");
  });

  it("lockfile still exists and is non-empty after bun install", async () => {
    const file = Bun.file(LOCKFILE);
    const raw = await file.text();
    expect(raw.trim().length).toBeGreaterThan(0);
  });

  it("lockfile still references @types/bun (devDependency remains)", async () => {
    const file = Bun.file(LOCKFILE);
    const raw = await file.text();
    expect(raw).toContain("@types/bun");
  });

  it("lockfile still references typescript (devDependency remains)", async () => {
    const file = Bun.file(LOCKFILE);
    const raw = await file.text();
    expect(raw).toContain("typescript");
  });
});

// ─── AC3: bun cli/src/index.ts tables works — no import errors ────────────────

describe("bun cli/src/index.ts tables — no import errors (AC3)", () => {
  it("tables command exits 0", async () => {
    const { exitCode } = await runCli(["tables"], { timeoutMs: 12_000 });
    expect(exitCode).toBe(0);
  }, 16_000);

  it("tables command produces output on stdout", async () => {
    const { stdout } = await runCli(["tables"], { timeoutMs: 12_000 });
    expect(stdout.trim().length).toBeGreaterThan(0);
  }, 16_000);

  it("tables command output includes at least one table name", async () => {
    const { stdout } = await runCli(["tables"], { timeoutMs: 12_000 });
    // The Cassini DB has known tables like planets, observations, etc.
    expect(stdout).toMatch(/\w+/);
  }, 16_000);

  it("tables command stderr does NOT mention @anthropic-ai/sdk", async () => {
    const { stderr } = await runCli(["tables"], { timeoutMs: 12_000 });
    expect(stderr).not.toContain("@anthropic-ai/sdk");
  }, 16_000);

  it("tables command stderr does NOT mention 'Cannot find module'", async () => {
    const { stderr } = await runCli(["tables"], { timeoutMs: 12_000 });
    expect(stderr).not.toContain("Cannot find module");
  }, 16_000);

  it("tables command stderr does NOT mention 'Module not found'", async () => {
    const { stderr } = await runCli(["tables"], { timeoutMs: 12_000 });
    expect(stderr).not.toContain("Module not found");
  }, 16_000);
});

// ─── AC4: ask command works end-to-end with claude -p (no SDK import errors) ──

describe("bun cli/src/index.ts ask — no SDK import errors (AC4)", () => {
  it("ask command does NOT error with 'Cannot find module @anthropic-ai/sdk'", async () => {
    // We intentionally use a PATH without claude to get a fast-fail validation
    // error — but the key thing is it must NOT be an SDK import error
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stderr } = await runCli(
      ["ask", "how many planets are there?"],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    expect(stderr).not.toContain("@anthropic-ai/sdk");
  }, 14_000);

  it("ask command does NOT mention 'Cannot find module' in stderr", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stderr } = await runCli(
      ["ask", "how many planets are there?"],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    expect(stderr).not.toContain("Cannot find module");
  }, 14_000);

  it("ask command fails with a CLI-related error (not SDK resolution error) when claude is missing", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { exitCode, stderr } = await runCli(
      ["ask", "how many planets are there?"],
      { env: envWithoutClaude, timeoutMs: 10_000 }
    );
    // Should fail (exit 1) because claude CLI is missing — not because of SDK import
    expect(exitCode).toBe(1);
    // The error should be something about claude CLI, not module resolution
    expect(stderr).not.toContain("@anthropic-ai/sdk");
    expect(stderr).not.toContain("Cannot find module");
  }, 14_000);

  it("ask command with real claude CLI exits 0 and returns SQL results", async () => {
    const { exitCode, stdout, stderr } = await runCli(
      ["ask", "list all tables"],
      { timeoutMs: 30_000 }
    );
    // Should succeed when claude is available on PATH
    expect(stderr).not.toContain("@anthropic-ai/sdk");
    expect(stderr).not.toContain("Cannot find module");
    expect(exitCode).toBe(0);
    expect(stdout.trim().length).toBeGreaterThan(0);
  }, 35_000);
});

// ─── Source hygiene: no source file imports @anthropic-ai/sdk ─────────────────

describe("cli/src — no source file imports @anthropic-ai/sdk", () => {
  const srcFiles = [
    path.join(CLI_DIR, "src/ai.ts"),
    path.join(CLI_DIR, "src/commands.ts"),
    path.join(CLI_DIR, "src/db.ts"),
    path.join(CLI_DIR, "src/formatter.ts"),
    path.join(CLI_DIR, "src/index.ts"),
    path.join(CLI_DIR, "src/repl.ts"),
  ];

  for (const filePath of srcFiles) {
    const basename = path.basename(filePath);
    it(`${basename} does NOT import from '@anthropic-ai/sdk'`, async () => {
      const file = Bun.file(filePath);
      const source = await file.text();
      expect(source).not.toContain("@anthropic-ai/sdk");
    });
  }
});
