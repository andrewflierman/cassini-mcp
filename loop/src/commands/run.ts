import * as p from '@clack/prompts'
import * as path from 'path'
import { c, icons, box, termWidth, fixedWidth, leftRight, formatElapsed, SPINNER_FRAMES } from '../ui/theme.js'
import { Dashboard } from '../ui/dashboard.js'
import { readPrd } from '../lib/prd.js'
import {
  ensureDotDir,
  loadState,
  saveState,
  getLogPath,
  newRunState,
  ensureTaskState,
  isTaskDone,
} from '../lib/state.js'
import type { Task, VerificationCheck } from '../lib/prd.js'
import type { RunState, TaskState, TaskStatus } from '../lib/state.js'
import { loadGitHubIntegration } from '../lib/github.js'
import type { GitHubIntegration } from '../lib/github.js'

type AgentName = 'test-writer' | 'backend-builder' | 'frontend-builder' | 'code-reviewer' | 'verifier' | 'git-committer' | 'pm'

const TASK_AGENTS: Record<string, AgentName[]> = {
  backend:  ['test-writer', 'backend-builder'],
  frontend: ['test-writer', 'frontend-builder'],
  both:     ['test-writer', 'backend-builder', 'frontend-builder'],
}

const REVIEWER: AgentName = 'code-reviewer'
const VERIFIER: AgentName = 'verifier'
const COMMITTER: AgentName = 'git-committer'
const PM: AgentName = 'pm'

const MAX_REVIEW_ATTEMPTS = 6

interface ActiveTaskDisplay {
  taskId: string
  agent: AgentName
  attempt: number
  status: string
  bytesWritten: number
  startedAt: string
}

// Claude's analysis of which tasks depend on which
interface ExecutionPlan {
  dependencies: Record<string, string[]>  // taskId -> taskIds it depends on
  reasoning: string
}

export async function runCommand(argv: string[]): Promise<void> {
  const resume = argv.includes('--resume')
  const autoApprove = argv.includes('--yes') || argv.includes('-y')

  const branchFlagIdx = argv.indexOf('--branch')
  const branchFlag = branchFlagIdx !== -1 ? argv[branchFlagIdx + 1] : undefined

  let prd
  try {
    prd = await readPrd()
  } catch (err) {
    console.error(c.error(String(err instanceof Error ? err.message : err)))
    process.exit(1)
  }

  ensureDotDir()

  let state: RunState
  if (resume) {
    const existing = await loadState()
    if (!existing) {
      console.error(c.error('No previous run found. Start without --resume.'))
      process.exit(1)
    }
    state = existing
    console.log(c.muted(`Resuming run ${state.runId} (${state.sprint})`))
  } else {
    const branch = await getCurrentBranch()
    const safeBranch = await ensureSafeBranch(branch, branchFlag)
    state = newRunState(prd.sprint, safeBranch)
  }

  for (const task of prd.tasks) {
    ensureTaskState(state, task.id)
  }
  await saveState(state)

  const github = await loadGitHubIntegration()

  // Serialise all state writes — concurrent tasks share the same state object
  // and write to the same file. Queue ensures no interleaved writes.
  let saveQueue = Promise.resolve()
  const enqueueSave = () => {
    saveQueue = saveQueue.then(() => saveState(state))
    return saveQueue
  }

  // Plan before the dashboard starts. Approval loop lets the user review and
  // optionally provide feedback to revise before execution begins.
  const pendingTasks = prd.tasks.filter(task => !isTaskDone(state, task.id))

  let plan = await runPlanSpinner(pendingTasks)
  let waves = buildWaves(pendingTasks, plan.dependencies)

  if (autoApprove) {
    printPlan(waves, plan.reasoning)
    console.log(c.muted('  Auto-approved (--yes)'))
  } else {
    while (true) {
      printPlan(waves, plan.reasoning)

      const answer = await p.text({
        message: 'Proceed with this plan?',
        placeholder: 'enter to confirm, or describe changes…',
      })

      if (p.isCancel(answer)) {
        p.cancel('Cancelled.')
        process.exit(0)
      }

      const feedback = typeof answer === 'string' ? answer.trim() : ''
      if (!feedback) break  // confirmed — proceed

      plan = await runPlanSpinner(pendingTasks, feedback)
      waves = buildWaves(pendingTasks, plan.dependencies)
      // loop back to show revised plan and prompt again
    }
  }

  console.log('')

  const dashboard = new Dashboard()
  // keyed by `${taskId}:${agent}` so parallel agents are all visible
  const activeAgents = new Map<string, ActiveTaskDisplay>()
  let currentWave = 1  // planning is done; first wave is about to start

  const cleanup = () => {
    dashboard.stop()
    dashboard.showCursor()
    process.exit(0)
  }
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  const renderDashboard = () => buildDashboard(prd.sprint, state, prd.tasks, activeAgents, dashboard, waves, currentWave, plan.reasoning)
  dashboard.start(renderDashboard)

  // Execute waves in sequence. Tasks within each wave run in parallel.
  for (const wave of waves) {
    currentWave++
    await Promise.allSettled(
      wave.map(task => runTask(state, task, activeAgents, enqueueSave, github))
    )
  }

  // PM summary after all tasks settle
  const pmDisplay: ActiveTaskDisplay = {
    taskId: 'sprint', agent: PM, attempt: 1,
    status: 'Writing sprint summary...', bytesWritten: 0, startedAt: new Date().toISOString(),
  }
  activeAgents.set('sprint:pm', pmDisplay)
  await runAgent(
    state.runId,
    { id: 'sprint', title: prd.sprint, type: 'both', description: prd.description, acceptanceCriteria: [] },
    PM, 1, pmDisplay,
  )
  activeAgents.delete('sprint:pm')

  const summaryPath = path.join(process.cwd(), '.agentloop', 'sprint-summary.md')
  await github.postSprintSummary(summaryPath)

  const finalContent = buildDashboard(prd.sprint, state, prd.tasks, activeAgents, dashboard, waves, currentWave, plan.reasoning)
  dashboard.stop(finalContent)

  const doneCount = prd.tasks.filter(t => isTaskDone(state, t.id)).length
  const failedCount = prd.tasks.length - doneCount
  console.log('')
  if (failedCount === 0) {
    console.log(c.success(`  ${icons.done}  All ${doneCount} tasks complete.`))
  } else {
    console.log(c.warning(`  ${icons.done}  ${doneCount} done, ${c.error(`${failedCount} failed`)}.  Check .agentloop/logs/ for details.`))
  }
  console.log('')
}

