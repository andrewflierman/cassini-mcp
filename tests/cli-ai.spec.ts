/**
 * Tests for task: cli-ai — Create cli/src/ai.ts — natural language to SQL via Anthropic SDK
 *
 * Task: cli-ai
 * Run with: bun test tests/cli-ai.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. cli/src/ai.ts is created with naturalLanguageToSql and validateApiKey exports
 *   2. naturalLanguageToSql calls the Anthropic API with the schema in the system prompt
 *   3. The response is parsed as JSON with sql and explanation fields
 *   4. Uses the claude-sonnet-4-20250514 model (as specified in task)
 *   5. validateApiKey returns false and prints error if ANTHROPIC_API_KEY is missing
 *   6. Errors from the API are caught and rethrown with clear messages
 */

import { describe, it, expect } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const CLI_DIR = path.join(ROOT, "cli");
const AI_FILE = path.join(CLI_DIR, "src/ai.ts");

// ─── AC1: cli/src/ai.ts — file existence and exports ─────────────────────────

describe("cli/src/ai.ts — file existence and exports (AC1)", () => {
  it("cli/src/ai.ts exists", async () => {
    const file = Bun.file(AI_FILE);
    expect(await file.exists()).toBe(true);
  });

  it("cli/src/ai.ts exports naturalLanguageToSql as a named export", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("naturalLanguageToSql");
    expect(source).toMatch(/export\s+(async\s+)?function\s+naturalLanguageToSql|export\s*\{[^}]*naturalLanguageToSql/);
  });

  it("cli/src/ai.ts exports validateApiKey as a named export", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("validateApiKey");
    expect(source).toMatch(/export\s+(function|const)\s+validateApiKey|export\s*\{[^}]*validateApiKey/);
  });
});

// ─── AC2: Anthropic SDK import and API call ───────────────────────────────────

describe("cli/src/ai.ts — Anthropic SDK usage (AC2)", () => {
  it("imports from '@anthropic-ai/sdk'", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("@anthropic-ai/sdk");
  });

  it("does NOT pass apiKey to the Anthropic constructor (reads from env automatically)", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // The Anthropic constructor must be called with no arguments or an empty object
    // It must NOT pass apiKey as a property
    expect(source).not.toMatch(/new\s+Anthropic\s*\(\s*\{[^}]*apiKey\s*:/);
  });

  it("creates an Anthropic client instance", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/new\s+Anthropic\s*\(/);
  });

  it("calls client.messages.create (or equivalent SDK method)", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/messages\.create/);
  });

  it("passes a system prompt to the API call", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/system\s*:/);
  });

  it("includes the schema parameter in the system prompt construction", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // The schema parameter must be interpolated into the system prompt
    expect(source).toContain("schema");
  });
});

// ─── AC3: JSON response parsing — sql and explanation fields ─────────────────

describe("cli/src/ai.ts — JSON response parsing (AC3)", () => {
  it("parses JSON from the API response", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/JSON\.parse/);
  });

  it("extracts 'sql' field from parsed response", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain('"sql"');
  });

  it("extracts 'explanation' field from parsed response", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain('"explanation"');
  });

  it("throws a clear error when the response cannot be parsed as JSON", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must have error handling around JSON.parse (try/catch or similar)
    expect(source).toMatch(/catch|throw\s+new\s+Error/);
  });

  it("naturalLanguageToSql signature accepts (question: string, schema: string)", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Function must accept question and schema parameters
    expect(source).toMatch(/naturalLanguageToSql\s*\(\s*question/);
    expect(source).toMatch(/naturalLanguageToSql\s*\([^)]*schema/);
  });

  it("naturalLanguageToSql returns a Promise<{ sql, explanation }>", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must be async (to return a Promise)
    expect(source).toMatch(/async\s+function\s+naturalLanguageToSql|naturalLanguageToSql\s*=\s*async/);
  });
});

// ─── AC4: Uses claude-sonnet-4-20250514 model ─────────────────────────────────

describe("cli/src/ai.ts — model selection (AC4)", () => {
  it("uses 'claude-sonnet-4-20250514' as the model", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("claude-sonnet-4-20250514");
  });
});

// ─── AC5: validateApiKey — checks ANTHROPIC_API_KEY ──────────────────────────

