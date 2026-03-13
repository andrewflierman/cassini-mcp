/**
 * Tests for task: librechat-config — Create librechat/librechat.yaml and
 * librechat/.env.example.
 *
 * Task: librechat-config
 * Run with: bun test tests/librechat-config.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. librechat/librechat.yaml is created
 *   2. librechat/.env.example is created
 *
 * Strategy: read the files as text and parse YAML / scan for env var lines.
 * We do NOT start LibreChat in tests — validation is purely structural, just
 * as librechat-dockerfile.spec.ts validates the Dockerfile without building it.
 *
 * YAML parsing uses the `yaml` package already present in the mcp workspace.
 * If unavailable we fall back to a lightweight hand-rolled check on raw text.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const YAML_PATH = path.join(ROOT, "librechat", "librechat.yaml");
const ENV_EXAMPLE_PATH = path.join(ROOT, "librechat", ".env.example");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readYaml(): Promise<string> {
  const file = Bun.file(YAML_PATH);
  return file.text();
}

async function readEnvExample(): Promise<string> {
  const file = Bun.file(ENV_EXAMPLE_PATH);
  return file.text();
}

/**
 * Minimal YAML → JS object parser using the `yaml` npm package if it is
 * installed, otherwise returns null (tests that need parsed data will skip
 * gracefully via a guard).
 *
 * We import dynamically so the test file doesn't hard-fail at module load
 * time if the package isn't installed yet.
 */