async function runTask(
  state: RunState,
  task: Task,
  activeAgents: Map<string, ActiveTaskDisplay>,
  enqueueSave: () => Promise<void>,
  github: GitHubIntegration,
): Promise<void> {
  const ts = state.tasks[task.id]
  ts.status = 'testing'
  ts.startedAt = new Date().toISOString()
  enqueueSave()
  github.updateStatus(task.id, 'testing')

  // test-writer always runs first, alone
  const twDisplay: ActiveTaskDisplay = {
    taskId: task.id, agent: 'test-writer', attempt: 1,
    status: 'Writing tests...', bytesWritten: 0, startedAt: new Date().toISOString(),
  }
  activeAgents.set(`${task.id}:test-writer`, twDisplay)
  await runAgent(state.runId, task, 'test-writer', 1, twDisplay)
  activeAgents.delete(`${task.id}:test-writer`)

  // builders: sequential for single-type tasks, parallel for 'both'
  ts.status = 'building'
  enqueueSave()
  const builders = (TASK_AGENTS[task.type] ?? TASK_AGENTS.backend).filter(a => a !== 'test-writer')
  await Promise.all(builders.map(async (agent) => {
    const display: ActiveTaskDisplay = {
      taskId: task.id, agent, attempt: 1,
      status: 'Building...', bytesWritten: 0, startedAt: new Date().toISOString(),
    }
    activeAgents.set(`${task.id}:${agent}`, display)
    await runAgent(state.runId, task, agent, 1, display)
    activeAgents.delete(`${task.id}:${agent}`)
  }))

  // review → verify → rebuild cycle
  ts.status = 'reviewing'
  enqueueSave()

  let approved = false
  let verified = false
  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt++) {
    ts.attempts = attempt
    const reviewDisplay: ActiveTaskDisplay = {
      taskId: task.id, agent: REVIEWER, attempt,
      status: attempt === 1 ? 'Reviewing...' : `Re-reviewing (attempt ${attempt})...`,
      bytesWritten: 0, startedAt: new Date().toISOString(),
    }
    activeAgents.set(`${task.id}:${REVIEWER}`, reviewDisplay)
    enqueueSave()

    const result = await runAgent(state.runId, task, REVIEWER, attempt, reviewDisplay)
    activeAgents.delete(`${task.id}:${REVIEWER}`)

    if (!result.approved) {
      // Review rejected — rebuild
      ts.lastFeedback = result.feedback

      if (attempt < MAX_REVIEW_ATTEMPTS) {
        ts.status = 'building'
        const rebuildAgents = (TASK_AGENTS[task.type] ?? TASK_AGENTS.backend).filter(a => a !== 'test-writer')
        await Promise.all(rebuildAgents.map(async (agent) => {
          const display: ActiveTaskDisplay = {
            taskId: task.id, agent, attempt: attempt + 1,
            status: 'Fixing feedback...', bytesWritten: 0, startedAt: new Date().toISOString(),
          }
          activeAgents.set(`${task.id}:${agent}`, display)
          await runAgent(state.runId, task, agent, attempt + 1, display, ts.lastFeedback)
          activeAgents.delete(`${task.id}:${agent}`)
        }))
        ts.status = 'reviewing'
        enqueueSave()
      }
      continue
    }

    // Review approved — run browser verification if task has checks
    if (task.verification && task.verification.length > 0) {
      ts.status = 'verifying'
      enqueueSave()

      const verifyDisplay: ActiveTaskDisplay = {
        taskId: task.id, agent: VERIFIER, attempt,
        status: 'Verifying in browser...', bytesWritten: 0, startedAt: new Date().toISOString(),
      }
      activeAgents.set(`${task.id}:${VERIFIER}`, verifyDisplay)

      const vResult = await verifyTask(state.runId, task, activeAgents)
      activeAgents.delete(`${task.id}:${VERIFIER}`)

      if (!vResult.passed) {
        // Verification failed — send failure output as feedback to builders
        ts.lastFeedback = `## Browser Verification Failed\n\nThe code reviewer approved, but deterministic browser checks failed:\n\n${vResult.feedback}`

        if (attempt < MAX_REVIEW_ATTEMPTS) {
          ts.status = 'building'
          const rebuildAgents = (TASK_AGENTS[task.type] ?? TASK_AGENTS.backend).filter(a => a !== 'test-writer')
          await Promise.all(rebuildAgents.map(async (agent) => {
            const display: ActiveTaskDisplay = {
              taskId: task.id, agent, attempt: attempt + 1,
              status: 'Fixing verification failures...', bytesWritten: 0, startedAt: new Date().toISOString(),
            }
            activeAgents.set(`${task.id}:${agent}`, display)
            await runAgent(state.runId, task, agent, attempt + 1, display, ts.lastFeedback)
            activeAgents.delete(`${task.id}:${agent}`)
          }))
          ts.status = 'reviewing'
          enqueueSave()
        }
        continue
      }
    }

    // Both approved and verified (or no verification needed)
    approved = true
    verified = true
    break
  }

  if (!approved || !verified) {
    ts.status = 'failed'
    ts.completedAt = new Date().toISOString()
    enqueueSave()
    github.updateStatus(task.id, 'failed')
    github.postComment(task.id, `✋ **Blocked** after ${ts.attempts} attempt(s).\n\nLast feedback:\n${ts.lastFeedback ?? '(none)'}`)
    return
  }

  ts.status = 'committed'
  enqueueSave()
  const commitDisplay: ActiveTaskDisplay = {
    taskId: task.id, agent: COMMITTER, attempt: 1,
    status: 'Committing...', bytesWritten: 0, startedAt: new Date().toISOString(),
  }
  activeAgents.set(`${task.id}:${COMMITTER}`, commitDisplay)
  await runAgent(state.runId, task, COMMITTER, 1, commitDisplay)
  activeAgents.delete(`${task.id}:${COMMITTER}`)

  ts.status = 'done'
  ts.completedAt = new Date().toISOString()
  enqueueSave()
  github.updateStatus(task.id, 'done')
}

