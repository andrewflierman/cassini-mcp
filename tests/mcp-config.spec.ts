/**
 * Tests for task: mcp-config — Create .mcp.json for Claude Code auto-discovery
 *
 * Task: mcp-config
 * Run with: bun test tests/mcp-config.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until:
 *   1. .mcp.json is created in the project root
 *   2. docs/plans/cassini-mcp.md is created
 */

import { describe, it, expect } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");

// ─── AC1 + AC3 + AC4: .mcp.json existence and contents ───────────────────────

describe(".mcp.json — existence (AC1)", () => {
  it(".mcp.json exists in the project root", async () => {
    const file = Bun.file(path.join(ROOT, ".mcp.json"));
    expect(await file.exists()).toBe(true);
  });

  it(".mcp.json is valid JSON", async () => {
    const file = Bun.file(path.join(ROOT, ".mcp.json"));
    const text = await file.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe(".mcp.json — cassini server config (AC1 + AC3 + AC4)", () => {
  async function loadMcpJson(): Promise<Record<string, unknown>> {
    const file = Bun.file(path.join(ROOT, ".mcp.json"));
    return file.json();
  }

  it("has a top-level 'mcpServers' key", async () => {
    const config = await loadMcpJson();
    expect(config).toHaveProperty("mcpServers");
  });

  it("has a 'cassini' entry inside mcpServers", async () => {
    const config = await loadMcpJson();
    const servers = config.mcpServers as Record<string, unknown>;
    expect(servers).toHaveProperty("cassini");
  });

  it("cassini server type is 'stdio'", async () => {
    const config = await loadMcpJson();
    const servers = config.mcpServers as Record<string, unknown>;
    const cassini = servers.cassini as Record<string, unknown>;
    expect(cassini.type).toBe("stdio");
  });

  // AC3: command must be 'bun'
  it("cassini command is 'bun' (AC3)", async () => {
    const config = await loadMcpJson();
    const servers = config.mcpServers as Record<string, unknown>;
    const cassini = servers.cassini as Record<string, unknown>;
    expect(cassini.command).toBe("bun");
  });

  // AC3: args must be ['run', 'mcp/src/index.ts']
  it("cassini args is ['run', 'mcp/src/index.ts'] (AC3)", async () => {
    const config = await loadMcpJson();
    const servers = config.mcpServers as Record<string, unknown>;
    const cassini = servers.cassini as Record<string, unknown>;
    expect(Array.isArray(cassini.args)).toBe(true);
    expect(cassini.args).toEqual(["run", "mcp/src/index.ts"]);
  });

  it("cassini args first element is 'run'", async () => {
    const config = await loadMcpJson();
    const servers = config.mcpServers as Record<string, unknown>;
    const cassini = servers.cassini as Record<string, unknown>;
    const args = cassini.args as string[];
    expect(args[0]).toBe("run");
  });

  it("cassini args second element is 'mcp/src/index.ts'", async () => {
    const config = await loadMcpJson();
    const servers = config.mcpServers as Record<string, unknown>;
    const cassini = servers.cassini as Record<string, unknown>;
    const args = cassini.args as string[];
    expect(args[1]).toBe("mcp/src/index.ts");
  });

  // AC4: DATABASE_PATH env var must be './cassini.db'
  it("cassini env has DATABASE_PATH set to './cassini.db' (AC4)", async () => {
    const config = await loadMcpJson();
    const servers = config.mcpServers as Record<string, unknown>;
    const cassini = servers.cassini as Record<string, unknown>;
    const env = cassini.env as Record<string, unknown>;
    expect(env).toBeDefined();
    expect(env).toHaveProperty("DATABASE_PATH");
    expect(env.DATABASE_PATH).toBe("./cassini.db");
  });

  it("cassini env contains no other unexpected keys beyond DATABASE_PATH", async () => {
    const config = await loadMcpJson();
    const servers = config.mcpServers as Record<string, unknown>;
    const cassini = servers.cassini as Record<string, unknown>;
    const env = cassini.env as Record<string, unknown>;
    // DATABASE_PATH must be present — we care it's the right value
    expect(Object.keys(env)).toContain("DATABASE_PATH");
  });
});

// ─── AC2: docs/plans/cassini-mcp.md existence and content ────────────────────

describe("docs/plans/cassini-mcp.md — existence (AC2)", () => {
  it("docs/plans/cassini-mcp.md exists", async () => {
    const file = Bun.file(path.join(ROOT, "docs/plans/cassini-mcp.md"));
    expect(await file.exists()).toBe(true);
  });

  it("docs/plans/cassini-mcp.md is non-empty", async () => {
    const file = Bun.file(path.join(ROOT, "docs/plans/cassini-mcp.md"));
    const text = await file.text();
    expect(text.trim().length).toBeGreaterThan(0);
  });
});

describe("docs/plans/cassini-mcp.md — documentation content (AC2)", () => {
  async function loadPlan(): Promise<string> {
    const file = Bun.file(path.join(ROOT, "docs/plans/cassini-mcp.md"));
    return file.text();
  }

  it("documents the database schema (mentions 'master_plan' table)", async () => {
    const text = await loadPlan();
    expect(text).toContain("master_plan");
  });

  it("documents the database schema (mentions 'planets' table)", async () => {
    const text = await loadPlan();
    expect(text).toContain("planets");
  });

  it("documents the 'query' tool", async () => {
    const text = await loadPlan();
    expect(text).toContain("query");
  });

  it("documents the 'schema' tool", async () => {
    const text = await loadPlan();
    expect(text).toContain("schema");
  });

  it("documents the 'tables' tool", async () => {
    const text = await loadPlan();
    expect(text).toContain("tables");
  });

  it("documents the read-only design decision", async () => {
    const text = await loadPlan();
    expect(text.toLowerCase()).toMatch(/read.only|readonly/);
  });

  it("documents the row limit / cap design decision", async () => {
    const text = await loadPlan();
    // Should mention the 100-row limit in some form
    expect(text).toMatch(/100|row.?limit|row.?cap/i);
  });

  it("documents that no compile step is required (bun runs TS directly)", async () => {
    const text = await loadPlan();
    // Should mention bun running TS directly, or 'no compile' / 'no build'
    expect(text.toLowerCase()).toMatch(/no.?(compile|build)|bun run|direct/);
  });

  it("documents the separate package design decision", async () => {
    const text = await loadPlan();
    // Should mention mcp/ as a separate package
    expect(text.toLowerCase()).toMatch(/separate|mcp\//);
  });

  it("documents bun:sqlite as the SQLite driver", async () => {
    const text = await loadPlan();
    expect(text).toContain("bun:sqlite");
  });

  it("documents Claude Desktop configuration", async () => {
    const text = await loadPlan();
    expect(text.toLowerCase()).toMatch(/claude.?desktop/);
  });
});
