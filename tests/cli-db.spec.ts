/**
 * Tests for cli/src/db.ts — database module adapted from mcp/src/db.ts
 *
 * Task: cli-db
 * Run with: bun test tests/cli-db.spec.ts
 *
 * These tests are written BEFORE full implementation and will fail until
 * cli/src/db.ts is updated to match all acceptance criteria:
 *
 *   AC1: exports openDb, getSchema, query, queryRaw, getTableList
 *   AC2: queryRaw returns an array of row objects (not a JSON string)
 *   AC3: queryRaw respects the limit parameter
 *   AC4: Write statements are rejected with an error
 *   AC5: getTableList returns [{ name, count }] for each table
 */

import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";

// The module under test
import {
  openDb,
  getSchema,
  query,
  queryRaw,
  getTableList,
} from "../cli/src/db";

// Path to the real cassini.db in the project root
const DB_PATH = path.resolve(import.meta.dir, "../cassini.db");

// ─── AC1: All five functions are exported ─────────────────────────────────────

describe("cli/src/db.ts — exports (AC1)", () => {
  it("exports openDb as a function", () => {
    expect(typeof openDb).toBe("function");
  });

  it("exports getSchema as a function", () => {
    expect(typeof getSchema).toBe("function");
  });

  it("exports query as a function", () => {
    expect(typeof query).toBe("function");
  });

  it("exports queryRaw as a function", () => {
    expect(typeof queryRaw).toBe("function");
  });

  it("exports getTableList as a function", () => {
    expect(typeof getTableList).toBe("function");
  });
});

// ─── openDb — unchanged from mcp version ─────────────────────────────────────

describe("openDb", () => {
  it("opens cassini.db without throwing", () => {
    expect(() => openDb(DB_PATH)).not.toThrow();
  });

  it("opens the database in read-only mode (write attempt throws)", () => {
    const db = openDb(DB_PATH);
    expect(() => {
      db.run("CREATE TABLE IF NOT EXISTS _rw_test (id INTEGER)");
    }).toThrow();
  });

  it("resolves relative paths (does not throw on relative input)", () => {
    const cwd = process.cwd();
    const relativePath = path.relative(cwd, DB_PATH);
    expect(() => openDb(relativePath)).not.toThrow();
  });
});

// ─── getSchema — unchanged from mcp version ──────────────────────────────────

describe("getSchema", () => {
  let db: ReturnType<typeof openDb>;

  beforeAll(() => {
    db = openDb(DB_PATH);
  });

  it("returns a non-empty string", () => {
    const schema = getSchema(db);
    expect(typeof schema).toBe("string");
    expect(schema.length).toBeGreaterThan(0);
  });

  it("includes known table names", () => {
    const schema = getSchema(db);
    expect(schema).toContain("master_plan");
    expect(schema).toContain("planets");
  });

  it("includes column type information", () => {
    const schema = getSchema(db);
    expect(schema).toMatch(/INTEGER|TEXT|REAL|NUMERIC|BLOB/i);
  });
});

// ─── AC1 + AC4: query — JSON-string wrapper with configurable limit ───────────