interface AgentResult {
  approved: boolean
  feedback?: string
}

interface AgentDef {
  systemPrompt: string
  model: string
  tools: string[]
}

async function loadAgentDef(agent: AgentName): Promise<AgentDef> {
  const filePath = path.join(process.cwd(), '.claude', 'agents', `${agent}.md`)
  const content = await Bun.file(filePath).text()

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fmMatch) return { systemPrompt: content.trim(), model: 'sonnet', tools: [] }

  const [, frontmatter, body] = fmMatch
  const modelMatch = frontmatter.match(/^model:\s*(.+)$/m)
  const toolsMatch = frontmatter.match(/^tools:\s*(.+)$/m)

  return {
    systemPrompt: body.trim(),
    model: modelMatch ? modelMatch[1].trim() : 'sonnet',
    tools: toolsMatch ? toolsMatch[1].split(',').map(t => t.trim()) : [],
  }
}

function buildAgentPrompt(task: Task, agent: AgentName, lastFeedback?: string): string {
  const criteria = task.acceptanceCriteria
    .map((c, i) => `${i + 1}. ${c}`)
    .join('\n')

  const base = `# Task: ${task.id} — ${task.title}\n\n${task.description}\n\n## Acceptance Criteria\n${criteria}`

  if (lastFeedback && (agent === 'backend-builder' || agent === 'frontend-builder')) {
    return `${base}\n\n## Code Review Feedback to Address\n${lastFeedback}`
  }

  if (agent === REVIEWER && lastFeedback) {
    return `${base}\n\n## Previous Review Feedback (verify these issues were addressed)\n${lastFeedback}`
  }

  return base
}

