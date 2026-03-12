# The Feature Build

This project uses **agentloop** — a CLI in `loop/` that orchestrates multiple Claude subprocesses as an automated build pipeline. The goal is to minimize human involvement during execution while maximizing quality and auditability.

> **Trigger phrase**: Say "execute the plan" (or similar) and Claude will run the `agentloop` CLI to begin execution.

> **Prerequisite**: Agent definitions live in `.claude/agents/`. Run `bun dev` from `loop/` (or the compiled `agentloop` binary) from the project root.

---

## GitHub Process

GitHub is the **source of truth**. All state is tracked there in real time — not in batches. All `gh` CLI calls use the `gh` tool.

- Every feature has a **feature branch**
- Every feature has a **parent (epic) issue** with tasks grouped into steps
- Every task has its own **child issue**
- Every task has an **emoji status indicator** (see key below)

### Task Status Key

| Emoji | Status |
|-------|--------|
| 🏃 | doing |
| ✋ | blocked |
| 🔴 | on hold |
| 🔵 | more investigation required |
| 👀 | human review required |
| ✅ | done |

---

## Rules

- Do not say a problem is fixed unless the app can build.
- Do not say something is done unless you actually did it.
- Never run anything against prod unless explicitly told to.
- Never install packages by editing `package.json` directly — use the package manager CLI.

---

## High-Level Flow

```
brainstorm → plan → commit
  └→ [per task]: test → build → review → verification -> commit → log
refine → report
```

Each step is either **agentic** (a Claude subprocess does it) or **deterministic** (a shell command, always the same result).

### What is deterministic

- All **git commits** — handled by the `git-committer` agent subprocess after reviewer approval
- All **verification scripts** — shell scripts defined during brainstorming, invoked after commit

### What is agentic

- Test writing (`test-writer` subprocess)
- Code generation (`backend-builder` / `frontend-builder` subprocess)
- Code review (`code-reviewer` subprocess)
- Sprint summary (`pm` subprocess)
- Brainstorming and planning (interactive, with the user)
- Execution planning (Claude via `claude -p`, no tools — pure dependency reasoning)
- Refinement (interactive Q&A handoff)

---

## How agentloop Works

The `agentloop` CLI (in `loop/`) is the execution engine. Run it from the project root:

```bash
cd loop && bun dev         # dev mode
# or
agentloop                  # compiled binary
agentloop --resume         # resume a previous run
agentloop --branch <name>  # specify feature branch
```

### What agentloop does

1. Reads the PRD from the project (see `loop/src/lib/prd.ts` for the expected format)
2. Calls `claude -p` with no tools to produce a dependency graph and wave order
3. Presents the execution plan for human approval (with optional feedback loop)
4. Executes waves in sequence; tasks within a wave run in parallel
5. For each task: `test-writer` → builders → `code-reviewer` (up to 6 attempts) → `git-committer`
6. After all tasks: `pm` agent writes a sprint summary
7. Shows a live terminal dashboard throughout

### Agent definitions

Agents are defined as markdown files in `.claude/agents/` with YAML frontmatter:

```markdown
---
model: sonnet
tools: Read,Write,Edit,Glob,Grep,Bash
---

Your system prompt here...
```

Available agent names: `test-writer`, `backend-builder`, `frontend-builder`, `code-reviewer`, `git-committer`, `pm`

Logs are written to `.agentloop/logs/` keyed by run ID, task ID, and agent name.

---

## Phase 1: Brainstorm, Plan, Commit

This phase is **interactive** — the user and Claude work together. Use the `/brainstorming` skill.

Once the user approves the plan, the skill runs a **preflight check** before creating any artifacts:

- A local git repo exists — if not, offer to `git init`
- The current branch is not `main` or `master` — if it is, create the feature branch now (the name is known at this point)
- A remote is configured — if not, ask for the URL and offer to add it and push

> Note: The `/brainstorming` skill must be created at `.claude/skills/brainstorming.md`. See the skill definition for its full behavior.

### Brainstorming process

1. **Explore**: Lateral thinking and deep exploration of the feature — what it is, what it affects, what could go wrong.
2. **Clarify** (3 rounds): Ask focused questions to extract detail about both the feature intent and the implementation approach. One round at a time.
3. **Propose** (3 rounds): Offer distinct solution approaches with tradeoffs. The user can steer, reject, or combine. One round at a time.
4. **Verification design**: For each task, propose specific, deterministic verification steps. Examples:
   - CSV processing: row count check, column sum validation
   - Web app: `npm run build` exits 0, `agent-browser` snapshot confirms a key element is present on the page
   - API: curl returning expected status code and response shape

### After approval

Once the user approves the plan:

