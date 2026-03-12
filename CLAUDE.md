# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

This repo contains **agentloop** — a CLI that orchestrates multiple Claude subprocesses as an automated build pipeline. It reads a PRD (`prd.json`), plans task execution order using Claude, then runs parallel agent waves (test-writer → builder → code-reviewer → git-committer) with a live terminal dashboard. The full process is documented in `ORCHESTRATION.md`.

## Commands

```bash
# Dev mode (from repo root)
cd loop && bun dev

# Build compiled binary
cd loop && bun build src/index.ts --compile --outfile=dist/agentloop

# Run compiled binary (from target project root)
agentloop                  # new run
agentloop --resume         # resume previous run
agentloop --branch <name>  # specify feature branch

# Install dependencies
cd loop && bun install
```

## Rules

- Do not say a problem is fixed unless the app can build.
- Never run anything against prod unless explicitly told to.
- Never install packages by editing `package.json` directly — use the package manager CLI.
- GitHub is the source of truth for all task state. All `gh` CLI calls use the `gh` tool.

## Architecture

### agentloop CLI (`loop/`)

TypeScript + Bun. Entry point: `loop/src/index.ts` → `loop/src/commands/run.ts`.

- **`lib/prd.ts`** — Reads/writes `prd.json` from the target project root. Defines `Task`, `Prd`, and `VerificationCheck` types.
- **`lib/state.ts`** — Run state persisted to `.agentloop/state.json`. Tracks per-task status (`pending` → `testing` → `building` → `reviewing` → `verifying` → `committed` → `done` | `failed`).
- **`commands/run.ts`** — Main execution engine. Plans execution order via `claude -p` (no tools, pure reasoning), builds dependency waves via topological sort, runs tasks in parallel within each wave.
- **`ui/dashboard.ts`** — Full-screen alternate-buffer terminal dashboard, refreshed every 120ms.
- **`ui/theme.ts`** — Chalk colors, box-drawing, spinner frames, terminal width helpers.

### Agent Subprocess Model

Each agent is a `claude -p` subprocess with `--stream-json --verbose --dangerously-skip-permissions`. Agent definitions live in `.claude/agents/` as markdown with YAML frontmatter (`model`, `tools`). The CLI strips `CLAUDECODE`/`CLAUDE_CODE_SSE_PORT`/`CLAUDE_CODE_ENTRYPOINT` env vars so subprocesses don't conflict with the parent session.

Pipeline per task: `test-writer` → builders (parallel for `both` type) → `code-reviewer` (up to 6 attempts with rebuild loops) → optional `agent-browser` verification → `git-committer`. A `pm` agent runs once after all tasks complete.

### Agent Definitions (`agents/`)

- **`tester.md`** — Writes failing tests before implementation. Hard stops if any test passes at write time.
- **`builder.md`** — Implements code until all tests pass. Never alters tests — outputs `BLOCKED:` if a test seems wrong.
- **`reviewer.md`** — Read-only audit. Emits `SHIP IT` or `CHANGES NEEDED` with specific fix instructions.

### Browser Verification

Tasks with `verification` checks use `agent-browser` CLI for headless browser assertions (get count/text/attr, is visible, screenshot). A local dev server is spun up per task on port `3000 + task digit offset`.

### Key File Locations (in target projects)

| File | Purpose |
|------|---------|
| `prd.json` | PRD with sprint name, tasks, acceptance criteria, verification checks |
| `.agentloop/state.json` | Run state (created at runtime) |
| `.agentloop/logs/<runId>/` | Per-task, per-agent log files |
| `.claude/agents/` | Agent definition markdown files |
| `.claude/task-issues.json` | Task ID → GitHub issue number mapping |
| `.claude/verify/<feature>/` | Verification shell scripts per task |
| `/docs/plans/<feature>.md` | Plan documents created during brainstorming |