// ── Browser verification helpers ──────────────────────────────────────

interface BrowserCmdResult {
  ok: boolean
  stdout: string
  stderr: string
}

async function runBrowserCmd(...args: string[]): Promise<BrowserCmdResult> {
  const proc = Bun.spawn(['agent-browser', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { ok: exitCode === 0, stdout: stdout.trim(), stderr: stderr.trim() }
}

interface CheckResult {
  passed: boolean
  message: string
}

async function runCheck(check: VerificationCheck, screenshotDir: string, taskId: string): Promise<CheckResult> {
  switch (check.cmd) {
    case 'get count': {
      const r = await runBrowserCmd('get', 'count', check.selector)
      if (!r.ok) return { passed: false, message: `FAIL [get count "${check.selector}"]: ${r.stderr || 'command failed'}` }
      const actual = r.stdout.trim()
      const passed = actual === check.expect
      return { passed, message: `${passed ? 'PASS' : 'FAIL'} [get count "${check.selector}"]: expected ${check.expect}, got ${actual}` }
    }
    case 'get text': {
      const r = await runBrowserCmd('get', 'text', check.selector)
      if (!r.ok) return { passed: false, message: `FAIL [get text "${check.selector}"]: ${r.stderr || 'command failed'}` }
      const text = r.stdout.trim()
      if (check.expect !== undefined) {
        const passed = text === check.expect
        return { passed, message: `${passed ? 'PASS' : 'FAIL'} [get text "${check.selector}"]: expected "${check.expect}", got "${text}"` }
      }
      if (check.contains !== undefined) {
        const passed = text.includes(check.contains)
        return { passed, message: `${passed ? 'PASS' : 'FAIL'} [get text "${check.selector}"]: expected to contain "${check.contains}", got "${text}"` }
      }
      return { passed: text.length > 0, message: `${text.length > 0 ? 'PASS' : 'FAIL'} [get text "${check.selector}"]: got "${text}"` }
    }
    case 'get attr': {
      const r = await runBrowserCmd('get', 'attr', check.selector, check.attr)
      if (!r.ok) return { passed: false, message: `FAIL [get attr "${check.selector}" ${check.attr}]: ${r.stderr || 'command failed'}` }
      const val = r.stdout.trim()
      if (check.expect !== undefined) {
        const passed = val === check.expect
        return { passed, message: `${passed ? 'PASS' : 'FAIL'} [get attr "${check.selector}" ${check.attr}]: expected "${check.expect}", got "${val}"` }
      }
      if (check.contains !== undefined) {
        const passed = val.includes(check.contains)
        return { passed, message: `${passed ? 'PASS' : 'FAIL'} [get attr "${check.selector}" ${check.attr}]: expected to contain "${check.contains}", got "${val}"` }
      }
      return { passed: val.length > 0, message: `${val.length > 0 ? 'PASS' : 'FAIL'} [get attr "${check.selector}" ${check.attr}]: got "${val}"` }
    }
    case 'is visible': {
      const r = await runBrowserCmd('is', 'visible', check.selector)
      if (!r.ok) return { passed: false, message: `FAIL [is visible "${check.selector}"]: ${r.stderr || 'command failed'}` }
      const passed = r.stdout.trim() === 'true'
      return { passed, message: `${passed ? 'PASS' : 'FAIL'} [is visible "${check.selector}"]: ${r.stdout.trim()}` }
    }
    case 'screenshot': {
      const filepath = path.join(screenshotDir, check.filename)
      const r = await runBrowserCmd('screenshot', filepath)
      return { passed: true, message: `PASS [screenshot]: saved to ${filepath}${r.ok ? '' : ` (warning: ${r.stderr})`}` }
    }
  }
}

interface VerificationResult {
  passed: boolean
  feedback: string
  screenshotPaths: string[]
}

async function verifyTask(
  runId: string,
  task: Task,
  activeAgents: Map<string, ActiveTaskDisplay>,
): Promise<VerificationResult> {
  const checks = task.verification
  if (!checks || checks.length === 0) {
    return { passed: true, feedback: '', screenshotPaths: [] }
  }

  const screenshotDir = path.join(process.cwd(), '.agentloop', 'logs', runId, 'screenshots')
  const { mkdirSync, existsSync } = await import('fs')
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true })

  // Derive port from task ID digits to avoid conflicts between parallel tasks
  const digits = task.id.replace(/\D/g, '')
  const port = 3000 + (parseInt(digits, 10) || 0)

  // Start a local dev server
  const server = Bun.spawn(['npx', 'serve', '.', '-l', String(port), '--no-clipboard'], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  // Poll until the server is ready (up to 6s)
  const url = `http://localhost:${port}`
  let ready = false
  for (let i = 0; i < 12; i++) {
    try {
      const resp = await fetch(url)
      if (resp.ok) { ready = true; break }
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500))
  }

  if (!ready) {
    server.kill()
    return {
      passed: false,
      feedback: `Browser verification failed: dev server did not start on port ${port} within 6 seconds.`,
      screenshotPaths: [],
    }
  }

  // Open the page in agent-browser
  await runBrowserCmd('open', url)
  await runBrowserCmd('wait', '2000')

  const results: CheckResult[] = []
  const screenshotPaths: string[] = []

  for (const check of checks) {
    const result = await runCheck(check, screenshotDir, task.id)
    results.push(result)
    if (check.cmd === 'screenshot') {
      screenshotPaths.push(path.join(screenshotDir, check.filename))
    }
  }

  // Take a final evidence screenshot
  const finalScreenshot = path.join(screenshotDir, `${task.id}-final.png`)
  await runBrowserCmd('screenshot', finalScreenshot)
  screenshotPaths.push(finalScreenshot)

  // Clean up
  await runBrowserCmd('close')
  server.kill()

  const allPassed = results.every(r => r.passed)
  const feedback = results.map(r => r.message).join('\n')

  return { passed: allPassed, feedback, screenshotPaths }
}

