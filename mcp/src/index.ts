import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { openDb, getSchema, query } from "./db.js";

const dbPath = process.env.DATABASE_PATH ?? "./cassini.db";
const db = openDb(dbPath);

const server = new McpServer({ name: "cassini", version: "1.0.0" });

// Tool 1: Execute a read-only SQL query and return JSON rows
server.tool(
  "query",
  "Execute a read-only SQL query against the Cassini mission database",
  { sql: z.string() },
  async ({ sql }) => {
    try {
      const text = query(db, sql);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool 2: Return human-readable database schema (all tables and columns)
server.tool(
  "schema",
  "Get the full database schema with table and column definitions",
  async () => {
    try {
      const text = getSchema(db);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

// Tool 3: List all user tables with their row counts
server.tool(
  "tables",
  "List all tables in the database with their row counts",
  async () => {
    try {
      const tables = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all();

      const lines: string[] = [];
      for (const { name } of tables) {
        const result = db
          .query<{ count: number }, []>(`SELECT COUNT(*) as count FROM ${JSON.stringify(name)}`)
          .get();
        const count = result?.count ?? 0;
        lines.push(`${name}: ${count} rows`);
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `Error: ${message}` }],
        isError: true,
      };
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