- Create a **feature branch** locally
- Create a **plan document** at `/docs/plans/<feature-name>.md`
- Create an **epic issue** on GitHub with tasks grouped into second-level headers with emoji
  - Every task has its status emoji (start with 🏃 for the first task, rest unlabeled)
  - Every task has its own child issue
  - Every issue has appropriate labels applied
- Create **verification scripts** at `.claude/verify/<feature-name>/` — one shell script per task that needs verification, named by task ID (e.g., `.claude/verify/user-auth/task-003.sh`).
- Create `.claude/task-issues.json` — a mapping of task IDs to GitHub issue numbers (e.g., `{"task-001": 42, "task-002": 43}`).
- Commit everything: plan doc, verification scripts, and any other local artifacts

---

## Phase 2: Execution (agentloop CLI)

This phase is kicked off when the user says "execute the plan" or equivalent. Claude runs the `agentloop` CLI from the project root and monitors progress.

### Real-time GitHub issue title updates

The main Claude session is responsible for updating issue titles at key moments — **before** launching agentloop, not after.

**When starting a task** (before launching agentloop):
```bash
# Read current title, strip any existing emoji, prepend 🏃
CURRENT=$(gh issue view <issue-number> --json title -q .title)
gh issue edit <issue-number> --title "🏃 $CURRENT"
```

**When a builder outputs `BLOCKED:`** (hard stop, task not completed):
```bash
CURRENT=$(gh issue view <issue-number> --json title -q .title)
# Strip emoji prefix first, then add ✋
CLEAN=$(echo "$CURRENT" | sed 's/^[^ ]* //')
gh issue edit <issue-number> --title "✋ $CLEAN"
gh issue comment <issue-number> --body "✋ Blocked: <reason from builder output>"
```

### The pipeline (per task)

The team consists of these **agent subprocesses**, each defined in `.claude/agents/`:

#### `test-writer`

- **Role**: Write tests for a given task — before any implementation exists
- **Constraint**: Tests must fail 100% when written. If any test passes at write time, that is a hard stop
- **Tools**: Read, Write, Glob, Grep, Bash (for running tests only)

#### `backend-builder` / `frontend-builder`

- **Role**: Write code until all tests for the task pass
- **Constraints**:
  - Does not review code
  - **Never alters a test** — if a test seems wrong, it flags it and stops
  - Done when all task tests pass
- **Tools**: Read, Write, Edit, Glob, Grep, Bash

#### `code-reviewer`

- **Role**: Read-only audit of the completed task
- **Checks**: Security, performance, style guide compliance, full test suite passes
- **Tools**: Read, Glob, Grep, Bash (read-only commands only)
- **Output**: Emits exactly one of:
  - `SHIP IT` — all checks pass
  - `CHANGES NEEDED: <exact problem description>` — something must be fixed
- **If CHANGES NEEDED**: agentloop spawns a new builder subprocess to address the problems. The loop repeats up to 6 times.

#### `git-committer`

- **Role**: Commit all task work after reviewer approves
- **Triggered**: Automatically by agentloop after `SHIP IT`

#### `pm`

- **Role**: Write a sprint summary after all tasks complete
- **Triggered**: Automatically by agentloop at the end of the run

### Verification

After the `git-committer` runs, the verification script for the task is invoked:

```
.claude/verify/<feature-name>/<task-id>.sh
```

The script exits `0` on success or non-zero on failure. Failure stops the pipeline and updates the GitHub issue to ✋ (blocked), requiring human review.

---

## Phase 3: Refinement and Reporting

The Refinement step is a **human-in-the-loop handoff**. After execution completes, Claude guides the user through a focused Q&A review:

- Questions are based on the actual work performed
- The goal is quality, trust, and shipping — not scope expansion
- Outcomes are: ship as-is, tweak and ship, or flag for follow-up

This is not an automated step. The user decides what happens next.

A final **report** is posted as a comment on the epic GitHub issue summarizing:
- What was built
- What was verified and how
- Any decisions made or tradeoffs taken
- What to watch for in production

---

## Artifacts Summary

| Artifact | Location | Created by |
|----------|----------|------------|
| Plan document | `/docs/plans/<feature>.md` | Brainstorming |
| Verification scripts | `.claude/verify/<feature>/<task-id>.sh` | Brainstorming |
| Task→issue mapping | `.claude/task-issues.json` | Brainstorming |
| Epic issue | GitHub | Brainstorming |
| Child issues | GitHub | Brainstorming |
| Agent definitions | `.claude/agents/` | Setup (one-time) |
| agentloop CLI | `loop/` | Setup (one-time) |
| `/brainstorming` skill | `.claude/skills/brainstorming.md` | Setup (one-time) |
| Run logs | `.agentloop/logs/` | agentloop |
| Run state | `.agentloop/state.json` | agentloop |