async function parseYaml(text: string): Promise<Record<string, unknown> | null> {
  try {
    // Try the yaml package from mcp/node_modules
    const mod = await import("../mcp/node_modules/yaml/dist/index.js").catch(() => null)
      ?? await import("yaml").catch(() => null);
    if (mod && typeof mod.parse === "function") {
      return mod.parse(text) as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return null;
}

// ─── AC1: librechat/librechat.yaml — existence ────────────────────────────────

describe("librechat/librechat.yaml — existence (AC1)", () => {
  it("librechat/librechat.yaml exists", async () => {
    const file = Bun.file(YAML_PATH);
    expect(await file.exists()).toBe(true);
  });

  it("librechat/librechat.yaml is non-empty", async () => {
    const text = await readYaml();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

// ─── AC4: YAML is valid and follows LibreChat config schema ──────────────────

describe("librechat.yaml — YAML validity (AC4)", () => {
  let yaml: string;

  beforeAll(async () => {
    yaml = await readYaml();
  });

  it("does not contain tab characters (YAML forbids tabs as indentation)", () => {
    // YAML indentation must use spaces, not tabs
    const lines = yaml.split("\n");
    for (const line of lines) {
      // A line that starts with a tab is invalid YAML
      expect(line).not.toMatch(/^\t/);
    }
  });

  it("contains a 'version' key at the top level (LibreChat schema requirement)", () => {
    // LibreChat requires a version field: e.g., version: 1.1
    expect(yaml).toMatch(/^\s*version\s*:/im);
  });

  it("version value is a recognised LibreChat config version (1.0 or 1.1)", () => {
    // Match: version: 1.1 or version: "1.1" or version: 1.0
    expect(yaml).toMatch(/^\s*version\s*:\s*["']?(1\.0|1\.1)["']?\s*$/im);
  });

  it("contains a 'mcpServers' key", () => {
    expect(yaml).toMatch(/^\s*mcpServers\s*:/im);
  });
});

// ─── AC1: librechat.yaml — Cassini MCP server is configured via stdio ─────────

describe("librechat.yaml — Cassini MCP stdio config (AC1)", () => {
  let yaml: string;

  beforeAll(async () => {
    yaml = await readYaml();
  });

  it("defines a server named 'cassini' under mcpServers", () => {
    // Matches:  cassini:  (possibly indented)
    expect(yaml).toMatch(/^\s{2,}cassini\s*:/im);
  });

  it("cassini server has type: stdio", () => {
    expect(yaml).toMatch(/type\s*:\s*["']?stdio["']?/i);
  });

  it("cassini server has a 'command' field", () => {
    expect(yaml).toMatch(/^\s+command\s*:/im);
  });

  it("command is 'bun' (the Bun runtime executable)", () => {
    // Matches: command: bun  or  command: "bun"
    expect(yaml).toMatch(/command\s*:\s*["']?bun["']?/i);
  });

  it("cassini server has an 'args' field", () => {
    expect(yaml).toMatch(/^\s+args\s*:/im);
  });

  it("args contains 'run' as the first argument", () => {
    // YAML list item: - run  (with optional quotes)
    expect(yaml).toMatch(/^\s+-\s+["']?run["']?\s*$/im);
  });

  // AC3: command path must match Dockerfile COPY destination (/app/mcp-server/index.ts)
  it("args contains the MCP server entry point path /app/mcp-server/index.ts (AC3)", () => {
    expect(yaml).toMatch(/\/app\/mcp-server\/index\.ts/);
  });

  it("the entry point path in args is the second list item (after 'run')", () => {
    // Find the block of args list items; 'run' must precede the path
    const runIdx = yaml.search(/^\s+-\s+["']?run["']?\s*$/im);
    const pathIdx = yaml.search(/\/app\/mcp-server\/index\.ts/);
    expect(runIdx).toBeGreaterThanOrEqual(0);
    expect(pathIdx).toBeGreaterThanOrEqual(0);
    // 'run' item appears before the path in the file
    expect(runIdx).toBeLessThan(pathIdx);
  });
});

// ─── AC3: MCP server command path matches Dockerfile COPY destination ─────────

describe("librechat.yaml — MCP path consistency with Dockerfile (AC3)", () => {
  let yaml: string;
  let dockerfile: string;

  beforeAll(async () => {
    yaml = await readYaml();
    const dfFile = Bun.file(path.join(ROOT, "librechat", "Dockerfile"));
    dockerfile = await dfFile.text();
  });

  it("Dockerfile COPYs mcp-server/ into /app/mcp-server/", () => {
    // This is the source-of-truth for the path — verify it hasn't changed
    expect(dockerfile).toMatch(/COPY\s+\.?\/?mcp[-_]?server\/\s+\/app\/mcp-server\//i);
  });

  it("librechat.yaml command path starts with /app/mcp-server/ (matches Dockerfile COPY dest)", () => {
    // The YAML must reference /app/mcp-server/ — not a different location
    expect(yaml).toMatch(/\/app\/mcp-server\//);
  });

  it("librechat.yaml does NOT reference a local/dev path (no './mcp' or '../mcp')", () => {
    // The YAML is for the Docker image — must use the in-image absolute path
    expect(yaml).not.toMatch(/["']?\.{1,2}\/mcp/);
  });
});

// ─── AC1: librechat.yaml — optional but recommended env var for the DB ────────

describe("librechat.yaml — MCP server environment (AC1)", () => {
  let yaml: string;

  beforeAll(async () => {
    yaml = await readYaml();
  });

  it("cassini server block includes an 'env' section (optional but expected)", () => {
    // LibreChat passes env vars to the spawned stdio process
    expect(yaml).toMatch(/^\s+env\s*:/im);
  });

  it("env section sets DATABASE_PATH for the cassini process", () => {
    // The MCP server reads DATABASE_PATH to locate the SQLite file
    expect(yaml).toMatch(/DATABASE_PATH\s*:/i);
  });
});

// ─── AC2: librechat/.env.example — existence ──────────────────────────────────

describe("librechat/.env.example — existence (AC2)", () => {
  it("librechat/.env.example exists", async () => {
    const file = Bun.file(ENV_EXAMPLE_PATH);
    expect(await file.exists()).toBe(true);
  });

  it("librechat/.env.example is non-empty", async () => {
    const text = await readEnvExample();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

// ─── AC2: librechat/.env.example — required environment variables ─────────────

describe("librechat/.env.example — required env vars (AC2)", () => {
  let env: string;

  beforeAll(async () => {
    env = await readEnvExample();
  });

  it("ANTHROPIC_API_KEY is listed (AI provider key)", () => {
    expect(env).toMatch(/^\s*ANTHROPIC_API_KEY\s*=/im);
  });

  it("ANTHROPIC_API_KEY has a placeholder value, not a real key", () => {
    // Real Anthropic keys start with sk-ant-. The example must NOT contain a real key.
    expect(env).not.toMatch(/ANTHROPIC_API_KEY\s*=\s*sk-ant-[A-Za-z0-9]/);
    // But it must have some non-empty placeholder
    expect(env).toMatch(/ANTHROPIC_API_KEY\s*=\s*.+/i);
  });

  it("MONGO_URI is listed (MongoDB connection string)", () => {
    expect(env).toMatch(/^\s*MONGO_URI\s*=/im);
  });

  it("MONGO_URI references the 'mongodb' service host (Docker Compose service name)", () => {
    // Standard Docker Compose service DNS: mongodb://mongodb:27017/...
    expect(env).toMatch(/MONGO_URI\s*=.*mongodb:\/\/mongodb/i);
  });

  it("MONGO_URI references the LibreChat database", () => {
    // The database name should be LibreChat
    expect(env).toMatch(/MONGO_URI\s*=.*LibreChat/i);
  });

  it("MEILI_HOST is listed (MeiliSearch host)", () => {
    expect(env).toMatch(/^\s*MEILI_HOST\s*=/im);
  });

  it("MEILI_HOST references the 'meilisearch' service host on port 7700", () => {
    // Standard Docker Compose service DNS: http://meilisearch:7700
    expect(env).toMatch(/MEILI_HOST\s*=.*http:\/\/meilisearch:7700/i);
  });

  it("MEILI_MASTER_KEY is listed (MeiliSearch auth key)", () => {
    // Required for securing MeiliSearch
    expect(env).toMatch(/^\s*MEILI_MASTER_KEY\s*=/im);
  });

  it("CREDS_KEY is listed (LibreChat credentials encryption key)", () => {
    // 32-byte hex key used by LibreChat to encrypt stored credentials
    expect(env).toMatch(/^\s*CREDS_KEY\s*=/im);
  });

  it("CREDS_IV is listed (LibreChat credentials encryption IV)", () => {
    // 16-byte hex IV paired with CREDS_KEY
    expect(env).toMatch(/^\s*CREDS_IV\s*=/im);
  });

  it("JWT_SECRET is listed (session token signing key)", () => {
    expect(env).toMatch(/^\s*JWT_SECRET\s*=/im);
  });

  it("JWT_REFRESH_SECRET is listed (refresh token signing key)", () => {
    expect(env).toMatch(/^\s*JWT_REFRESH_SECRET\s*=/im);
  });
});

// ─── AC2: .env.example — file format sanity ───────────────────────────────────

describe("librechat/.env.example — file format sanity (AC2)", () => {
  let env: string;

  beforeAll(async () => {
    env = await readEnvExample();
  });

  it("every non-comment, non-blank line is a KEY=value assignment", () => {
    const lines = env
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    for (const line of lines) {
      // Must match KEY=value (value may be empty)
      expect(line).toMatch(/^[A-Z][A-Z0-9_]*\s*=/);
    }
  });

  it("does not contain Windows line endings (CRLF)", () => {
    expect(env).not.toContain("\r\n");
  });

  it("has at least 7 variable definitions (covers the minimum required set)", () => {
    const assignments = env
      .split("\n")
      .filter((l) => /^\s*[A-Z][A-Z0-9_]*\s*=/.test(l));
    expect(assignments.length).toBeGreaterThanOrEqual(7);
  });
});

// ─── Parsed YAML structural validation (best-effort, requires yaml package) ───

describe("librechat.yaml — parsed structure (AC1 + AC4, best-effort)", () => {
  let raw: string;
  let parsed: Record<string, unknown> | null;

  beforeAll(async () => {
    raw = await readYaml();
    parsed = await parseYaml(raw);
  });

  it("parses without throwing (valid YAML)", async () => {
    // If parser is available, verify no parse error; otherwise pass trivially.
    if (parsed !== null) {
      expect(parsed).toBeDefined();
      expect(typeof parsed).toBe("object");
    } else {
      // Parser unavailable — verify at least the raw text has key markers
      expect(raw).toMatch(/mcpServers/);
    }
  });

  it("parsed top-level has 'mcpServers' key", async () => {
    if (parsed === null) {
      // Fallback: raw text check
      expect(raw).toMatch(/mcpServers\s*:/);
      return;
    }
    expect(parsed).toHaveProperty("mcpServers");
  });

  it("parsed mcpServers.cassini exists", async () => {
    if (parsed === null) {
      expect(raw).toMatch(/cassini\s*:/);
      return;
    }
    const mcp = parsed.mcpServers as Record<string, unknown>;
    expect(mcp).toHaveProperty("cassini");
  });

  it("parsed cassini.type is 'stdio'", async () => {
    if (parsed === null) {
      expect(raw).toMatch(/type\s*:\s*stdio/i);
      return;
    }
    const mcp = parsed.mcpServers as Record<string, unknown>;
    const cassini = mcp.cassini as Record<string, unknown>;
    expect(cassini.type).toBe("stdio");
  });

  it("parsed cassini.command is 'bun'", async () => {
    if (parsed === null) {
      expect(raw).toMatch(/command\s*:\s*bun/i);
      return;
    }
    const mcp = parsed.mcpServers as Record<string, unknown>;
    const cassini = mcp.cassini as Record<string, unknown>;
    expect(cassini.command).toBe("bun");
  });

  it("parsed cassini.args is an array with 'run' as first element", async () => {
    if (parsed === null) {
      expect(raw).toMatch(/- run/i);
      return;
    }
    const mcp = parsed.mcpServers as Record<string, unknown>;
    const cassini = mcp.cassini as Record<string, unknown>;
    expect(Array.isArray(cassini.args)).toBe(true);
    const args = cassini.args as string[];
    expect(args[0]).toBe("run");
  });

  it("parsed cassini.args second element is '/app/mcp-server/index.ts'", async () => {
    if (parsed === null) {
      expect(raw).toMatch(/\/app\/mcp-server\/index\.ts/);
      return;
    }
    const mcp = parsed.mcpServers as Record<string, unknown>;
    const cassini = mcp.cassini as Record<string, unknown>;
    const args = cassini.args as string[];
    expect(args[1]).toBe("/app/mcp-server/index.ts");
  });
});
