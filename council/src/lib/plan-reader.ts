import * as fs from 'fs'
import * as path from 'path'
import { PhaseInfo } from '../prompts/task-spec-prompt'

function findMasterPlan(): string {
  const candidates = [
    process.env.MASTER_PLAN_PATH,
    path.join(process.cwd(), '..', '.agent', 'master-plan.md'),
    path.join(process.cwd(), '.agent', 'master-plan.md'),
    path.join(process.env.HOME ?? '', 'Documents', 'Claude', 'Projects', 'Cropsintel', 'cropsintel-v3-master-plan.md'),
  ].filter(Boolean) as string[]

  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }

  throw new Error(
    `Cannot find master-plan.md. Set MASTER_PLAN_PATH env var or place it at .agent/master-plan.md`
  )
}

export function readMasterPlan(): string {
  return fs.readFileSync(findMasterPlan(), 'utf8')
}

export function extractSection(planContent: string, sectionTitle: string): string {
  const lines = planContent.split('\n')
  let capturing = false
  const result: string[] = []

  for (const line of lines) {
    if (line.includes(sectionTitle)) {
      capturing = true
    } else if (capturing && line.startsWith('## ') && !line.includes(sectionTitle)) {
      // Next H2 section found — stop
      break
    }
    if (capturing) result.push(line)
  }

  return result.join('\n').trim()
}

export function parsePhases(planContent: string): PhaseInfo[] {
  // Looks for lines like: | 1.X | Phase name | ... | section |
  const phasePattern = /\|\s*(1\.\d+[a-z]?)\s*\|\s*([^|]+)\s*\|([^|]*)\|([^|]*)\|/g
  const phases: PhaseInfo[] = []
  let match

  while ((match = phasePattern.exec(planContent)) !== null) {
    const id = match[1].trim()
    const name = match[2].trim()
    const description = match[3].trim()
    const section = match[4].trim()

    if (id && name) {
      phases.push({
        id: `phase-${id}`,
        name,
        description: description || name,
        masterPlanSection: section || `Phase ${id}`,
      })
    }
  }

  return phases
}

export function getDoneTaskIds(): Set<string> {
  const done = new Set<string>()
  const doneDir = path.join(process.cwd(), '..', '.agent', 'tasks', 'done')

  if (!fs.existsSync(doneDir)) return done

  for (const f of fs.readdirSync(doneDir)) {
    if (f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.')) {
      done.add(f.replace('.md', ''))
    }
  }
  return done
}

export function getQueuedTaskIds(): Set<string> {
  const queued = new Set<string>()
  const queuedDir = path.join(process.cwd(), '..', '.agent', 'tasks', 'queued')

  if (!fs.existsSync(queuedDir)) return queued

  for (const f of fs.readdirSync(queuedDir)) {
    if (f.endsWith('.md') && !f.startsWith('_') && !f.startsWith('.')) {
      queued.add(f.replace('.md', ''))
    }
  }
  return queued
}

export function writeTaskSpec(taskId: string, content: string): string {
  const queuedDir = path.join(process.cwd(), '..', '.agent', 'tasks', 'queued')

  if (!fs.existsSync(queuedDir)) {
    fs.mkdirSync(queuedDir, { recursive: true })
  }

  const filePath = path.join(queuedDir, `${taskId}.md`)
  fs.writeFileSync(filePath, content, 'utf8')
  return filePath
}
