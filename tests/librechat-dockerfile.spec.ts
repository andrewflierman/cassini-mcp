/**
 * Tests for task: librechat-dockerfile — Create librechat/Dockerfile extending
 * LibreChat with Bun + Cassini MCP server.
 *
 * Task: librechat-dockerfile
 * Run with: bun test tests/librechat-dockerfile.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until
 * librechat/Dockerfile is created.
 *
 * Strategy: read the Dockerfile as text and assert on its structural content
 * (FROM, RUN, COPY, etc.). We do NOT build the image in tests — that is too
 * slow and requires a Docker daemon. Instead we verify that the Dockerfile
 * encodes every acceptance criterion as written instructions, and that the
 * file structure expected by those instructions exists in the repo.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const DOCKERFILE_PATH = path.join(ROOT, "librechat", "Dockerfile");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readDockerfile(): Promise<string> {
  const file = Bun.file(DOCKERFILE_PATH);
  return file.text();
}

// ─── AC1: librechat/Dockerfile exists ────────────────────────────────────────

describe("librechat/Dockerfile — existence (AC1)", () => {
  it("librechat/Dockerfile exists", async () => {
    const file = Bun.file(DOCKERFILE_PATH);
    expect(await file.exists()).toBe(true);
  });

  it("librechat/Dockerfile is non-empty", async () => {
    const file = Bun.file(DOCKERFILE_PATH);
    const text = await file.text();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("librechat/ directory exists", async () => {
    const file = Bun.file(path.join(ROOT, "librechat", "Dockerfile"));
    // If the file exists, the directory implicitly exists. But we verify
    // the directory itself is accessible by checking the file exists.
    expect(await file.exists()).toBe(true);
  });
});

// ─── AC4: Image extends official LibreChat base ───────────────────────────────

describe("Dockerfile — base image is official LibreChat (AC4)", () => {
  let dockerfile: string;

  beforeAll(async () => {
    dockerfile = await readDockerfile();
  });

  it("has a FROM instruction", () => {
    expect(dockerfile).toMatch(/^FROM\s+/im);
  });

  it("FROM references ghcr.io/danny-avila/librechat", () => {
    // Accept both :latest and a pinned digest/tag
    expect(dockerfile).toMatch(/FROM\s+ghcr\.io\/danny-avila\/librechat/i);
  });

  it("FROM is the first non-comment, non-blank instruction", () => {
    const lines = dockerfile
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));
    expect(lines[0]).toMatch(/^FROM\s+/i);
  });

  it("does NOT use a completely unrelated base image (e.g. ubuntu, alpine alone)", () => {
    // The FROM line must not reference a non-LibreChat image as the sole stage
    const fromLines = dockerfile
      .split("\n")
      .filter((l) => /^\s*FROM\s+/i.test(l));
    // At least one FROM must point to the LibreChat registry
    const hasLibreChat = fromLines.some((l) =>
      /ghcr\.io\/danny-avila\/librechat/i.test(l)
    );
    expect(hasLibreChat).toBe(true);
  });
});

// ─── AC2: Built image contains bun binary ─────────────────────────────────────

describe("Dockerfile — installs Bun runtime (AC2)", () => {
  let dockerfile: string;

  beforeAll(async () => {
    dockerfile = await readDockerfile();
  });

  it("has at least one RUN instruction that references bun", () => {
    expect(dockerfile).toMatch(/RUN\s+.*bun/i);
  });

  it("installs Bun via the official install script (bun.sh/install)", () => {
    expect(dockerfile).toMatch(/bun\.sh\/install/);
  });

  it("uses curl to fetch the Bun install script", () => {
    expect(dockerfile).toMatch(/curl\s+.*bun\.sh\/install/);
  });

  it("curl invocation uses -fsSL flags (silent, follow redirects, fail on error)", () => {
    // Accept any ordering of flags: -fsSL, -sSLf, etc.
    expect(dockerfile).toMatch(/curl\s+(-\w*f\w*s\w*L\w*|-\w*s\w*S\w*L\w*|-fsSL|-sSLf)/);
  });

  it("pipes install script into bash (| bash)", () => {
    expect(dockerfile).toMatch(/\|\s*bash/);
  });

  it("adds ~/.bun/bin to PATH or uses ENV PATH to make bun available", () => {
    // Bun installs to ~/.bun/bin — the Dockerfile must expose it on PATH
    // Accept ENV PATH=..., ENV PATH .bun/bin..., or a symlink RUN ln -s
    const hasBunPath =
      /\.bun[\\/]bin/i.test(dockerfile) ||
      /ENV\s+PATH.*bun/i.test(dockerfile) ||
      /ln\s+-s.*bun/i.test(dockerfile);
    expect(hasBunPath).toBe(true);
  });
});

// ─── AC3: Built image contains mcp-server/ with node_modules ─────────────────

describe("Dockerfile — copies mcp-server/ and runs bun install (AC3)", () => {
  let dockerfile: string;

  beforeAll(async () => {
    dockerfile = await readDockerfile();
  });

  it("has a COPY instruction that copies the mcp-server/ directory", () => {
    // Matches: COPY mcp-server/ ..., COPY ./mcp-server/ ..., COPY mcp/ ..., etc.
    expect(dockerfile).toMatch(/COPY\s+\.?\/?mcp[-_]?server\//i);
  });

  it("COPY instruction copies mcp-server/ into the image (destination is set)", () => {
    // The COPY line must have both a source and a destination
    const copyLine = dockerfile
      .split("\n")
      .find((l) => /COPY\s+\.?\/?mcp[-_]?server\//i.test(l));
    expect(copyLine).toBeDefined();
    // A COPY instruction with source + destination has at least two path tokens
    const parts = copyLine!.trim().split(/\s+/);
    expect(parts.length).toBeGreaterThanOrEqual(3); // COPY <src> <dest>
  });

  it("has a RUN instruction that runs bun install inside the mcp directory", () => {
    // Accept: RUN bun install, RUN cd /app/mcp-server && bun install, etc.
    expect(dockerfile).toMatch(/RUN\s+.*bun\s+install/i);
  });

  it("bun install runs in the context of the mcp-server directory", () => {
    // The bun install invocation must either: use WORKDIR, use cd, or reference the path
    const bunInstallLine = dockerfile
      .split("\n")
      .find((l) => /RUN\s+.*bun\s+install/i.test(l));
    expect(bunInstallLine).toBeDefined();

    // Check that either a WORKDIR pointing to mcp-server precedes it, or
    // the RUN line contains a cd into the mcp-server directory
    const hasCd = /cd\s+.*mcp[-_]?server/i.test(bunInstallLine!);
    const hasWorkdirBefore =
      /WORKDIR\s+.*mcp[-_]?server/i.test(dockerfile) ||
      /WORKDIR\s+\/app\/mcp/i.test(dockerfile);
    expect(hasCd || hasWorkdirBefore).toBe(true);
  });

  it("COPY happens before bun install (correct ordering)", () => {
    const lines = dockerfile.split("\n");
    const copyIdx = lines.findIndex((l) =>
      /COPY\s+\.?\/?mcp[-_]?server\//i.test(l)
    );
    const bunInstallIdx = lines.findIndex((l) =>
      /RUN\s+.*bun\s+install/i.test(l)
    );
    expect(copyIdx).toBeGreaterThanOrEqual(0);
    expect(bunInstallIdx).toBeGreaterThanOrEqual(0);
    expect(copyIdx).toBeLessThan(bunInstallIdx);
  });
});

// ─── mcp/ source directory exists in the repo ─────────────────────────────────

describe("Repository — mcp/ source directory is present to be COPYed (AC3)", () => {
  it("mcp/ directory exists with a package.json", async () => {
    const file = Bun.file(path.join(ROOT, "mcp", "package.json"));
    expect(await file.exists()).toBe(true);
  });

  it("mcp/src/index.ts exists (entry point that will be copied)", async () => {
    const file = Bun.file(path.join(ROOT, "mcp", "src", "index.ts"));
    expect(await file.exists()).toBe(true);
  });

  it("mcp/package.json lists @modelcontextprotocol/sdk as a dependency (bun install will resolve it)", async () => {
    const file = Bun.file(path.join(ROOT, "mcp", "package.json"));
    const pkg = await file.json() as Record<string, unknown>;
    const deps = {
      ...(pkg.dependencies as Record<string, unknown> ?? {}),
      ...(pkg.devDependencies as Record<string, unknown> ?? {}),
    };
    expect(deps).toHaveProperty("@modelcontextprotocol/sdk");
  });
});

// ─── Dockerfile structural sanity ─────────────────────────────────────────────

describe("Dockerfile — structural sanity", () => {
  let dockerfile: string;

  beforeAll(async () => {
    dockerfile = await readDockerfile();
  });

  it("does not use CMD or ENTRYPOINT to launch the MCP server (it is invoked at runtime via stdio)", () => {
    // The MCP server is stdio-invoked by LibreChat at runtime — the Dockerfile
    // should NOT override LibreChat's own ENTRYPOINT/CMD for the MCP server.
    // If CMD/ENTRYPOINT appear they should not reference the MCP server entry point.
    const cmdLines = dockerfile
      .split("\n")
      .filter((l) => /^\s*(CMD|ENTRYPOINT)\s+/i.test(l));
    const hasMcpEntrypoint = cmdLines.some((l) =>
      /mcp[-_]?server|index\.ts/i.test(l)
    );
    expect(hasMcpEntrypoint).toBe(false);
  });

  it("does not have syntax errors — all RUN instructions have a command after RUN", () => {
    const runLines = dockerfile
      .split("\n")
      .filter((l) => /^\s*RUN\s*/i.test(l));
    for (const line of runLines) {
      // RUN followed by at least one non-whitespace character
      expect(line.trim()).toMatch(/^RUN\s+\S+/i);
    }
  });

  it("does not have a bare FROM with no image name", () => {
    const fromLines = dockerfile
      .split("\n")
      .filter((l) => /^\s*FROM\s*/i.test(l));
    for (const line of fromLines) {
      expect(line.trim()).toMatch(/^FROM\s+\S+/i);
    }
  });
});
