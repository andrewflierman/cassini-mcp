/**
 * Tests for task: librechat-gitignore — Update root .gitignore for LibreChat
 * runtime data.
 *
 * Task: librechat-gitignore
 * Run with: bun test tests/librechat-gitignore.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until the root
 * .gitignore is updated with the required LibreChat entries.
 *
 * Strategy: read the root .gitignore as text and assert that each required
 * pattern is present, and that the .env.example exception is NOT excluded.
 * We also use `git check-ignore` (when git is available) to confirm the
 * patterns actually match the intended paths as Git evaluates them.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const GITIGNORE_PATH = path.join(ROOT, ".gitignore");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readGitignore(): Promise<string> {
  const file = Bun.file(GITIGNORE_PATH);
  return file.text();
}

/**
 * Run `git check-ignore -v <path>` and return true if Git would ignore it.
 * Returns null if git is not available in the test environment.
 */
async function gitWouldIgnore(filePath: string): Promise<boolean | null> {
  try {
    const proc = Bun.spawn(
      ["git", "check-ignore", "--quiet", filePath],
      { cwd: ROOT, stdout: "pipe", stderr: "pipe" }
    );
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return null; // git not available
  }
}

/**
 * Run `git check-ignore -v <path>` and return false if Git would NOT ignore it
 * (i.e., the path is tracked / not excluded). Returns null if git unavailable.
 */
async function gitWouldNotIgnore(filePath: string): Promise<boolean | null> {
  const ignored = await gitWouldIgnore(filePath);
  if (ignored === null) return null;
  return !ignored;
}

// ─── AC0: .gitignore exists ───────────────────────────────────────────────────