async function runPlanSpinner(tasks: Task[], feedback?: string): Promise<ExecutionPlan> {
  const label = feedback ? 'Revising plan…' : 'Planning execution order…'
  let frame = 0
  const spinner = setInterval(() => {
    process.stdout.write(`\r  ${SPINNER_FRAMES[frame++ % SPINNER_FRAMES.length]}  ${c.muted(label)}`)
  }, 80)
  const plan = await planExecution(tasks, feedback)
  clearInterval(spinner)
  process.stdout.write('\r' + ' '.repeat(55) + '\r')
  return plan
}

function printPlan(waves: Task[][], reasoning: string): void {
  const width = Math.min(termWidth(), 80)
  console.log('')
  console.log(c.muted('  ' + box.divider(width - 4)))
  console.log(`  ${c.brand(icons.logo)}  ${c.bold('Execution plan')}`)
  if (reasoning) console.log(c.muted(`  ${reasoning}`))
  console.log('')
  waves.forEach((wave, i) => {
    const parallel = wave.length > 1 ? c.muted('  parallel') : ''
    console.log(`  ${c.brand(`wave ${i + 1}`)}${parallel}`)
    wave.forEach(t => console.log(`    ${c.muted('·')}  ${c.bold(t.id)}  ${t.title}`))
    if (i < waves.length - 1) console.log(c.muted('      ↓'))
  })
  console.log('')
  console.log(c.muted('  ' + box.divider(width - 4)))
  console.log('')
}

