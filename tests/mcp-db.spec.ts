/**
 * Tests for mcp/src/db.ts — SQLite helper module
 *
 * Task: mcp-db
 * Run with: bun test tests/mcp-db.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until
 * mcp/src/db.ts is created.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import path from "path";

// The module under test — will fail to import until implementation exists
import { openDb, getSchema, query } from "../mcp/src/db";

// Path to the real cassini.db in the project root
const DB_PATH = path.resolve(import.meta.dir, "../cassini.db");

// ─── AC1 + AC2: package.json and tsconfig.json existence ─────────────────────
describe("mcp/ package files", () => {
  it("mcp/package.json exists with @modelcontextprotocol/sdk and zod, without better-sqlite3", async () => {
    const pkgPath = path.resolve(import.meta.dir, "../mcp/package.json");
    const file = Bun.file(pkgPath);
    expect(await file.exists()).toBe(true);

    const pkg = await file.json();
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    expect(deps).toHaveProperty("@modelcontextprotocol/sdk");
    expect(deps).toHaveProperty("zod");
    expect(deps).not.toHaveProperty("better-sqlite3");
  });

  it("mcp/tsconfig.json exists", async () => {
    const tscPath = path.resolve(import.meta.dir, "../mcp/tsconfig.json");
    const file = Bun.file(tscPath);
    expect(await file.exists()).toBe(true);

    const tsconfig = await file.json();
    // Should have compilerOptions — minimal sanity check
    expect(tsconfig).toHaveProperty("compilerOptions");
  });
});

// ─── AC3 + AC4: openDb ────────────────────────────────────────────────────────
describe("openDb", () => {
  it("exports openDb as a function", () => {
    expect(typeof openDb).toBe("function");
  });

  it("opens cassini.db without throwing", () => {
    expect(() => openDb(DB_PATH)).not.toThrow();
  });

  it("opens the database in read-only mode (write attempt throws)", () => {
    const db = openDb(DB_PATH);
    // A write attempt against a read-only db should throw at the sqlite level
    expect(() => {
      db.run("CREATE TABLE IF NOT EXISTS _rw_test (id INTEGER)");
    }).toThrow();
  });

  it("resolves relative paths via path.resolve (does not throw on relative input)", () => {
    // openDb should call path.resolve internally so relative paths work
    // We pass a relative path that resolves to the same cassini.db
    const cwd = process.cwd();
    const relativePath = path.relative(cwd, DB_PATH);
    expect(() => openDb(relativePath)).not.toThrow();
  });
});

// ─── AC3: getSchema ───────────────────────────────────────────────────────────
describe("getSchema", () => {
  let db: ReturnType<typeof openDb>;

  beforeAll(() => {
    db = openDb(DB_PATH);
  });

  it("exports getSchema as a function", () => {
    expect(typeof getSchema).toBe("function");
  });

  it("returns a non-empty string", () => {
    const schema = getSchema(db);
    expect(typeof schema).toBe("string");
    expect(schema.length).toBeGreaterThan(0);
  });

  it("includes the 'master_plan' table name", () => {
    const schema = getSchema(db);
    expect(schema).toContain("master_plan");
  });

  it("includes the 'planets' table name", () => {
    const schema = getSchema(db);
    expect(schema).toContain("planets");
  });

  it("includes column names for master_plan (id, start_time_utc, target)", () => {
    const schema = getSchema(db);
    expect(schema).toContain("id");
    expect(schema).toContain("start_time_utc");
    expect(schema).toContain("target");
  });

  it("includes column names for planets (name, type, discoverer)", () => {
    const schema = getSchema(db);
    expect(schema).toContain("name");
    expect(schema).toContain("type");
    expect(schema).toContain("discoverer");
  });

  it("includes column type information", () => {
    // The schema should show SQLite types (INTEGER, TEXT, REAL, etc.)
    const schema = getSchema(db);
    expect(schema).toMatch(/INTEGER|TEXT|REAL|NUMERIC|BLOB/i);
  });

  it("includes PK or NOT NULL flag indicators", () => {
    // The schema should mention pk or not null in some form
    const schema = getSchema(db);
    expect(schema).toMatch(/PK|NOT NULL|notnull|pk/i);
  });
});

// ─── AC3 + AC5 + AC6: query ───────────────────────────────────────────────────
describe("query", () => {
  let db: ReturnType<typeof openDb>;

  beforeAll(() => {
    db = openDb(DB_PATH);
  });

  it("exports query as a function", () => {
    expect(typeof query).toBe("function");
  });

  it("returns a JSON string with a 'rows' array for a valid SELECT", () => {
    const result = query(db, "SELECT * FROM planets");
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("rows");
    expect(Array.isArray(parsed.rows)).toBe(true);
  });

  it("returns all 6 planets rows for SELECT * FROM planets", () => {
    const result = query(db, "SELECT * FROM planets");
    const parsed = JSON.parse(result);
    expect(parsed.rows).toHaveLength(6);
  });

  it("returns correct column data (planet names present)", () => {
    const result = query(db, "SELECT name FROM planets ORDER BY id");
    const parsed = JSON.parse(result);
    const names = parsed.rows.map((r: Record<string, unknown>) => r.name);
    // The planets table should contain Saturn at minimum (Cassini mission)
    expect(names).toContain("Saturn");
  });

  // AC6: 100-row cap
  it("caps results at 100 rows when more exist", () => {
    // master_plan has ~61,873 rows — well over the 100-row cap
    const result = query(db, "SELECT * FROM master_plan");
    const parsed = JSON.parse(result);
    expect(parsed.rows).toHaveLength(100);
  });

  it("adds a truncation note when results are capped", () => {
    const result = query(db, "SELECT * FROM master_plan");
    const parsed = JSON.parse(result);
    // The truncation note should appear somewhere — either as a property or
    // appended to the JSON string
    const hasNote =
      typeof parsed.note === "string" ||
      typeof parsed.truncated === "boolean" ||
      result.includes("truncat") ||
      result.includes("more") ||
      result.includes("limit");
    expect(hasNote).toBe(true);
  });

  it("does NOT cap results when fewer than 100 rows exist", () => {
    // planets has 6 rows — should return all 6, no cap
    const result = query(db, "SELECT * FROM planets");
    const parsed = JSON.parse(result);
    expect(parsed.rows).toHaveLength(6);
  });

  // AC5: reject write statements
  it("throws or rejects an INSERT statement", () => {
    expect(() => {
      query(db, "INSERT INTO planets (name) VALUES ('Pluto')");
    }).toThrow();
  });

  it("throws or rejects an UPDATE statement", () => {
    expect(() => {
      query(db, "UPDATE planets SET name = 'X' WHERE id = 1");
    }).toThrow();
  });

  it("throws or rejects a DELETE statement", () => {
    expect(() => {
      query(db, "DELETE FROM planets WHERE id = 1");
    }).toThrow();
  });

  it("throws or rejects a DROP statement", () => {
    expect(() => {
      query(db, "DROP TABLE planets");
    }).toThrow();
  });

  it("throws or rejects an ALTER statement", () => {
    expect(() => {
      query(db, "ALTER TABLE planets ADD COLUMN foo TEXT");
    }).toThrow();
  });

  it("throws or rejects a CREATE statement", () => {
    expect(() => {
      query(db, "CREATE TABLE foo (id INTEGER)");
    }).toThrow();
  });

  it("throws or rejects a REPLACE statement", () => {
    expect(() => {
      query(db, "REPLACE INTO planets (id, name) VALUES (1, 'Mars')");
    }).toThrow();
  });

  it("throws or rejects a TRUNCATE statement", () => {
    expect(() => {
      query(db, "TRUNCATE TABLE planets");
    }).toThrow();
  });

  it("throws or rejects a PRAGMA with assignment (=)", () => {
    expect(() => {
      query(db, "PRAGMA journal_mode = WAL");
    }).toThrow();
  });

  it("does NOT reject a read-only PRAGMA (no =)", () => {
    // PRAGMA without assignment is a read — should be allowed
    expect(() => {
      query(db, "PRAGMA table_info(planets)");
    }).not.toThrow();
  });

  it("write-check is case-insensitive (lowercase insert throws)", () => {
    expect(() => {
      query(db, "insert into planets (name) values ('Pluto')");
    }).toThrow();
  });

  it("write-check is case-insensitive (mixed-case Delete throws)", () => {
    expect(() => {
      query(db, "Delete FROM planets WHERE id = 1");
    }).toThrow();
  });
});
