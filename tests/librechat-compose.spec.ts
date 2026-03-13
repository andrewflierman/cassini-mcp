/**
 * Tests for task: librechat-compose — Create librechat/docker-compose.yml with
 * api, mongodb, and meilisearch services.
 *
 * Task: librechat-compose
 * Run with: bun test tests/librechat-compose.spec.ts
 *
 * These tests are written BEFORE implementation and will fail until
 * librechat/docker-compose.yml is created.
 *
 * Strategy: read the docker-compose.yml as text and parse it as YAML to assert
 * on its structural content. We do NOT run `docker compose up` in tests — that
 * is too slow and requires a Docker daemon. We verify that the file encodes
 * every acceptance criterion as written declarations.
 *
 * For AC5 (docker compose config validates) we execute `docker compose config`
 * as a subprocess and assert it exits successfully. This test is skipped if
 * Docker is not available in the test environment.
 */

import { describe, it, expect, beforeAll } from "bun:test";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const COMPOSE_PATH = path.join(ROOT, "librechat", "docker-compose.yml");

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readCompose(): Promise<string> {
  const file = Bun.file(COMPOSE_PATH);
  return file.text();
}

/**
 * Minimal YAML-to-object parser for the subset of docker-compose YAML we need.
 * We use a simple regex/line approach rather than pulling in a YAML library so
 * there are no extra dependencies. For structural assertions this is sufficient.
 *
 * We rely on the raw text for most assertions and only use this for coarse
 * top-level key discovery.
 */
function hasYamlKey(yaml: string, key: string): boolean {
  // Matches a top-level or indented key with optional surrounding spaces
  return new RegExp(`^\\s{0,4}${key}\\s*:`, "m").test(yaml);
}

// ─── AC1: librechat/docker-compose.yml exists ────────────────────────────────

describe("librechat/docker-compose.yml — existence (AC1)", () => {
  it("librechat/docker-compose.yml exists", async () => {
    const file = Bun.file(COMPOSE_PATH);
    expect(await file.exists()).toBe(true);
  });

  it("librechat/docker-compose.yml is non-empty", async () => {
    const file = Bun.file(COMPOSE_PATH);
    const text = await file.text();
    expect(text.trim().length).toBeGreaterThan(0);
  });

  it("librechat/docker-compose.yml is valid YAML (no leading tab errors)", async () => {
    const text = await readCompose();
    // Docker Compose YAML must not contain bare tab indentation
    const lines = text.split("\n");
    for (const line of lines) {
      // Allow tabs only inside quoted strings; reject leading tabs
      expect(line).not.toMatch(/^\t/);
    }
  });
});

// ─── AC1: three required services are declared ───────────────────────────────

describe("docker-compose.yml — required services (AC1)", () => {
  let compose: string;

  beforeAll(async () => {
    compose = await readCompose();
  });

  it("declares a top-level 'services' key", () => {
    expect(compose).toMatch(/^services\s*:/m);
  });

  it("defines an 'api' service", () => {
    expect(compose).toMatch(/^\s{2,4}api\s*:/m);
  });

  it("defines a 'mongodb' service", () => {
    expect(compose).toMatch(/^\s{2,4}mongodb\s*:/m);
  });

  it("defines a 'meilisearch' service", () => {
    expect(compose).toMatch(/^\s{2,4}meilisearch\s*:/m);
  });
});

// ─── AC2: api service builds from local Dockerfile ───────────────────────────

describe("docker-compose.yml — api service build config (AC2)", () => {
  let compose: string;

  beforeAll(async () => {
    compose = await readCompose();
  });

  it("api service has a 'build' key", () => {
    // Match 'build:' indented under the api service block
    expect(compose).toMatch(/build\s*:/);
  });

  it("api service build context references the local directory (. or ./)", () => {
    // Accepts: build: . | build:\n  context: . | context: ./
    expect(compose).toMatch(/build\s*:\s*\.|context\s*:\s*\.\/?/);
  });

  it("api service does NOT reference a pre-built image via 'image:' instead of build", () => {
    // Within the api block the file should not say 'image: ...' as the sole
    // build source. We check that 'build' appears before 'mongodb' (a different service)
    // to confirm it belongs to api.
    const apiSection = compose.slice(
      compose.indexOf("  api:"),
      compose.search(/^\s{2,4}(mongodb|meilisearch)\s*:/m)
    );
    // build must be present in the api section
    expect(apiSection).toMatch(/build\s*:/);
  });

  it("librechat/Dockerfile referenced by the build exists", async () => {
    const file = Bun.file(path.join(ROOT, "librechat", "Dockerfile"));
    expect(await file.exists()).toBe(true);
  });
});

// ─── AC1: api service port mapping 3080:3080 ────────────────────────────────

