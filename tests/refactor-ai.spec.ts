/**
 * Tests for task: refactor-ai — Replace Anthropic SDK with claude -p in cli/src/ai.ts
 *
 * Task: refactor-ai
 * Run with: bun test tests/refactor-ai.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. cli/src/ai.ts no longer imports @anthropic-ai/sdk
 *   2. naturalLanguageToSql spawns `claude -p` with --system-prompt, --model sonnet,
 *      --output-format text, --dangerously-skip-permissions, --allowedTools ''
 *   3. Claude Code env vars (CLAUDECODE, CLAUDE_CODE_SSE_PORT, CLAUDE_CODE_ENTRYPOINT)
 *      are stripped from the subprocess environment
 *   4. The subprocess stdout is parsed as JSON with sql and explanation fields
 *      (same JSON extraction logic: look for `{...}` object in response text)
 *   5. validateApiKey is renamed to validateClaude and checks for claude CLI
 *      availability by running `claude --version` instead of checking an env var
 *   6. Non-zero subprocess exit is caught and rethrown with a descriptive message
 */

import { describe, it, expect } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const CLI_DIR = path.join(ROOT, "cli");
const AI_FILE = path.join(CLI_DIR, "src/ai.ts");
const COMMANDS_FILE = path.join(CLI_DIR, "src/commands.ts");

// Use the absolute path to the bun binary so subprocess tests that strip PATH
// can still find the runtime (Bun.which falls back to the running executable).
const BUN_BIN = process.execPath; // absolute path, e.g. /home/user/.bun/bin/bun

// ─── AC1: No more @anthropic-ai/sdk import ────────────────────────────────────

describe("cli/src/ai.ts — no Anthropic SDK (AC1)", () => {
  it("does NOT import from '@anthropic-ai/sdk'", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).not.toContain("@anthropic-ai/sdk");
  });

  it("does NOT instantiate an Anthropic client (new Anthropic(...))", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).not.toMatch(/new\s+Anthropic\s*\(/);
  });

  it("does NOT call messages.create (Anthropic SDK method)", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).not.toMatch(/messages\.create/);
  });
});

// ─── AC2: naturalLanguageToSql spawns claude -p subprocess ────────────────────

describe("cli/src/ai.ts — spawns claude -p subprocess (AC2)", () => {
  it("naturalLanguageToSql source uses 'claude' as the spawned command", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must spawn 'claude' (the CLI binary) rather than calling the SDK
    expect(source).toMatch(/['"`]claude['"`]/);
  });

  it("passes '-p' flag to claude subprocess", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/['"]-p['"]/);
  });

  it("passes '--system-prompt' flag to claude subprocess", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("--system-prompt");
  });

  it("passes '--model' flag with value 'sonnet'", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must pass --model sonnet (not a full model ID like claude-sonnet-4-...)
    expect(source).toContain("--model");
    expect(source).toContain("sonnet");
  });

  it("passes '--output-format' flag with value 'text'", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("--output-format");
    expect(source).toMatch(/['"`]text['"`]/);
  });

  it("passes '--dangerously-skip-permissions' flag", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("--dangerously-skip-permissions");
  });

  it("passes '--allowedTools' flag with empty string value", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("--allowedTools");
    // Empty string disables tool use — must be passed as ''
    expect(source).toMatch(/['"`]['"`]/); // two adjacent quotes = empty string
  });

  it("does NOT use 'stream-json' as the output format", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).not.toContain("stream-json");
  });
});

// ─── AC3: Claude Code env vars stripped from subprocess env ───────────────────

