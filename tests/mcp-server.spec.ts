/**
 * Tests for mcp/src/index.ts — MCP server entry point
 *
 * Task: mcp-server
 * Run with: bun test tests/mcp-server.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until
 * mcp/src/index.ts is created.
 *
 * Strategy: spawn the MCP server as a subprocess, send JSON-RPC messages
 * over stdin, and assert on the stdout responses.  This mirrors the exact
 * transport the task description requires (StdioServerTransport).
 */

import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SERVER_PATH = path.resolve(
  import.meta.dir,
  "../mcp/src/index.ts"
);

const DB_PATH = path.resolve(import.meta.dir, "../cassini.db");

/** JSON-RPC 2.0 initialize handshake required by MCP before any tool call. */
const INIT_MSG = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
});

/** MCP initialized notification (no id = notification). */
const INITIALIZED_NOTIF = JSON.stringify({
  jsonrpc: "2.0",
  method: "notifications/initialized",
  params: {},
});

/** Build a tools/call request. */
function toolCallMsg(id: number, name: string, args: Record<string, unknown> = {}) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

/** Build a tools/list request. */
function toolsListMsg(id: number) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/list",
    params: {},
  });
}

/**
 * Send a sequence of newline-delimited JSON-RPC messages to the MCP server
 * subprocess and collect all response lines.
 *
 * Each message in `messages` is sent sequentially.  The function waits for
 * the process to exit (or times out) and returns all non-empty stdout lines
 * parsed as JSON objects.
 */
async function runServer(messages: string[]): Promise<unknown[]> {
  const stdin = messages.join("\n") + "\n";

  const proc = Bun.spawn(
    ["bun", "run", SERVER_PATH],
    {
      stdin: new TextEncoder().encode(stdin),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        DATABASE_PATH: DB_PATH,
      },
    }
  );

  // Give the server time to process messages and exit gracefully
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
  await Promise.race([proc.exited, timeout]);

  const rawOut = await new Response(proc.stdout).text();

  // Each JSON-RPC response is a single line
  return rawOut
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") || line.startsWith("["))
    .map((line) => JSON.parse(line));
}

// ─── AC1: file existence ──────────────────────────────────────────────────────

describe("mcp/src/index.ts file existence", () => {
  it("mcp/src/index.ts exists", async () => {
    const file = Bun.file(SERVER_PATH);
    expect(await file.exists()).toBe(true);
  });

  it("imports from @modelcontextprotocol/sdk", async () => {
    const file = Bun.file(SERVER_PATH);
    const source = await file.text();
    expect(source).toContain("@modelcontextprotocol/sdk");
  });

  it("uses StdioServerTransport", async () => {
    const file = Bun.file(SERVER_PATH);
    const source = await file.text();
    expect(source).toContain("StdioServerTransport");
  });

  it("imports from ./db.js (ESM resolution)", async () => {
    const file = Bun.file(SERVER_PATH);
    const source = await file.text();
    expect(source).toContain("./db.js");
  });
});

// ─── AC8: JSON-RPC initialize handshake ──────────────────────────────────────

describe("JSON-RPC initialize (AC8)", () => {
  let responses: unknown[];

  beforeAll(async () => {
    responses = await runServer([INIT_MSG]);
  });

  it("returns at least one JSON-RPC response for initialize", () => {
    expect(responses.length).toBeGreaterThan(0);
  });

  it("response has jsonrpc: '2.0'", () => {
    const init = responses.find(
      (r) => (r as Record<string, unknown>).id === 1
    ) as Record<string, unknown>;
    expect(init).toBeDefined();
    expect(init.jsonrpc).toBe("2.0");
  });

  it("response has a result object (not an error)", () => {
    const init = responses.find(
      (r) => (r as Record<string, unknown>).id === 1
    ) as Record<string, unknown>;
    expect(init.result).toBeDefined();
    expect(init.error).toBeUndefined();
  });

  it("initialize result contains serverInfo.name = 'cassini'", () => {
    const init = responses.find(
      (r) => (r as Record<string, unknown>).id === 1
    ) as Record<string, unknown>;
    const result = init.result as Record<string, unknown>;
    const serverInfo = result.serverInfo as Record<string, unknown>;
    expect(serverInfo).toBeDefined();
    expect(serverInfo.name).toBe("cassini");
  });
});

// ─── AC2: tools/list exposes query, schema, tables ───────────────────────────