async function planExecution(tasks: Task[], feedback?: string): Promise<ExecutionPlan> {
  const taskList = tasks.map(t =>
    `- ${t.id}: ${t.title}\n  ${t.description}\n  Acceptance criteria: ${t.acceptanceCriteria.join('; ')}`
  ).join('\n')

  const systemPrompt = `You are an execution planner for a software build loop.
Given a list of tasks, identify which tasks depend on others and must run after them.
Respond with ONLY a JSON object — no markdown, no explanation outside the JSON:
{
  "dependencies": {
    "TASK-001": [],
    "TASK-002": ["TASK-001"]
  },
  "reasoning": "one sentence"
}
Rules:
- A task depends on another only if it requires types, entities, or infrastructure that the other task creates
- If tasks touch completely different domains/files, they have no dependency
- Keep the graph minimal — only add edges that are truly necessary`

  const userPrompt = feedback
    ? `Tasks to plan:\n${taskList}\n\nUser feedback on previous plan: ${feedback}\nRevise the plan accordingly.`
    : `Tasks to plan:\n${taskList}`

  const env = { ...process.env }
  delete env['CLAUDECODE']
  delete env['CLAUDE_CODE_SSE_PORT']
  delete env['CLAUDE_CODE_ENTRYPOINT']

  const proc = Bun.spawn([
    'claude', '-p', userPrompt,
    '--system-prompt', systemPrompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--model', 'sonnet',
    '--dangerously-skip-permissions',
    '--allowedTools', '',   // no tools — pure reasoning only
  ], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env })

  let resultText = ''
  const decoder = new TextDecoder()
  let lineBuffer = ''

  for await (const chunk of proc.stdout) {
    lineBuffer += decoder.decode(chunk)
    const lines = lineBuffer.split('\n')
    lineBuffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.type === 'result' && event.subtype === 'success') resultText = event.result ?? ''
      } catch { /* partial */ }
    }
  }
  const stderrText = await new Response(proc.stderr).text()
  await proc.exited

  // Debug: write raw planner output so failures are diagnosable
  await Bun.write('.agentloop/planner-debug.log',
    `=== stdout (resultText) ===\n${resultText}\n\n=== stderr ===\n${stderrText}\n`
  )

  // Extract the JSON object — robust against preamble text or code fences
  const jsonMatch = resultText.match(/\{[\s\S]*\}/)
  const json = jsonMatch ? jsonMatch[0] : ''

  try {
    const plan = JSON.parse(json) as ExecutionPlan
    // Ensure every task has an entry, even if the planner omitted it
    for (const t of tasks) {
      if (!plan.dependencies[t.id]) plan.dependencies[t.id] = []
    }
    return plan
  } catch {
    const reason = stderrText.trim()
      ? `planner error: ${stderrText.trim().slice(0, 120)}`
      : `planner returned invalid JSON: ${json.slice(0, 120) || '(empty)'}`
    return {
      dependencies: Object.fromEntries(tasks.map(t => [t.id, []])),
      reasoning: `fallback — ${reason}`,
    }
  }
}

// Topological sort into waves. Tasks in the same wave have no dependencies on each other
// and all their dependencies were satisfied in prior waves.
function buildWaves(tasks: Task[], dependencies: Record<string, string[]>): Task[][] {
  const waves: Task[][] = []
  const completed = new Set<string>()
  const remaining = new Map(tasks.map(t => [t.id, t]))

  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter(t =>
      (dependencies[t.id] ?? []).every(dep => completed.has(dep))
    )

    if (wave.length === 0) {
      // Circular dependency or dep references unknown task — dump the rest in one wave
      waves.push([...remaining.values()])
      break
    }

    waves.push(wave)
    wave.forEach(t => { completed.add(t.id); remaining.delete(t.id) })
  }

  return waves
}