describe("query (AC1, AC4)", () => {
  let db: ReturnType<typeof openDb>;

  beforeAll(() => {
    db = openDb(DB_PATH);
  });

  it("returns a JSON string with a 'rows' array for a valid SELECT", () => {
    const result = query(db, "SELECT * FROM planets");
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("rows");
    expect(Array.isArray(parsed.rows)).toBe(true);
  });

  it("returns all 6 planet rows with no limit override", () => {
    const result = query(db, "SELECT * FROM planets");
    const parsed = JSON.parse(result);
    expect(parsed.rows).toHaveLength(6);
  });

  // AC3 (via query wrapper): default limit is 50
  it("caps results at the default limit of 50 when table has more rows", () => {
    // master_plan has tens of thousands of rows — must be capped at 50
    const result = query(db, "SELECT * FROM master_plan");
    const parsed = JSON.parse(result);
    expect(parsed.rows).toHaveLength(50);
  });

  it("respects a caller-supplied limit parameter", () => {
    const result = query(db, "SELECT * FROM master_plan", 10);
    const parsed = JSON.parse(result);
    expect(parsed.rows).toHaveLength(10);
  });

  it("adds a truncation note when results are capped", () => {
    const result = query(db, "SELECT * FROM master_plan");
    const parsed = JSON.parse(result);
    const hasNote =
      typeof parsed.note === "string" ||
      typeof parsed.truncated === "boolean" ||
      result.includes("truncat") ||
      result.includes("more") ||
      result.includes("limit");
    expect(hasNote).toBe(true);
  });

  it("does NOT add a truncation note when all rows fit within the limit", () => {
    // planets has 6 rows — well under the default 50
    const result = query(db, "SELECT * FROM planets");
    const parsed = JSON.parse(result);
    expect(parsed.note).toBeUndefined();
  });

  // AC4: write-pattern guard
  it("throws on INSERT", () => {
    expect(() => {
      query(db, "INSERT INTO planets (name) VALUES ('Pluto')");
    }).toThrow();
  });

  it("throws on UPDATE", () => {
    expect(() => {
      query(db, "UPDATE planets SET name = 'X' WHERE id = 1");
    }).toThrow();
  });

  it("throws on DELETE", () => {
    expect(() => {
      query(db, "DELETE FROM planets WHERE id = 1");
    }).toThrow();
  });

  it("throws on DROP", () => {
    expect(() => {
      query(db, "DROP TABLE planets");
    }).toThrow();
  });

  it("write-check is case-insensitive (lowercase insert throws)", () => {
    expect(() => {
      query(db, "insert into planets (name) values ('Pluto')");
    }).toThrow();
  });

  it("does NOT throw on a read-only PRAGMA (no =)", () => {
    expect(() => {
      query(db, "PRAGMA table_info(planets)");
    }).not.toThrow();
  });
});

// ─── AC2 + AC3 + AC4: queryRaw ───────────────────────────────────────────────

describe("queryRaw (AC2, AC3, AC4)", () => {
  let db: ReturnType<typeof openDb>;

  beforeAll(() => {
    db = openDb(DB_PATH);
  });

  // AC2: returns an array of objects, NOT a JSON string
  it("returns an array (not a string)", () => {
    const result = queryRaw(db, "SELECT * FROM planets");
    expect(Array.isArray(result)).toBe(true);
  });

  it("returns plain row objects (not a JSON string)", () => {
    const result = queryRaw(db, "SELECT * FROM planets");
    expect(typeof result).not.toBe("string");
    // Each element should be a plain object
    expect(typeof result[0]).toBe("object");
    expect(result[0]).not.toBeNull();
  });

  it("returns all 6 planet rows when under the default limit", () => {
    const result = queryRaw(db, "SELECT * FROM planets");
    expect(result).toHaveLength(6);
  });

  it("row objects contain the expected columns (id, name present)", () => {
    const result = queryRaw(db, "SELECT * FROM planets ORDER BY id");
    expect(result[0]).toHaveProperty("id");
    expect(result[0]).toHaveProperty("name");
  });

  it("planet rows include Saturn", () => {
    const result = queryRaw(db, "SELECT name FROM planets ORDER BY id");
    const names = result.map((r) => (r as Record<string, unknown>).name);
    expect(names).toContain("Saturn");
  });

  // AC3: respects limit parameter
  it("defaults to a limit of 50 when no limit is provided", () => {
    // master_plan has tens of thousands of rows
    const result = queryRaw(db, "SELECT * FROM master_plan");
    expect(result.length).toBeLessThanOrEqual(50);
    expect(result).toHaveLength(50);
  });

  it("respects a caller-supplied limit of 10", () => {
    const result = queryRaw(db, "SELECT * FROM master_plan", 10);
    expect(result).toHaveLength(10);
  });

  it("respects a caller-supplied limit of 1", () => {
    const result = queryRaw(db, "SELECT * FROM master_plan", 1);
    expect(result).toHaveLength(1);
  });

  it("respects a caller-supplied limit of 200 (returns all if fewer rows exist)", () => {
    // planets has only 6 rows — all should be returned even with a limit of 200
    const result = queryRaw(db, "SELECT * FROM planets", 200);
    expect(result).toHaveLength(6);
  });

  // AC4: write-pattern guard
  it("throws on INSERT", () => {
    expect(() => {
      queryRaw(db, "INSERT INTO planets (name) VALUES ('Pluto')");
    }).toThrow();
  });

  it("throws on UPDATE", () => {
    expect(() => {
      queryRaw(db, "UPDATE planets SET name = 'X' WHERE id = 1");
    }).toThrow();
  });

  it("throws on DELETE", () => {
    expect(() => {
      queryRaw(db, "DELETE FROM planets WHERE id = 1");
    }).toThrow();
  });

  it("throws on DROP", () => {
    expect(() => {
      queryRaw(db, "DROP TABLE planets");
    }).toThrow();
  });

  it("throws on ALTER", () => {
    expect(() => {
      queryRaw(db, "ALTER TABLE planets ADD COLUMN foo TEXT");
    }).toThrow();
  });

  it("throws on CREATE", () => {
    expect(() => {
      queryRaw(db, "CREATE TABLE foo (id INTEGER)");
    }).toThrow();
  });

  it("write-check is case-insensitive (lowercase insert throws)", () => {
    expect(() => {
      queryRaw(db, "insert into planets (name) values ('Pluto')");
    }).toThrow();
  });

  it("throws on PRAGMA with = (write PRAGMA)", () => {
    expect(() => {
      queryRaw(db, "PRAGMA journal_mode = WAL");
    }).toThrow();
  });

  it("does NOT throw on a read-only PRAGMA (no =)", () => {
    expect(() => {
      queryRaw(db, "PRAGMA table_info(planets)");
    }).not.toThrow();
  });
});