describe("cli/src/ai.ts — strips Claude Code env vars from subprocess env (AC3)", () => {
  it("deletes CLAUDECODE from the subprocess environment", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("CLAUDECODE");
    // Must delete it (not just reference it)
    expect(source).toMatch(/delete\s+\w+(\[['"`]CLAUDECODE['"`]\]|\.CLAUDECODE)/);
  });

  it("deletes CLAUDE_CODE_SSE_PORT from the subprocess environment", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("CLAUDE_CODE_SSE_PORT");
    expect(source).toMatch(/delete\s+\w+(\[['"`]CLAUDE_CODE_SSE_PORT['"`]\]|\.CLAUDE_CODE_SSE_PORT)/);
  });

  it("deletes CLAUDE_CODE_ENTRYPOINT from the subprocess environment", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("CLAUDE_CODE_ENTRYPOINT");
    expect(source).toMatch(/delete\s+\w+(\[['"`]CLAUDE_CODE_ENTRYPOINT['"`]\]|\.CLAUDE_CODE_ENTRYPOINT)/);
  });

  it("spreads process.env to copy the environment before stripping vars", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must copy env (e.g. { ...process.env }) rather than mutating process.env directly
    expect(source).toMatch(/\{\s*\.\.\.process\.env\s*\}/);
  });
});

// ─── AC4: Response parsed as JSON with sql and explanation ────────────────────

describe("cli/src/ai.ts — parses subprocess stdout as JSON { sql, explanation } (AC4)", () => {
  it("captures subprocess stdout as the result text", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must read stdout from the subprocess (not stderr)
    expect(source).toMatch(/stdout/);
  });

  it("uses a regex or JSON.parse to extract a JSON object from the result text", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Extraction: match /\{[\s\S]*\}/ or similar, then JSON.parse
    expect(source).toMatch(/JSON\.parse/);
    // Should have a regex to find the JSON object in the response text
    expect(source).toMatch(/\{[\s\S]*\}|\{[^}]*\}/); // regex literal present in source
  });

  it("extracts 'sql' field from the parsed JSON response", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain('"sql"');
  });

  it("extracts 'explanation' field from the parsed JSON response", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain('"explanation"');
  });

  it("validates that both sql and explanation are strings after parsing", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must type-check the parsed result
    expect(source).toMatch(/typeof.*sql|typeof.*explanation/);
  });

  it("throws a clear error when the subprocess response is not valid JSON", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must handle JSON.parse failure
    expect(source).toMatch(/catch|throw\s+new\s+Error/);
  });
});

// ─── AC5: validateClaude checks claude CLI availability ───────────────────────

describe("cli/src/ai.ts — validateClaude (AC5)", () => {
  it("exports 'validateClaude' (not 'validateApiKey')", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/export\s+(async\s+)?function\s+validateClaude|export\s*\{[^}]*validateClaude/);
  });

  it("does NOT export 'validateApiKey' (old name is gone)", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).not.toMatch(/export\s+(function|const)\s+validateApiKey/);
  });

  it("validateClaude does NOT check ANTHROPIC_API_KEY env var", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).not.toContain("ANTHROPIC_API_KEY");
  });

  it("validateClaude runs 'claude --version' to check for CLI availability", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("--version");
    // Must reference the claude binary in the version check
    expect(source).toMatch(/claude.*--version|--version.*claude/);
  });

  it("validateClaude returns true when claude CLI is found (exit 0)", async () => {
    const proc = Bun.spawn(
      [
        BUN_BIN,
        "--eval",
        `
import { validateClaude } from ${JSON.stringify(AI_FILE)};
const result = await validateClaude();
process.stdout.write(result === true ? "true" : "false");
        `.trim(),
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      }
    );

    // Give it time to run claude --version
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    await Promise.race([proc.exited, deadline]);
    try { proc.kill(); } catch { /* already exited */ }

    const output = await new Response(proc.stdout).text();
    // claude is installed in this environment — should return true
    expect(output.trim()).toBe("true");
  }, 15_000);

  it("validateClaude returns false when claude CLI is not found", async () => {
    // Simulate a missing claude binary by using a PATH that has no claude
    const proc = Bun.spawn(
      [
        BUN_BIN,
        "--eval",
        `
import { validateClaude } from ${JSON.stringify(AI_FILE)};
const result = await validateClaude();
process.stdout.write(result === false ? "false" : "true");
        `.trim(),
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
        env: {
          ...process.env,
          PATH: "/tmp/no-such-bin-dir", // no claude on this PATH
        },
      }
    );

    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    await Promise.race([proc.exited, deadline]);
    try { proc.kill(); } catch { /* already exited */ }

    const output = await new Response(proc.stdout).text();
    expect(output.trim()).toBe("false");
  }, 15_000);

  it("validateClaude returns a boolean (not a string or undefined)", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must return true or false
    expect(source).toMatch(/return\s+(true|false)/);
  });
});

// ─── AC6: Subprocess errors caught and rethrown descriptively ─────────────────

describe("cli/src/ai.ts — subprocess error handling (AC6)", () => {
  it("captures stderr from the claude subprocess", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must read stderr to include in error messages
    expect(source).toMatch(/stderr/);
  });

  it("checks the subprocess exit code", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must check exit code (exitCode, exited, or exit code check pattern)
    expect(source).toMatch(/exitCode|exited|exit\s*code|proc\.exit/i);
  });

  it("throws a new Error with a descriptive message on non-zero exit", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must throw a new Error (not just re-throw or console.error)
    expect(source).toMatch(/throw\s+new\s+Error\s*\(/);
  });

  it("naturalLanguageToSql rejects with an Error when claude subprocess fails", async () => {
    // Force a failure by providing a PATH with no claude binary
    const proc = Bun.spawn(
      [
        BUN_BIN,
        "--eval",
        `
import { naturalLanguageToSql } from ${JSON.stringify(AI_FILE)};
naturalLanguageToSql("test question", "Table: test\\n  - id INTEGER")
  .then(() => {
    process.stdout.write("resolved");
    process.exit(0);
  })
  .catch((err) => {
    if (err instanceof Error && err.message.length > 0) {
      process.stdout.write("rejected-with-error");
    } else {
      process.stdout.write("rejected-wrong-type");
    }
    process.exit(0);
  });
        `.trim(),
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
        env: {
          ...process.env,
          PATH: "/tmp/no-such-bin-dir", // no claude CLI
        },
      }
    );

    // Allow up to 10s for the spawn attempt to fail
    const deadline = new Promise<void>((resolve) => setTimeout(resolve, 10_000));
    await Promise.race([proc.exited, deadline]);
    try { proc.kill(); } catch { /* already exited */ }

    const output = await new Response(proc.stdout).text();
    expect(output.trim()).toBe("rejected-with-error");
  }, 15_000);

  it("error message from subprocess failure includes stderr output", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // The error thrown on non-zero exit must reference the stderr content
    // Look for a pattern that combines stderr into the error message
    expect(source).toMatch(/stderr|stderrText|stderr_text/);
    // The throw must come after reading stderr (stderr appears before the throw)
    const stderrIdx = source.lastIndexOf("stderr");
    const throwIdx = source.lastIndexOf("throw new Error");
    expect(throwIdx).toBeGreaterThan(stderrIdx - 500); // stderr referenced near the throw
  });
});