function statusFromEvent(event: Record<string, unknown>): string | null {
  if (event.type === 'tool_use') {
    const name = String(event.name ?? '')
    const input = (event.input ?? {}) as Record<string, unknown>
    const detail =
      (input.command as string) ??
      (input.file_path as string) ??
      (input.pattern as string) ??
      (input.description as string) ??
      ''
    const truncated = detail.length > 60 ? detail.slice(0, 59) + '…' : detail
    return truncated ? `${name}: ${truncated}` : name
  }

  if (event.type === 'assistant') {
    const msg = event.message as Record<string, unknown> | undefined
    const content = Array.isArray(msg?.content) ? msg.content : []
    for (const block of content) {
      if ((block as Record<string, unknown>).type === 'text') {
        const text = String((block as Record<string, unknown>).text ?? '').trim()
        if (text) return text.length > 70 ? text.slice(0, 69) + '…' : text
      }
    }
  }

  return null
}

async function runAgent(
  runId: string,
  task: Task,
  agent: AgentName,
  attempt: number,
  display: ActiveTaskDisplay,
  lastFeedback?: string
): Promise<AgentResult> {
  const logPath = getLogPath(runId, task.id, agent, agent === REVIEWER ? attempt : undefined)
  const def = await loadAgentDef(agent)
  const userPrompt = buildAgentPrompt(task, agent, lastFeedback)

  const args = [
    'claude', '-p', userPrompt,
    '--system-prompt', def.systemPrompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ]
  if (def.tools.length > 0) args.push('--allowedTools', def.tools.join(','))
  if (def.model) args.push('--model', def.model)

  // Strip Claude Code session markers so subprocesses aren't blocked as nested sessions
  const env = { ...process.env }
  delete env['CLAUDECODE']
  delete env['CLAUDE_CODE_SSE_PORT']
  delete env['CLAUDE_CODE_ENTRYPOINT']

  const proc = Bun.spawn(args, {
    cwd: process.cwd(),
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env,
  })

  let rawOutput = ''
  let resultText = ''
  const decoder = new TextDecoder()
  let lineBuffer = ''

  for await (const chunk of proc.stdout) {
    const text = decoder.decode(chunk)
    rawOutput += text
    display.bytesWritten = rawOutput.length
    lineBuffer += text

    const lines = lineBuffer.split('\n')
    lineBuffer = lines.pop() ?? ''

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        const status = statusFromEvent(event)
        if (status) display.status = status
        if (event.type === 'result' && event.subtype === 'success') {
          resultText = event.result ?? ''
        }
      } catch { /* partial line */ }
    }
  }

  // drain any final partial line
  if (lineBuffer.trim()) {
    try {
      const event = JSON.parse(lineBuffer)
      const status = statusFromEvent(event)
      if (status) display.status = status
      if (event.type === 'result' && event.subtype === 'success') {
        resultText = event.result ?? ''
      }
    } catch { /* incomplete */ }
  }

  const stderrText = await new Response(proc.stderr).text()
  await proc.exited
  const combined = rawOutput + (stderrText ? `\n--- STDERR ---\n${stderrText}` : '')
  await Bun.write(logPath, combined)

  if (agent === REVIEWER) {
    const approved = /SHIP IT/i.test(resultText)
    return { approved, feedback: approved ? undefined : resultText }
  }

  return { approved: true }
}