// ─── AC5: getTableList ────────────────────────────────────────────────────────

describe("getTableList (AC5)", () => {
  let db: ReturnType<typeof openDb>;

  beforeAll(() => {
    db = openDb(DB_PATH);
  });

  it("returns an array", () => {
    const tables = getTableList(db);
    expect(Array.isArray(tables)).toBe(true);
  });

  it("returns a non-empty list (cassini.db has at least one table)", () => {
    const tables = getTableList(db);
    expect(tables.length).toBeGreaterThan(0);
  });

  it("each entry has a 'name' string property", () => {
    const tables = getTableList(db);
    for (const entry of tables) {
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
    }
  });

  // AC5: property must be named 'count', not 'rows'
  it("each entry has a 'count' number property (not 'rows')", () => {
    const tables = getTableList(db);
    for (const entry of tables) {
      expect(entry).toHaveProperty("count");
      expect(typeof entry.count).toBe("number");
    }
  });

  it("does NOT have a 'rows' property on entries (must use 'count')", () => {
    const tables = getTableList(db);
    for (const entry of tables) {
      expect(entry).not.toHaveProperty("rows");
    }
  });

  it("includes a 'planets' table entry", () => {
    const tables = getTableList(db);
    const planetsEntry = tables.find((t) => t.name === "planets");
    expect(planetsEntry).toBeDefined();
  });

  it("includes a 'master_plan' table entry", () => {
    const tables = getTableList(db);
    const mpEntry = tables.find((t) => t.name === "master_plan");
    expect(mpEntry).toBeDefined();
  });

  it("reports the correct row count for planets (6 rows)", () => {
    const tables = getTableList(db);
    const planetsEntry = tables.find((t) => t.name === "planets");
    expect(planetsEntry?.count).toBe(6);
  });

  it("reports a large row count for master_plan (> 1000 rows)", () => {
    const tables = getTableList(db);
    const mpEntry = tables.find((t) => t.name === "master_plan");
    expect(mpEntry?.count).toBeGreaterThan(1000);
  });
});
