import * as path from 'path'
import type { TaskStatus } from './state.js'

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

// ── Factory ──────────────────────────────────────────────────────────────

export async function loadGitHubIntegration(): Promise<GitHubIntegration> {
  const filePath = path.join(process.cwd(), '.claude', 'task-issues.json')
  const file = Bun.file(filePath)

  if (!(await file.exists())) return noopGitHub

  try {
    const issues = await file.json() as TaskIssuesMap
    return new ActiveGitHubIntegration(issues)
  } catch {
    return noopGitHub
  }
}