describe("root .gitignore — existence", () => {
  it(".gitignore exists at the repo root", async () => {
    const file = Bun.file(GITIGNORE_PATH);
    expect(await file.exists()).toBe(true);
  });

  it(".gitignore is non-empty", async () => {
    const text = await readGitignore();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

// ─── AC1: librechat/.env is ignored ──────────────────────────────────────────

describe("root .gitignore — librechat/.env is ignored (AC1)", () => {
  let gitignore: string;

  beforeAll(async () => {
    gitignore = await readGitignore();
  });

  it("contains an entry that covers librechat/.env", () => {
    // Accepts: librechat/.env  OR  librechat/.env*  (but not a bare .env line
    // which would be too broad — we want the librechat/ scope).
    // Also accepts a negation exception for .env.example after a broad match.
    expect(gitignore).toMatch(/librechat\/\.env/);
  });

  it("librechat/.env pattern is not accidentally a comment", () => {
    // The line containing librechat/.env must not start with #
    const lines = gitignore.split("\n");
    const matchingLines = lines.filter(
      (l) => /librechat\/\.env/.test(l) && !l.trimStart().startsWith("#")
    );
    expect(matchingLines.length).toBeGreaterThan(0);
  });

  it("git check-ignore marks librechat/.env as ignored", async () => {
    const ignored = await gitWouldIgnore("librechat/.env");
    if (ignored === null) {
      console.warn("git not available — skipping git check-ignore test");
      return;
    }
    expect(ignored).toBe(true);
  });
});

// ─── AC2: librechat runtime data directories are ignored ─────────────────────

describe("root .gitignore — librechat runtime data directories (AC2)", () => {
  let gitignore: string;

  beforeAll(async () => {
    gitignore = await readGitignore();
  });

  it("contains an entry that covers librechat/data/", () => {
    // Accepts: librechat/data/  or  librechat/data
    expect(gitignore).toMatch(/librechat\/data\/?/);
  });

  it("librechat/data/ pattern is not a comment", () => {
    const lines = gitignore.split("\n");
    const matchingLines = lines.filter(
      (l) => /librechat\/data/.test(l) && !l.trimStart().startsWith("#")
    );
    expect(matchingLines.length).toBeGreaterThan(0);
  });

  it("contains an entry that covers librechat/logs/", () => {
    // Accepts: librechat/logs/  or  librechat/logs
    expect(gitignore).toMatch(/librechat\/logs\/?/);
  });

  it("librechat/logs/ pattern is not a comment", () => {
    const lines = gitignore.split("\n");
    const matchingLines = lines.filter(
      (l) => /librechat\/logs/.test(l) && !l.trimStart().startsWith("#")
    );
    expect(matchingLines.length).toBeGreaterThan(0);
  });

  it("git check-ignore marks librechat/data/ as ignored", async () => {
    const ignored = await gitWouldIgnore("librechat/data/");
    if (ignored === null) {
      console.warn("git not available — skipping git check-ignore test");
      return;
    }
    expect(ignored).toBe(true);
  });

  it("git check-ignore marks librechat/logs/ as ignored", async () => {
    const ignored = await gitWouldIgnore("librechat/logs/");
    if (ignored === null) {
      console.warn("git not available — skipping git check-ignore test");
      return;
    }
    expect(ignored).toBe(true);
  });
});

// ─── AC3: librechat/.env.example is NOT ignored ───────────────────────────────

describe("root .gitignore — librechat/.env.example is NOT ignored (AC3)", () => {
  let gitignore: string;

  beforeAll(async () => {
    gitignore = await readGitignore();
  });

  it("does not contain a pattern that would unconditionally ignore .env.example", () => {
    // A bare `.env.example` or `librechat/.env.example` negation-less ignore
    // would prevent it from being committed. Either:
    //   (a) there is no pattern matching .env.example at all, OR
    //   (b) there is a negation rule: !librechat/.env.example or !.env.example
    //
    // Check: if a broad .env* pattern exists, a negation for .env.example must follow.
    const lines = gitignore.split("\n").map((l) => l.trim());

    const hasEnvGlob = lines.some(
      (l) => !l.startsWith("#") && /^(librechat\/)?\.env\*/.test(l)
    );
    if (hasEnvGlob) {
      // A negation exception must exist somewhere after the glob
      const hasNegation = lines.some(
        (l) => /^!.*\.env\.example/.test(l)
      );
      expect(hasNegation).toBe(true);
    } else {
      // No broad glob — verify .env.example is not explicitly listed as ignored
      const directlyIgnored = lines.some(
        (l) =>
          !l.startsWith("#") &&
          !l.startsWith("!") &&
          /\.env\.example/.test(l)
      );
      expect(directlyIgnored).toBe(false);
    }
  });

  it("git check-ignore does NOT mark librechat/.env.example as ignored", async () => {
    const notIgnored = await gitWouldNotIgnore("librechat/.env.example");
    if (notIgnored === null) {
      console.warn("git not available — skipping git check-ignore test");
      return;
    }
    expect(notIgnored).toBe(true);
  });
});

// ─── Bonus: docker compose generated files ───────────────────────────────────

describe("root .gitignore — docker compose generated artefacts (AC2 extended)", () => {
  let gitignore: string;

  beforeAll(async () => {
    gitignore = await readGitignore();
  });

  it("has at least one librechat/ entry beyond the bare .env line", () => {
    // Ensures the PR adds multiple entries, not just a single .env line
    const lines = gitignore.split("\n").map((l) => l.trim());
    const librechatEntries = lines.filter(
      (l) => !l.startsWith("#") && l.startsWith("librechat/")
    );
    // We expect at minimum: librechat/.env, librechat/data/, librechat/logs/
    expect(librechatEntries.length).toBeGreaterThanOrEqual(3);
  });

  it("all librechat/ ignore entries are grouped or labelled (optional best-practice check)", () => {
    // This is a soft structural check: a comment header for the librechat
    // block makes the .gitignore more readable. We just verify the entries
    // appear in the file — grouping/comment is not strictly required.
    const hasEntries = gitignore.includes("librechat/");
    expect(hasEntries).toBe(true);
  });
});