describe("tools/list — exposed tools (AC2)", () => {
  let responses: unknown[];

  beforeAll(async () => {
    responses = await runServer([
      INIT_MSG,
      INITIALIZED_NOTIF,
      toolsListMsg(2),
    ]);
  });

  it("returns a tools/list response with id=2", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 2
    ) as Record<string, unknown> | undefined;
    expect(resp).toBeDefined();
  });

  it("result.tools is an array", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 2
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    expect(Array.isArray(result.tools)).toBe(true);
  });

  it("exposes the 'query' tool", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 2
    ) as Record<string, unknown>;
    const tools = (resp.result as Record<string, unknown>).tools as Array<
      Record<string, unknown>
    >;
    const names = tools.map((t) => t.name);
    expect(names).toContain("query");
  });

  it("exposes the 'schema' tool", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 2
    ) as Record<string, unknown>;
    const tools = (resp.result as Record<string, unknown>).tools as Array<
      Record<string, unknown>
    >;
    const names = tools.map((t) => t.name);
    expect(names).toContain("schema");
  });

  it("exposes the 'tables' tool", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 2
    ) as Record<string, unknown>;
    const tools = (resp.result as Record<string, unknown>).tools as Array<
      Record<string, unknown>
    >;
    const names = tools.map((t) => t.name);
    expect(names).toContain("tables");
  });

  it("'query' tool has an input schema with a required 'sql' property", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 2
    ) as Record<string, unknown>;
    const tools = (resp.result as Record<string, unknown>).tools as Array<
      Record<string, unknown>
    >;
    const queryTool = tools.find((t) => t.name === "query") as Record<
      string,
      unknown
    >;
    expect(queryTool).toBeDefined();
    const schema = queryTool.inputSchema as Record<string, unknown>;
    expect(schema).toBeDefined();
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("sql");
  });
});

// ─── AC3: query tool ─────────────────────────────────────────────────────────

describe("query tool (AC3)", () => {
  let responses: unknown[];

  beforeAll(async () => {
    responses = await runServer([
      INIT_MSG,
      INITIALIZED_NOTIF,
      toolCallMsg(3, "query", { sql: "SELECT * FROM planets" }),
    ]);
  });

  it("returns a response for the query tool call", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 3
    );
    expect(resp).toBeDefined();
  });

  it("result.content is an array", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 3
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    expect(Array.isArray(result.content)).toBe(true);
  });

  it("result.content[0].type is 'text'", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 3
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
  });

  it("returns JSON rows — text is valid JSON with a 'rows' array", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 3
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const text = content[0].text as string;
    const parsed = JSON.parse(text);
    expect(parsed).toHaveProperty("rows");
    expect(Array.isArray(parsed.rows)).toBe(true);
  });

  it("returns 6 rows for SELECT * FROM planets", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 3
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const text = content[0].text as string;
    const parsed = JSON.parse(text);
    expect(parsed.rows).toHaveLength(6);
  });

  it("rows contain planet name data (Saturn present)", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 3
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const text = content[0].text as string;
    const parsed = JSON.parse(text);
    const names = parsed.rows.map((r: Record<string, unknown>) => r.name);
    expect(names).toContain("Saturn");
  });
});

// ─── AC3 (query): error handling ─────────────────────────────────────────────

describe("query tool — error handling (AC6)", () => {
  let responses: unknown[];

  beforeAll(async () => {
    responses = await runServer([
      INIT_MSG,
      INITIALIZED_NOTIF,
      toolCallMsg(4, "query", { sql: "SELECT * FROM nonexistent_table_xyz" }),
    ]);
  });

  it("returns a response for the failing query call", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 4
    );
    expect(resp).toBeDefined();
  });

  it("sets isError: true on the response for an invalid query", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 4
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    expect(result.isError).toBe(true);
  });

  it("content[0].text contains 'Error' for an invalid query", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 4
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    expect((content[0].text as string).toLowerCase()).toContain("error");
  });
});

// ─── AC3 (query): write rejection propagated as isError ──────────────────────

describe("query tool — write rejection (AC6)", () => {
  let responses: unknown[];

  beforeAll(async () => {
    responses = await runServer([
      INIT_MSG,
      INITIALIZED_NOTIF,
      toolCallMsg(5, "query", {
        sql: "INSERT INTO planets (name) VALUES ('Pluto')",
      }),
    ]);
  });

  it("returns isError: true when a write statement is attempted", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 5
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    expect(result.isError).toBe(true);
  });
});

// ─── AC4: schema tool ────────────────────────────────────────────────────────

