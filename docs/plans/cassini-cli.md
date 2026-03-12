# Cassini CLI — Implementation Plan

## Overview

A terminal tool for querying the Cassini mission SQLite database using natural
language. Users type questions in plain English, Claude translates them to SQL
via the Anthropic SDK, and the CLI executes the query and displays formatted
results. Also supports direct SQL, utility commands, and an interactive REPL.

Lives in `cli/` as a separate package. TypeScript + Bun, no compile step needed
for development.

---

## Architecture

```
User input (English or SQL)
        │
        ▼
  ┌───────────┐
  │  index.ts  │  argv parsing, dispatch
  └─────┬─────┘
        │
  ┌─────┴──────────────────────┐
  │         commands.ts         │  ask, query, tables, schema
  └─────┬──────────┬───────────┘
        │          │
   ┌────▼────┐ ┌──▼───┐
   │  ai.ts  │ │ db.ts │  Anthropic SDK / bun:sqlite
   └─────────┘ └──┬───┘
                   │
              cassini.db
```

- **ai.ts** — Calls Claude Sonnet via `@anthropic-ai/sdk` to translate natural
  language into a SELECT statement. The full database schema is included in the
  system prompt so Claude knows the tables and columns.
- **db.ts** — Thin wrapper around `bun:sqlite`. Opens the database read-only,
  enforces a write-statement blocklist, and caps result rows.
- **formatter.ts** — Renders query results as aligned tables, JSON, or CSV.
- **repl.ts** — Interactive loop. Auto-detects SQL vs natural language.

---

## Database Schema

The SQLite database (`cassini.db`) contains two tables:

### `master_plan` (~61,873 rows)

| Column             | Type    | Notes    |
|--------------------|---------|----------|
| id                 | INTEGER | PK       |
| start_time_utc     | TEXT    | NOT NULL |
| duration           | TEXT    |          |
| date               | TEXT    |          |
| team               | TEXT    |          |
| spass_type          | TEXT    |          |
| target             | TEXT    |          |
| request_name       | TEXT    |          |
| library_definition | TEXT    |          |
| title              | TEXT    |          |
| description        | TEXT    |          |

14 distinct teams: CAPS, CDA, CIRS, INMS, ISS, MAG, MIMI, MP, PROBE, RADAR,
RPWS, RSS, UVIS, VIMS.

Targets include Saturn, its moons (Titan, Enceladus, Mimas, etc.), rings,
calibration targets, and others.

### `planets` (6 rows)

| Column              | Type    | Notes    |
|---------------------|---------|----------|
| id                  | INTEGER | PK       |
| name                | TEXT    | NOT NULL |
| type                | TEXT    | NOT NULL |
| parent_body         | TEXT    |          |
| distance_from_sun_km| REAL    |          |
| orbital_period_days | REAL    |          |
| radius_km           | REAL    |          |
| mass_kg             | REAL    |          |
| discovered_date     | TEXT    |          |
| discoverer          | TEXT    |          |
| notes               | TEXT    |          |

Bodies: Saturn, Titan, Enceladus, Iapetus, Rhea, Mimas.

---

## CLI Commands

### `ask` (default)

Translate a natural language question to SQL and run it.

```bash
cassini ask "what are the most observed targets?"
cassini "how many Titan flybys are there?"   # implicit ask
cassini ask "show me all RADAR team observations" --format json
cassini ask "what moons were studied?" --sql  # show SQL only
```

Output shows the generated SQL (dimmed) followed by formatted results.

### `query`

Run raw SQL directly (no AI).

```bash
cassini query "SELECT target, COUNT(*) as n FROM master_plan GROUP BY target ORDER BY n DESC LIMIT 10"
```

### `tables`

List all tables with row counts.

### `schema`

Print the full database schema.

### `repl`

Interactive mode. Auto-detects input type:
- Starts with `SELECT`, `WITH`, `PRAGMA`, `EXPLAIN` → raw SQL
- Everything else → natural language via AI
- Dot-commands: `.help`, `.tables`, `.schema`, `.format`, `.limit`, `.sql`, `.quit`

---

## Flags

| Flag              | Default        | Description                          |
|-------------------|----------------|--------------------------------------|
| `--db <path>`     | `./cassini.db` | Path to SQLite database              |
| `--limit <n>`     | `50`           | Max rows returned                    |
| `--format <fmt>`  | `table`        | Output format: `table`, `json`, `csv`|
| `--sql`           | off            | Show generated SQL without executing |
| `--help`          | —              | Print usage                          |

---

## Design Decisions

### Natural language as the primary interface

The default command is `ask` — bare positional args are treated as a question.
This makes the most common use case (`cassini "some question"`) as frictionless
as possible while keeping raw SQL available via `query`.

### Anthropic SDK (not Claude CLI)

Uses `@anthropic-ai/sdk` directly rather than shelling out to `claude -p`. This
avoids process spawning overhead, gives structured error handling, and allows
streaming in the future. Requires `ANTHROPIC_API_KEY` env var.

### Claude Sonnet for SQL generation

Uses `claude-sonnet-4-20250514` — fast, cheap, and reliably good at SQL. The full
schema is passed in the system prompt so the model knows exact table/column
names and types.

### Read-only access

The database is opened with `{ readonly: true }`. The query function also
rejects write statements via regex before execution — defense in depth.

### No compile step

Bun runs TypeScript directly. `bun cli/src/index.ts` works without building.
A compile target (`bun build --compile`) is available for distribution.

### Separate package

`cli/` is independent from `mcp/` and `loop/`. The `db.ts` module is
copied/adapted rather than imported across packages, keeping each package
self-contained.

### Row limit (50 default)

CLI defaults to 50 rows (lower than the MCP server's 100) since terminal output
is the primary consumer. Configurable via `--limit`.

---

## Dependencies

- `@anthropic-ai/sdk` — Anthropic API client
- `bun:sqlite` — built-in SQLite driver (no npm install)
- No other runtime dependencies

---

## Running

```bash
# Development
export ANTHROPIC_API_KEY=sk-ant-...
bun cli/src/index.ts "how many observations per team?"

# Interactive
bun cli/src/index.ts repl

# Compiled binary
cd cli && bun run build
./dist/cassini "what moons were observed?"
```
