import { join } from 'path'

export type TaskType = 'backend' | 'frontend' | 'both'

export type VerificationCheck =
  | { cmd: 'get count';   selector: string; expect: string }
  | { cmd: 'get text';    selector: string; contains?: string; expect?: string }
  | { cmd: 'get attr';    selector: string; attr: string; contains?: string; expect?: string }
  | { cmd: 'is visible';  selector: string }
  | { cmd: 'screenshot';  filename: string }

export interface Task {
  id: string
  title: string
  type: TaskType
  description: string
  acceptanceCriteria: string[]
  verification?: VerificationCheck[]
}

export interface Prd {
  sprint: string
  description: string
  createdAt: string
  tasks: Task[]
}

const prdPath = () => join(process.cwd(), 'prd.json')

export async function readPrd(): Promise<Prd> {
  const path = prdPath()
  const file = Bun.file(path)

  if (!(await file.exists())) {
    throw new Error(`No prd.json found at ${path}. Run 'agentloop design' to create one.`)
  }

  try {
    const prd = await file.json() as Prd
    if (!prd.sprint || !prd.tasks || !Array.isArray(prd.tasks)) {
      throw new Error('prd.json looks malformed — expected sprint and tasks fields.')
    }
    return prd
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`prd.json is not valid JSON: ${err.message}`)
    }
    throw err
  }
}

export async function writePrd(prd: Prd): Promise<void> {
  await Bun.write(prdPath(), JSON.stringify(prd, null, 2) + '\n')
}