describe("schema tool (AC4)", () => {
  let responses: unknown[];

  beforeAll(async () => {
    responses = await runServer([
      INIT_MSG,
      INITIALIZED_NOTIF,
      toolCallMsg(6, "schema"),
    ]);
  });

  it("returns a response for the schema tool call", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 6
    );
    expect(resp).toBeDefined();
  });

  it("result.content[0].type is 'text'", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 6
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
  });

  it("schema text includes 'master_plan' table name", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 6
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].text as string).toContain("master_plan");
  });

  it("schema text includes 'planets' table name", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 6
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].text as string).toContain("planets");
  });

  it("schema text includes column type information", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 6
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const text = content[0].text as string;
    expect(text).toMatch(/INTEGER|TEXT|REAL|NUMERIC|BLOB/i);
  });

  it("schema text includes PK or NOT NULL flags", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 6
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const text = content[0].text as string;
    expect(text).toMatch(/PK|NOT NULL|notnull/i);
  });

  it("isError is not true (schema succeeds)", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 6
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    expect(result.isError).not.toBe(true);
  });
});

// ─── AC5: tables tool ────────────────────────────────────────────────────────

describe("tables tool (AC5)", () => {
  let responses: unknown[];

  beforeAll(async () => {
    responses = await runServer([
      INIT_MSG,
      INITIALIZED_NOTIF,
      toolCallMsg(7, "tables"),
    ]);
  });

  it("returns a response for the tables tool call", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 7
    );
    expect(resp).toBeDefined();
  });

  it("result.content[0].type is 'text'", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 7
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
  });

  it("tables text includes 'master_plan'", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 7
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].text as string).toContain("master_plan");
  });

  it("tables text includes 'planets'", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 7
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].text as string).toContain("planets");
  });

  it("tables text includes a row count number for master_plan (e.g. '61873 rows')", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 7
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const text = content[0].text as string;
    // Should contain a digit followed by ' rows' on the master_plan line
    const masterPlanLine = text
      .split("\n")
      .find((l) => l.includes("master_plan"));
    expect(masterPlanLine).toBeDefined();
    expect(masterPlanLine).toMatch(/\d+\s*rows?/i);
  });

  it("tables text format matches 'table_name: N rows' pattern", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 7
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    const content = result.content as Array<Record<string, unknown>>;
    const text = content[0].text as string;
    // At least one line must match the expected format
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    const hasFormatted = lines.some((l) => /^[\w_]+:\s+\d+\s+rows?$/i.test(l.trim()));
    expect(hasFormatted).toBe(true);
  });

  it("isError is not true (tables succeeds)", () => {
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 7
    ) as Record<string, unknown>;
    const result = resp.result as Record<string, unknown>;
    expect(result.isError).not.toBe(true);
  });
});

// ─── AC6: error handling — schema and tables also handle errors gracefully ────

describe("schema and tables tools — no input, no crash (AC6)", () => {
  it("schema tool does not return an error under normal conditions", async () => {
    const responses = await runServer([
      INIT_MSG,
      INITIALIZED_NOTIF,
      toolCallMsg(8, "schema"),
    ]);
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 8
    ) as Record<string, unknown>;
    expect(resp).toBeDefined();
    const result = resp.result as Record<string, unknown>;
    expect(result.isError).not.toBe(true);
  });

  it("tables tool does not return an error under normal conditions", async () => {
    const responses = await runServer([
      INIT_MSG,
      INITIALIZED_NOTIF,
      toolCallMsg(9, "tables"),
    ]);
    const resp = responses.find(
      (r) => (r as Record<string, unknown>).id === 9
    ) as Record<string, unknown>;
    expect(resp).toBeDefined();
    const result = resp.result as Record<string, unknown>;
    expect(result.isError).not.toBe(true);
  });
});

// ─── AC7: StdioServerTransport in source ─────────────────────────────────────

describe("StdioServerTransport (AC7)", () => {
  it("source imports StdioServerTransport from @modelcontextprotocol/sdk/server/stdio.js", async () => {
    const file = Bun.file(SERVER_PATH);
    const source = await file.text();
    expect(source).toContain("stdio.js");
    expect(source).toContain("StdioServerTransport");
  });

  it("source creates a McpServer named 'cassini'", async () => {
    const file = Bun.file(SERVER_PATH);
    const source = await file.text();
    expect(source).toContain("cassini");
  });

  it("source calls server.connect(transport)", async () => {
    const file = Bun.file(SERVER_PATH);
    const source = await file.text();
    expect(source).toContain("server.connect");
  });
});