// ─── commands.ts must import validateClaude (not validateApiKey) ──────────────

describe("cli/src/commands.ts — updated import (validateClaude)", () => {
  it("imports 'validateClaude' from ./ai (not 'validateApiKey')", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    // Must import the new name
    expect(source).toContain("validateClaude");
  });

  it("does NOT import 'validateApiKey' (old export is gone)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).not.toContain("validateApiKey");
  });

  it("calls validateClaude in handleAsk (for fast-fail before spawning claude)", async () => {
    const file = Bun.file(COMMANDS_FILE);
    const source = await file.text();
    expect(source).toContain("validateClaude");
    // Must be called (not just imported)
    expect(source).toMatch(/validateClaude\s*\(\s*\)/);
  });
});

// ─── Integration: ask command fails clearly when claude CLI is missing ─────────

describe("cassini ask — fails clearly without claude CLI (AC5 + AC6 integration)", () => {
  async function runCli(
    args: string[],
    opts: { env?: Record<string, string>; timeoutMs?: number } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const env = opts.env ?? (process.env as Record<string, string>);
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const DB_PATH = path.join(ROOT, "cassini.db");

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

  it("ask exits 1 when claude CLI is not on PATH", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { exitCode } = await runCli(
      ["ask", "how many planets are there?"],
      { env: envWithoutClaude, timeoutMs: 8_000 }
    );
    expect(exitCode).toBe(1);
  }, 12_000);

  it("ask prints an error to stderr when claude CLI is not on PATH", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const { stderr } = await runCli(
      ["ask", "how many planets are there?"],
      { env: envWithoutClaude, timeoutMs: 8_000 }
    );
    expect(stderr.trim().length).toBeGreaterThan(0);
  }, 12_000);

  it("ask without claude fails fast — does not hang (under 6 seconds)", async () => {
    const envWithoutClaude: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) envWithoutClaude[k] = v;
    }
    envWithoutClaude.PATH = "/tmp/no-such-bin-dir";

    const start = Date.now();
    await runCli(
      ["ask", "how many planets are there?"],
      { env: envWithoutClaude, timeoutMs: 8_000 }
    );
    expect(Date.now() - start).toBeLessThan(6_000);
  }, 12_000);
});

// ─── Source structure: buildSystemPrompt still present and intact ─────────────

describe("cli/src/ai.ts — buildSystemPrompt unchanged (domain knowledge preserved)", () => {
  it("still defines buildSystemPrompt function", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/function\s+buildSystemPrompt/);
  });

  it("buildSystemPrompt still accepts schema and sampleValues parameters", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/buildSystemPrompt\s*\([^)]*schema[^)]*sampleValues|buildSystemPrompt\s*\([^)]*sampleValues/);
  });

  it("system prompt still mentions Cassini mission domain context", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source.toLowerCase()).toContain("cassini");
    expect(source.toLowerCase()).toContain("saturn");
  });

  it("system prompt still requires JSON response with sql and explanation", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/"sql"|'sql'/);
    expect(source).toMatch(/"explanation"|'explanation'/);
  });

  it("system prompt still enforces SELECT-only rule (no mutations)", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source.toUpperCase()).toMatch(/SELECT/);
    expect(source.toUpperCase()).toMatch(/INSERT|DELETE|DROP|no.*mutati/i);
  });

  it("system prompt still mentions SQLite", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source.toLowerCase()).toContain("sqlite");
  });

  it("system prompt still mentions LIMIT for large result sets", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source.toUpperCase()).toContain("LIMIT");
  });
});

// ─── naturalLanguageToSql signature unchanged ─────────────────────────────────

describe("cli/src/ai.ts — naturalLanguageToSql public interface unchanged", () => {
  it("still exports naturalLanguageToSql as a named async export", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/export\s+async\s+function\s+naturalLanguageToSql|export\s*\{[^}]*naturalLanguageToSql/);
  });

  it("naturalLanguageToSql still accepts (question, schema, sampleValues) parameters", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/naturalLanguageToSql\s*\(\s*question/);
    expect(source).toMatch(/naturalLanguageToSql\s*\([^)]*schema/);
  });

  it("naturalLanguageToSql still returns Promise<{ sql, explanation }>", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must be async (so it returns a Promise)
    expect(source).toMatch(/async\s+function\s+naturalLanguageToSql/);
    // Must return an object with both keys
    expect(source).toMatch(/return\s*\{[^}]*(sql|explanation)/);
  });
});
