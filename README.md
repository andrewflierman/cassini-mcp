# agentloop

**PRD in. Committed code out. No human in the loop.**

agentloop is a CLI that orchestrates a team of AI agents to build software autonomously. You give it a product requirements doc. It figures out the execution order, spins up parallel waves of test-writers, builders, and code reviewers — and doesn't stop until every task is committed or it's tried six times and given up.

You don't babysit it. You don't approve PRs mid-run. You hit enter and walk away.

---

## The problem

AI coding assistants are fast, but they still need you in the chair. You prompt, you review, you course-correct, you re-prompt. For a 10-task feature, that's hours of back-and-forth — and you're the bottleneck.

agentloop removes you from the loop entirely. It runs the full software development lifecycle — testing, building, reviewing, committing — as a pipeline of specialized agents that check each other's work.

---

## How it works

```
prd.json
  │
  ▼
┌──────────────────────────────────────┐
│  Planner (Claude, no tools)          │
│  Reads tasks, builds dependency graph│
│  Groups into parallel waves          │
└──────────────┬───────────────────────┘
               │
     ┌─────────▼─────────┐
     │  Wave 1            │
     │  ┌───────────────┐ │
     │  │ Task A        │ │  Each task runs the full pipeline:
     │  │ Task B        │ │
     │  │ (parallel)    │ │  test-writer ──▶ builder(s) ──▶ reviewer
     │  └───────────────┘ │                                  │
     └─────────┬──────────┘                    ┌─────────────┤
               │                               │ SHIP IT     │ CHANGES NEEDED
     ┌─────────▼─────────┐                     ▼             ▼
     │  Wave 2            │               committer     rebuild + re-review
     │  (depends on W1)   │                              (up to 6 attempts)
     └─────────┬──────────┘
               │
     ┌─────────▼─────────┐
     │  PM Agent          │
     │  Writes sprint     │
     │  summary           │
     └────────────────────┘
```

### The agents

Each agent is a Claude subprocess with its own role, tools, and constraints:

| Agent | Job | Key constraint |
|-------|-----|----------------|
| **test-writer** | Writes failing tests before any code exists | Hard stop if a test passes at write time |
| **builder** | Writes code until all tests pass | Never touches a test — flags it and stops if one seems wrong |
| **code-reviewer** | Read-only audit of the finished work | Emits `SHIP IT` or `CHANGES NEEDED` with specific fixes |
| **git-committer** | Commits after reviewer approval | Only runs after `SHIP IT` |
| **pm** | Writes a sprint summary after all tasks complete | Runs once at the end |

The review loop is the quality gate. If the reviewer says `CHANGES NEEDED`, agentloop sends the feedback back to the builder and tries again — up to 6 cycles. This isn't retry-and-hope. The reviewer gives specific fix instructions, and the builder addresses them.

### Live dashboard

While all of this runs, a full-screen terminal dashboard shows real-time progress — which agents are active, what they're doing, bytes written, elapsed time, and wave progress. When it's done, you get a final summary of what shipped and what didn't.

### GitHub integration

If you set up a `.claude/task-issues.json` mapping task IDs to GitHub issue numbers, agentloop updates issue titles with status emojis in real-time and posts the sprint summary to the epic issue when the run completes. If the file isn't there, GitHub integration is silently off — nothing breaks.

---

## Quick start

```bash
# Build the CLI
cd loop && bun install && bun build src/index.ts --compile --outfile=dist/agentloop

# From your project root (where prd.json lives)
agentloop                  # new run
agentloop --resume         # resume a previous run
agentloop --branch feature # specify a feature branch
```

You'll need:
- [Bun](https://bun.sh) for building
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude`) on your PATH
- A `prd.json` in your project root
- Agent definitions in `.claude/agents/`

---

## Project structure

```
loop/                      # The CLI itself (TypeScript + Bun)
  src/
    index.ts               # Entry point
    commands/run.ts         # Main execution engine
    lib/prd.ts              # PRD reader
    lib/state.ts            # Run state persistence
    lib/github.ts           # GitHub integration (fire-and-forget)
    ui/dashboard.ts         # Terminal dashboard
    ui/theme.ts             # Colors, icons, box-drawing

.claude/agents/            # Agent definitions (per project)
.agentloop/                # Runtime artifacts (created during runs)
  state.json               # Current run state
  logs/<runId>/             # Per-task, per-agent logs
```

---

## Why this architecture

**Test-first by design.** The test-writer runs before any implementation exists. Builders write code to make tests pass, not the other way around. This means the acceptance criteria are encoded as executable checks before a single line of production code is written.

**Agents that check each other.** The builder can't mark its own homework. A separate reviewer agent — with read-only tools — audits the work and can send it back. This catches the kind of "looks good to me" drift that happens when one model both writes and evaluates code.

**Parallelism where it's safe.** The planner uses Claude to reason about task dependencies and builds a topological sort. Independent tasks run in parallel waves. Within a task, backend and frontend builders can run simultaneously. No artificial serialization.

**Failure is a first-class outcome.** If a task can't pass review after 6 attempts, it's marked as failed — not silently ignored. The dashboard shows exactly what happened, and logs capture every agent's full output for debugging.