function buildDashboard(
  sprintName: string,
  state: RunState,
  tasks: Task[],
  activeAgents: Map<string, ActiveTaskDisplay>,
  dashboard: Dashboard,
  waves: Task[][] = [],
  currentWave = 0,
  reasoning = '',
): string {
  const width = termWidth()
  const lines: string[] = []

  const doneCount = tasks.filter(t => isTaskDone(state, t.id)).length
  const headerLeft  = `  ${c.brand(icons.logo + ' agentloop')}           ${c.bold(sprintName)}`
  const waveStr = waves.length > 1 ? `wave ${currentWave}/${waves.length}  ` : ''
  const headerRight = `${waveStr}${doneCount} / ${tasks.length} tasks done  `
  const branchLine  = `  Branch: ${c.brand(state.branch)}`

  lines.push(box.top(width, ''))
  lines.push(leftRight(headerLeft, c.muted(headerRight), width))
  lines.push(leftRight(branchLine, '', width))
  if (reasoning) {
    const maxLen = width - 6
    const truncated = reasoning.length > maxLen ? reasoning.slice(0, maxLen - 1) + '…' : reasoning
    lines.push(c.muted(`  Plan: ${truncated}`))
  }
  lines.push(box.bottom(width))
  lines.push('')

  const idWidth    = 10
  const timeWidth  = 9
  const titleWidth = Math.max(10, width - idWidth - timeWidth - 6)

  // Build a taskId → wave index map for the subheaders
  const taskWave = new Map<string, number>()
  waves.forEach((wave, i) => wave.forEach(t => taskWave.set(t.id, i + 1)))

  // Render tasks grouped by wave when there are multiple waves
  const renderTask = (task: Task) => {
    const ts: TaskState | undefined = state.tasks[task.id]
    const status = ts?.status ?? 'pending'
    const elapsed = formatElapsed(ts?.startedAt)
    const isActive = [...activeAgents.keys()].some(k => k.startsWith(`${task.id}:`))
    const { icon, colorFn } = taskAppearance(status, isActive ? dashboard.nextFrame() : undefined)
    lines.push(`   ${icon}  ${c.muted(fixedWidth(task.id, idWidth))}  ${colorFn(fixedWidth(task.title, titleWidth))}  ${c.muted(elapsed)}`)
  }

  if (waves.length > 1) {
    waves.forEach((wave, i) => {
      const waveNum = i + 1
      const isCurrentWave = waveNum === currentWave
      const waveLabel = waveNum < currentWave ? `wave ${waveNum}` : isCurrentWave ? `wave ${waveNum}  ←` : `wave ${waveNum}  (blocked)`
      lines.push(c.muted(`  ${waveLabel}`))
      wave.forEach(renderTask)
      lines.push('')
    })
  } else {
    tasks.forEach(renderTask)
    lines.push('')
  }

  lines.push('')
  lines.push(c.muted('  ' + box.divider(width - 4)))

  if (activeAgents.size === 0) {
    lines.push(c.muted('  Idle'))
  } else {
    for (const active of activeAgents.values()) {
      const spinFrame = dashboard.nextFrame()
      const attemptStr = (active.agent === REVIEWER || active.agent === VERIFIER) ? c.muted(` attempt ${active.attempt}/${MAX_REVIEW_ATTEMPTS}`) : ''
      const kb = active.bytesWritten > 0 ? `${Math.ceil(active.bytesWritten / 1024)}KB` : ''
      const elapsed = formatElapsed(active.startedAt)
      const statusWidth = Math.max(10, width - 75)
      const statusText = fixedWidth(active.status, statusWidth)
      const left = `  ${c.bold(fixedWidth(active.taskId, 10))}  ${c.brand(fixedWidth(active.agent, 18))}${attemptStr}  ${c.brand(spinFrame)}  ${c.task(statusText)}`
      const right = c.muted(`${kb}  ${elapsed}  `)
      lines.push(leftRight(left, right, width))
    }
  }

  lines.push(c.muted('  ' + box.divider(width - 4)))

  return lines.join('\n')
}

function taskAppearance(
  status: TaskStatus,
  spinnerFrame?: string
): { icon: string; colorFn: (s: string) => string } {
  switch (status) {
    case 'done':
      return { icon: c.success(icons.done), colorFn: c.muted }
    case 'failed':
      return { icon: c.error(icons.failed), colorFn: c.error }
    case 'pending':
      return { icon: c.muted(icons.pending), colorFn: c.muted }
    default:
      return {
        icon: c.brand(spinnerFrame ?? icons.pending),
        colorFn: c.task,
      }
  }
}

async function getCurrentBranch(): Promise<string> {
  const proc = Bun.spawn(['git', 'branch', '--show-current'], { stdout: 'pipe', stderr: 'pipe' })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text.trim() || 'main'
}

async function ensureSafeBranch(branch: string, branchFlag?: string): Promise<string> {
  if (branch !== 'main' && branch !== 'master') return branch

  if (branchFlag) {
    console.log(c.muted(`  Using branch: ${branchFlag}`))
    return branchFlag
  }

  console.log('')
  console.log(c.warning(`  You're on ${c.bold(branch)}. The build loop should run on a feature branch.`))
  console.log('')

  const newBranch = await p.text({
    message: 'Feature branch name',
    placeholder: 'feature/sprint-1',
    validate: (val) => (!val ? 'Branch name is required.' : undefined),
  })

  if (p.isCancel(newBranch)) {
    p.cancel('Cancelled.')
    process.exit(0)
  }

  return newBranch as string
}
