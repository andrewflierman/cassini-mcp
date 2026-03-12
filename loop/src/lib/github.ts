import * as path from 'path'
import { mkdirSync, existsSync } from 'fs'
import type { TaskStatus } from './state.js'
import type { Prd, Task } from './prd.js'

// ── Interface ────────────────────────────────────────────────────────────

export interface GitHubIntegration {
  updateStatus(taskId: string, status: TaskStatus): void
  postComment(taskId: string, body: string): void
  postSprintSummary(summaryPath: string): Promise<void>
}

// ── Status → emoji mapping ───────────────────────────────────────────────

const STATUS_EMOJI: Partial<Record<TaskStatus, string>> = {
  testing:  '🏃',
  failed:   '✋',
  done:     '✅',
}

// ── Fire-and-forget gh helper ────────────────────────────────────────────

function ghFireAndForget(args: string[]): void {
  const proc = Bun.spawn(['gh', ...args], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  })
  // Don't block — just log errors
  proc.exited.then(async (code) => {
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      console.error(`[github] gh ${args.slice(0, 3).join(' ')} failed: ${stderr.trim()}`)
    }
  }).catch(() => {})
}

// ── Active implementation ────────────────────────────────────────────────

type TaskIssuesMap = Record<string, number>

class ActiveGitHubIntegration implements GitHubIntegration {
  constructor(private issues: TaskIssuesMap) {}

  updateStatus(taskId: string, status: TaskStatus): void {
    const emoji = STATUS_EMOJI[status]
    if (!emoji) return

    const issueNum = this.issues[taskId]
    if (!issueNum) return

    // Read title, strip existing emoji prefix, prepend new one — async, fire-and-forget
    const proc = Bun.spawn(
      ['gh', 'issue', 'view', String(issueNum), '--json', 'title', '-q', '.title'],
      { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
    )

    proc.exited.then(async (code) => {
      if (code !== 0) return
      const currentTitle = (await new Response(proc.stdout).text()).trim()
      // Strip any leading emoji (emoji char + space)
      const stripped = currentTitle.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]\s*/u, '')
      const newTitle = `${emoji} ${stripped}`
      ghFireAndForget(['issue', 'edit', String(issueNum), '--title', newTitle])
    }).catch(() => {})
  }

  postComment(taskId: string, body: string): void {
    const issueNum = this.issues[taskId]
    if (!issueNum) return
    ghFireAndForget(['issue', 'comment', String(issueNum), '--body', body])
  }

  async postSprintSummary(summaryPath: string): Promise<void> {
    const epicNum = this.issues['_epic']
    if (!epicNum) return

    const file = Bun.file(summaryPath)
    if (!(await file.exists())) return

    const body = await file.text()
    if (!body.trim()) return

    const proc = Bun.spawn(
      ['gh', 'issue', 'comment', String(epicNum), '--body', body],
      { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' },
    )
    const code = await proc.exited
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text()
      console.error(`[github] sprint summary post failed: ${stderr.trim()}`)
    }
  }
}

// ── No-op stub ───────────────────────────────────────────────────────────

const noopGitHub: GitHubIntegration = {
  updateStatus() {},
  postComment() {},
  async postSprintSummary() {},
}

// ── Shared path ─────────────────────────────────────────────────────────

function taskIssuesPath(): string {
  return path.join(process.cwd(), '.claude', 'task-issues.json')
}

// ── Factory ──────────────────────────────────────────────────────────────

export async function loadGitHubIntegration(): Promise<GitHubIntegration> {
  const filePath = taskIssuesPath()
  const file = Bun.file(filePath)

  if (!(await file.exists())) return noopGitHub

  try {
    const issues = await file.json() as TaskIssuesMap
    return new ActiveGitHubIntegration(issues)
  } catch {
    return noopGitHub
  }
}

// ── Issue creation ──────────────────────────────────────────────────────

async function isGhAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn(['gh', 'auth', 'status'], {
      stdin: 'ignore', stdout: 'ignore', stderr: 'ignore',
    })
    return (await proc.exited) === 0
  } catch {
    return false
  }
}

async function ghCreateIssue(title: string, body: string): Promise<number | null> {
  const proc = Bun.spawn(
    ['gh', 'issue', 'create', '--title', title, '--body', body],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
  )
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const code = await proc.exited
  if (code !== 0) {
    console.error(`[github] issue create failed: ${stderr.trim()}`)
    return null
  }
  // gh prints the issue URL, e.g. https://github.com/owner/repo/issues/42
  const match = stdout.trim().match(/\/issues\/(\d+)\s*$/)
  return match ? parseInt(match[1], 10) : null
}

async function createEpicIssue(prd: Prd): Promise<number | null> {
  const checklist = prd.tasks
    .map(t => `- [ ] ${t.id}: ${t.title}`)
    .join('\n')

  const body = [
    `## ${prd.sprint}`,
    '',
    prd.description,
    '',
    '## Tasks',
    checklist,
    '',
    '_Auto-created by agentloop_',
  ].join('\n')

  return ghCreateIssue(`[Sprint] ${prd.sprint}`, body)
}

async function createTaskIssue(task: Task, epicNum: number): Promise<number | null> {
  const criteria = task.acceptanceCriteria
    .map(c => `- [ ] ${c}`)
    .join('\n')

  const body = [
    `## ${task.title}`,
    '',
    task.description,
    '',
    '## Acceptance Criteria',
    criteria,
    '',
    `Part of #${epicNum}`,
    '',
    '_Auto-created by agentloop_',
  ].join('\n')

  return ghCreateIssue(`${task.id}: ${task.title}`, body)
}

export async function ensureGitHubIssues(prd: Prd): Promise<void> {
  const filePath = taskIssuesPath()

  // Idempotent: if file already exists, skip
  if (await Bun.file(filePath).exists()) return

  if (!(await isGhAvailable())) {
    console.warn('[github] gh CLI not available or not authenticated — skipping issue creation')
    return
  }

  const epicNum = await createEpicIssue(prd)
  if (epicNum === null) {
    console.warn('[github] failed to create epic issue — skipping issue creation')
    return
  }

  const issues: TaskIssuesMap = { _epic: epicNum }

  for (const task of prd.tasks) {
    const num = await createTaskIssue(task, epicNum)
    if (num !== null) {
      issues[task.id] = num
    } else {
      console.warn(`[github] failed to create issue for ${task.id} — skipping`)
    }
  }

  // Ensure .claude/ directory exists
  const dir = path.dirname(filePath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  await Bun.write(filePath, JSON.stringify(issues, null, 2) + '\n')
}