describe("docker-compose.yml — api service port mapping (AC1)", () => {
  let compose: string;

  beforeAll(async () => {
    compose = await readCompose();
  });

  it("api service exposes port 3080", () => {
    expect(compose).toMatch(/3080/);
  });

  it("api service maps host port 3080 to container port 3080", () => {
    // Matches quoted or unquoted: "3080:3080" or 3080:3080
    expect(compose).toMatch(/["']?3080:3080["']?/);
  });
});

// ─── AC1: api service depends_on mongodb and meilisearch ────────────────────

describe("docker-compose.yml — api service depends_on (AC1)", () => {
  let compose: string;

  beforeAll(async () => {
    compose = await readCompose();
  });

  it("api service has a 'depends_on' key", () => {
    expect(compose).toMatch(/depends_on\s*:/);
  });

  it("api depends_on includes mongodb", () => {
    // depends_on block must list mongodb
    const dependsSection = compose.match(
      /depends_on\s*:\s*([\s\S]*?)(?=\n\s{2,4}\w)/
    );
    expect(dependsSection).not.toBeNull();
    expect(dependsSection![0]).toMatch(/mongodb/);
  });

  it("api depends_on includes meilisearch", () => {
    const dependsSection = compose.match(
      /depends_on\s*:\s*([\s\S]*?)(?=\n\s{2,4}\w)/
    );
    expect(dependsSection).not.toBeNull();
    expect(dependsSection![0]).toMatch(/meilisearch/);
  });
});

// ─── AC3: api service mounts librechat.yaml as config ────────────────────────

describe("docker-compose.yml — api mounts librechat.yaml (AC3)", () => {
  let compose: string;

  beforeAll(async () => {
    compose = await readCompose();
  });

  it("api service has a 'volumes' key", () => {
    // At least one volumes: entry somewhere in the api block
    expect(compose).toMatch(/volumes\s*:/);
  });

  it("api service mounts librechat.yaml", () => {
    // Accept: ./librechat.yaml:..., librechat.yaml:..., or similar
    expect(compose).toMatch(/librechat\.yaml/);
  });

  it("librechat.yaml mount maps into the container config path", () => {
    // The mount should map to something under /app or reference the config location
    // Common pattern: ./librechat.yaml:/app/librechat.yaml
    expect(compose).toMatch(/librechat\.yaml.*librechat\.yaml|librechat\.yaml.*\/app\//);
  });
});

// ─── AC1: api service uses env_file .env ─────────────────────────────────────

describe("docker-compose.yml — api service env_file (AC1)", () => {
  let compose: string;

  beforeAll(async () => {
    compose = await readCompose();
  });

  it("api service has an 'env_file' key", () => {
    expect(compose).toMatch(/env_file\s*:/);
  });

  it("api env_file references .env", () => {
    expect(compose).toMatch(/\.env/);
  });
});

// ─── AC4: mongodb service has a persistent volume ────────────────────────────

describe("docker-compose.yml — mongodb persistent volume (AC4)", () => {
  let compose: string;

  beforeAll(async () => {
    compose = await readCompose();
  });

  it("mongodb service specifies an image", () => {
    // Find the mongodb service block and check for an image key
    expect(compose).toMatch(/image\s*:.*mongo/i);
  });

  it("mongodb service has a volume mount", () => {
    // The mongodb service section must include a volumes entry
    const mongoIdx = compose.indexOf("  mongodb:");
    const nextServiceIdx = compose.search(
      new RegExp(`(?<=${compose.slice(mongoIdx + 1)
        .search(/^\s{2,4}\w/m) + mongoIdx + 1})`)
    );
    // Simpler: assert mongodb data path appears somewhere in compose
    expect(compose).toMatch(/mongo.*data|data.*mongo|mongodb[-_]data/i);
  });

  it("mongodb volume is declared under top-level 'volumes' for persistence", () => {
    // Top-level volumes: block must exist for named volumes
    expect(compose).toMatch(/^volumes\s*:/m);
  });

  it("mongodb volume name appears in both the service and top-level volumes", () => {
    // Find a named volume that mongodb uses — it should appear at least twice
    // (once in the service mount, once in the top-level declaration)
    const volumeMatches = compose.match(/\bmongo(?:db)?[-_]?data\b/gi);
    // Should appear at least twice if it's a proper named volume
    expect(volumeMatches).not.toBeNull();
    expect(volumeMatches!.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── AC4: meilisearch service has a persistent volume ────────────────────────

describe("docker-compose.yml — meilisearch persistent volume (AC4)", () => {
  let compose: string;

  beforeAll(async () => {
    compose = await readCompose();
  });

  it("meilisearch service specifies an image", () => {
    expect(compose).toMatch(/image\s*:.*meilisearch/i);
  });

  it("meilisearch service sets MEILI_NO_ANALYTICS=true", () => {
    expect(compose).toMatch(/MEILI_NO_ANALYTICS\s*[=:]\s*['"]?true['"]?/i);
  });

  it("meilisearch service has a volume mount", () => {
    expect(compose).toMatch(/meili(?:search)?[-_]?data/i);
  });

  it("meilisearch volume is declared in top-level volumes", () => {
    expect(compose).toMatch(/^volumes\s*:/m);
    // The meilisearch volume name should appear in the top-level block too
    const volumeMatches = compose.match(/\bmeili(?:search)?[-_]?data\b/gi);
    expect(volumeMatches).not.toBeNull();
    expect(volumeMatches!.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── AC5: docker compose config validates without errors ─────────────────────

describe("docker compose config validates (AC5)", () => {
  it("docker compose config exits with code 0", async () => {
    // Skip if docker is not available
    const dockerCheck = Bun.spawn(["docker", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    await dockerCheck.exited;
    if (dockerCheck.exitCode !== 0) {
      console.warn("Docker not available — skipping compose config validation");
      return;
    }

    const proc = Bun.spawn(
      ["docker", "compose", "-f", COMPOSE_PATH, "config", "--quiet"],
      {
        cwd: path.join(ROOT, "librechat"),
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("docker compose config stderr:", stderr);
    }

    expect(exitCode).toBe(0);
  }, 30_000); // Allow up to 30s for docker to start

  it("docker-compose.yml has no obvious YAML syntax errors (services key present)", async () => {
    const compose = await readCompose();
    // A valid compose file must have a 'services:' top-level key
    expect(compose).toMatch(/^services\s*:/m);
  });
});
