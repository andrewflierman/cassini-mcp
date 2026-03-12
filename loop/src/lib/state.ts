import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

export type TaskStatus =
  | 'pending'
  | 'testing'
  | 'building'
  | 'reviewing'
  | 'verifying'
  | 'committed'
  | 'done'
  | 'failed'

export interface TaskState {
  id: string
  status: TaskStatus
  attempts: number
  lastFeedback?: string
  startedAt?: string
  completedAt?: string
}

export interface RunState {
  runId: string
  sprint: string
  branch: string
  startedAt: string
  tasks: Record<string, TaskState>
}

const dotDir = () => join(process.cwd(), '.agentloop')
const statePath = () => join(dotDir(), 'state.json')
const logsDir = () => join(dotDir(), 'logs')

export function ensureDotDir(): void {
  const dd = dotDir()
  if (!existsSync(dd)) mkdirSync(dd, { recursive: true })

  const ld = logsDir()
  if (!existsSync(ld)) mkdirSync(ld, { recursive: true })
}

export async function loadState(): Promise<RunState | null> {
  const file = Bun.file(statePath())
  if (!(await file.exists())) return null

  try {
    return await file.json() as RunState
  } catch {
    return null
  }
}

export async function saveState(state: RunState): Promise<void> {
  ensureDotDir()
  await Bun.write(statePath(), JSON.stringify(state, null, 2) + '\n')
}

export function getLogPath(
  runId: string,
  taskId: string,
  agent: string,
  attempt?: number
): string {
  const runDir = join(logsDir(), runId)
  if (!existsSync(runDir)) mkdirSync(runDir, { recursive: true })

  const suffix = attempt !== undefined ? `-${attempt}` : ''
  const filename = `${taskId}-${agent}${suffix}.log`
  return join(runDir, filename)
}

export function isTaskDone(state: RunState, taskId: string): boolean {
  return state.tasks[taskId]?.status === 'done'
}

export function newRunState(sprint: string, branch: string): RunState {
  const now = new Date()
  const runId = now
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)

  return {
    runId,
    sprint,
    branch,
    startedAt: now.toISOString(),
    tasks: {},
  }
}

export function ensureTaskState(state: RunState, taskId: string): TaskState {
  if (!state.tasks[taskId]) {
    state.tasks[taskId] = {
      id: taskId,
      status: 'pending',
      attempts: 0,
    }
  }
  return state.tasks[taskId]
}