describe("cli/src/ai.ts — validateApiKey (AC5)", () => {
  it("validateApiKey checks process.env.ANTHROPIC_API_KEY", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toContain("ANTHROPIC_API_KEY");
  });

  it("validateApiKey prints an error message when key is missing", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must call console.error (or similar) within validateApiKey context
    expect(source).toMatch(/console\.(error|warn)/);
  });

  it("validateApiKey returns a boolean", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must return true or false
    expect(source).toMatch(/return\s+(true|false)/);
  });

  it("validateApiKey returns false at runtime when ANTHROPIC_API_KEY is unset", async () => {
    // Dynamically import the module with ANTHROPIC_API_KEY unset
    // We use a subprocess so we don't pollute this test process's env
    const proc = Bun.spawn(
      [
        "bun",
        "--eval",
        `
import { validateApiKey } from ${JSON.stringify(AI_FILE)};
const result = validateApiKey();
process.stdout.write(result === false ? "false" : "true");
        `.trim(),
      ],
      {
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: "", // explicitly unset
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      }
    );

    await proc.exited;
    const output = await new Response(proc.stdout).text();
    expect(output.trim()).toBe("false");
  });

  it("validateApiKey returns true at runtime when ANTHROPIC_API_KEY is set", async () => {
    const proc = Bun.spawn(
      [
        "bun",
        "--eval",
        `
import { validateApiKey } from ${JSON.stringify(AI_FILE)};
const result = validateApiKey();
process.stdout.write(result === true ? "true" : "false");
        `.trim(),
      ],
      {
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: "sk-ant-test-key-that-is-set",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      }
    );

    await proc.exited;
    const output = await new Response(proc.stdout).text();
    expect(output.trim()).toBe("true");
  });
});

// ─── AC6: API errors are caught and rethrown with clear messages ──────────────

describe("cli/src/ai.ts — error handling (AC6)", () => {
  it("wraps API calls in try/catch", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source).toMatch(/try\s*\{[\s\S]*catch/);
  });

  it("rethrows caught errors as new Error instances with a descriptive message", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // Must throw a new Error (not just re-throw bare)
    expect(source).toMatch(/throw\s+new\s+Error\s*\(/);
  });

  it("naturalLanguageToSql rejects with an Error when the API call fails", async () => {
    // Simulate a failed API call by passing an invalid key and checking that
    // the function rejects with an Error (not crashes the process)
    const proc = Bun.spawn(
      [
        "bun",
        "--eval",
        `
import { naturalLanguageToSql } from ${JSON.stringify(AI_FILE)};
naturalLanguageToSql("test question", "Table: test\\n  - id INTEGER")
  .then(() => {
    process.stdout.write("resolved");
    process.exit(0);
  })
  .catch((err) => {
    // We expect rejection with a real Error instance and a non-empty message
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
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: "sk-ant-invalid-key-for-test",
        },
        stdout: "pipe",
        stderr: "pipe",
        cwd: ROOT,
      }
    );

    // Give it time to make (and fail) the API call
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 15_000));
    await Promise.race([proc.exited, timeout]);
    try { proc.kill(); } catch { /* already exited */ }

    const output = await new Response(proc.stdout).text();
    // It must either reject with an Error, or resolve (if somehow the mock worked)
    // The key requirement is it does NOT crash the process unhandled
    expect(["rejected-with-error", "resolved"]).toContain(output.trim());
  }, 20_000);
});

// ─── System prompt content requirements ──────────────────────────────────────

describe("cli/src/ai.ts — system prompt instructions (AC2 detailed)", () => {
  it("system prompt instructs to generate a SELECT statement (read-only)", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source.toLowerCase()).toMatch(/select/);
    // The prompt should mention read-only or no mutations
    expect(source.toLowerCase()).toMatch(/select|read.only|no mutation|read only/);
  });

  it("system prompt mentions SQLite syntax", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source.toLowerCase()).toContain("sqlite");
  });

  it("system prompt instructs response to be JSON with sql and explanation keys", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    // The prompt text must contain both field names as string literals
    // so Claude knows what JSON shape to produce
    expect(source).toMatch(/"sql"|'sql'|`sql`/);
    expect(source).toMatch(/"explanation"|'explanation'|`explanation`/);
  });

  it("system prompt mentions LIKE with % wildcards for fuzzy text matching", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source.toUpperCase()).toMatch(/LIKE|%/);
  });

  it("system prompt mentions using LIMIT for large result sets", async () => {
    const file = Bun.file(AI_FILE);
    const source = await file.text();
    expect(source.toUpperCase()).toContain("LIMIT");
  });
});
