# Cassini MCP Server — Implementation Plan

## Overview

The Cassini MCP server exposes a read-only SQLite database of Cassini mission data to
Claude and other MCP clients via the Model Context Protocol (MCP). It lives in the
`mcp/` subdirectory as a separate package and is launched directly by `bun run` with
no compile step required.

---

## Database Schema

The SQLite database (`cassini.db`) contains the following tables:

### `master_plan`
High-level mission timeline entries — orbit numbers, observation targets, dates, and
activity descriptions for the Cassini-Huygens mission.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | PK |
| orbit | INTEGER | Cassini orbit number |
| target | TEXT | Observation target (e.g. Titan, Saturn) |
| date | TEXT | ISO-8601 date |
| activity | TEXT | Description of the planned activity |

### `planets`
Reference data for the planets and major bodies visited or observed during the mission.

| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER | PK |
| name | TEXT | Body name |
| type | TEXT | Planet, moon, ring system, etc. |
| description | TEXT | Brief description |

Additional tables may be present; use the `schema` or `tables` tools to inspect the
live database.

---

## Tools Exposed (3 total)

### 1. `query`
**Description:** Execute a read-only SQL query against the Cassini mission database.

**Input:**
- `sql` (string) — A SELECT statement to run.

**Behaviour:**
- Rejects any statement matching a write-pattern regex (INSERT, UPDATE, DELETE, DROP,
  ALTER, CREATE, REPLACE, TRUNCATE, ATTACH, DETACH, REINDEX, VACUUM, or `PRAGMA x =`).
- Returns `{ rows: [...] }` as a JSON string.
- Results are capped at 100 rows (see Row Limit below).

---

### 2. `schema`
**Description:** Get the full database schema with table and column definitions.

**Input:** none

**Behaviour:**
- Queries `sqlite_master` for all user tables.
- For each table, runs `PRAGMA table_info(...)` to retrieve column names, types, and
  constraints (PK, NOT NULL).
- Returns a human-readable multi-line string.

---

### 3. `tables`
**Description:** List all tables in the database with their row counts.

**Input:** none

**Behaviour:**
- Queries `sqlite_master` for all user table names.
- For each table, issues `SELECT COUNT(*) FROM <table>`.
- Returns one line per table: `<name>: <count> rows`.

---

## Design Decisions

### Read-only access
The database is opened with `{ readonly: true }` via `bun:sqlite`. This prevents any
accidental mutation. As a second layer of defence, the `query` tool also rejects write
statements before they reach the database driver.

### No compile step
Bun executes TypeScript directly — `bun run mcp/src/index.ts` works without a prior
`tsc` or `bun build` invocation. This keeps the dev loop simple and avoids a stale
build artifact.

### Row limit (100 rows)
The `query` tool fetches at most 100 rows per query. If more rows match, the result
includes a `note` field explaining the truncation and the total match count. This
prevents runaway responses when the model queries large tables.

### Separate package (`mcp/`)
The MCP server lives in `mcp/` as its own `package.json` (`cassini-mcp`). This keeps
MCP dependencies (the `@modelcontextprotocol/sdk`, `zod`) isolated from the main
project and makes it easy to version or publish the server independently.

### `bun:sqlite` as the SQLite driver
`bun:sqlite` is a first-party, zero-dependency SQLite binding built into Bun. It
requires no npm install, starts fast, and is fully compatible with the `readonly` flag
needed for safe query execution.

---

## Configuration

### Claude Code auto-discovery (`.mcp.json`)

Place `.mcp.json` in the project root. Claude Code picks it up automatically:

```json
{
  "mcpServers": {
    "cassini": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "mcp/src/index.ts"],
      "env": {
        "DATABASE_PATH": "./cassini.db"
      }
    }
  }
}
```

### Claude Desktop configuration

Add the following to `~/Library/Application Support/Claude/claude_desktop_config.json`
(macOS) or the equivalent path on your OS:

```json
{
  "mcpServers": {
    "cassini": {
      "type": "stdio",
      "command": "bun",
      "args": ["run", "/absolute/path/to/project/mcp/src/index.ts"],
      "env": {
        "DATABASE_PATH": "/absolute/path/to/project/cassini.db"
      }
    }
  }
}
```

> **Note:** Claude Desktop requires absolute paths because it does not inherit the
> shell's working directory. Replace `/absolute/path/to/project` with the actual path
> on your machine.

---

## Running Locally

```bash
# From the project root
bun run mcp/src/index.ts
```

The server communicates over stdio using the MCP protocol and is ready to accept
tool calls immediately.
