// Phase 1.10at — workflow parser for docs/MAXONS_Workflow_v1.md.
//
// Parses the trader workflow doc into a {nodes, edges} graph for the cockpit
// Workflows tab. Caches the result in-memory for 60s so the GET endpoint
// doesn't re-read + re-tokenize on every poll. Falls back to a hardcoded
// baseline derived from master plan §1.8 if the doc is unreadable or yields
// fewer than 10 workflow nodes (which would mean parsing broke).

import { readFile, stat } from 'fs/promises'
import { resolve } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileP = promisify(execFile)

export const REPO_ROOT = process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
export const WORKFLOW_PATH_REL = 'docs/MAXONS_Workflow_v1.md'

export interface WorkflowGraphNode {
  id: string
  type: 'workflow' | 'department' | 'operating_model'
  title: string
  description: string
  meta: Record<string, unknown>
}

export interface WorkflowGraphEdge {
  id: string
  source: string
  target: string
  label?: string
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[]
  edges: WorkflowGraphEdge[]
  updated_at: string
  source: 'maxons-doc' | 'baseline-fallback'
}

const WORKFLOW_HEADING_RE = /^### Workflow (\d+)\s*[—-]\s*(.+?)\s*$/
const OPERATING_MODEL_HEADING_RE = /^#### (Model [A-C])\s*[—-]\s*(.+?)\s*$/

// Master plan §1.8 — 8 functional departments. Used both for parsing
// reference-detection and for the fallback baseline.
const KNOWN_DEPARTMENTS = [
  'Trade Desk',
  'Procurement Operations',
  'Logistics & Shipment Operations',
  'Document Control & Compliance',
  'Finance & Treasury',
  'CRM & Sales Support',
  'Exception & Claims Management',
  'Executive / Trade Management',
]

// Master plan §1.8 — 15 baseline workflows. Titles taken verbatim from
// MAXONS_Workflow_v1.md Part 3 so the fallback graph is recognizable.
const BASELINE_WORKFLOWS: Array<{ n: number; title: string; desc: string; depts: string[] }> = [
  { n: 1, title: 'Price Discovery & Market Intelligence', desc: 'Continuous scan of supplier offers, freight indices, and destination indications.', depts: ['Trade Desk'] },
  { n: 2, title: 'Customer Enquiry to Sale Quote', desc: 'Model A trigger — quote-builder with live margin engine.', depts: ['Trade Desk', 'CRM & Sales Support'] },
  { n: 3, title: 'Sale Contract Issuance', desc: 'Legally binding sale contract with machine-readable clauses.', depts: ['Trade Desk'] },
  { n: 4, title: 'Purchase Contract Issuance & Back-to-Back Linking', desc: 'Lock the supplier-side terms against the sale.', depts: ['Trade Desk', 'Procurement Operations'] },
  { n: 5, title: 'Shipping Instructions & Markings', desc: 'Carton labels, container marks, palletization spec.', depts: ['Procurement Operations', 'Logistics & Shipment Operations'] },
  { n: 6, title: 'Pre-Shipment Logistics (FAS Path)', desc: 'MAXONS books ocean freight; supplier delivers alongside ship.', depts: ['Logistics & Shipment Operations'] },
  { n: 7, title: 'Pre-Shipment Logistics (CIF Path)', desc: 'Supplier-managed freight; MAXONS follows up on bookings.', depts: ['Logistics & Shipment Operations'] },
  { n: 8, title: 'Shipment Execution & In-Transit Tracking', desc: 'Vessel ETD/ETA, exception handling, transhipment risk.', depts: ['Logistics & Shipment Operations'] },
  { n: 9, title: 'Document Flow & Bank Routing', desc: 'BL, phyto, COO, invoices flow through bank presentation as required.', depts: ['Document Control & Compliance', 'Finance & Treasury'] },
  { n: 10, title: 'Arrival, Customs Clearance, Delivery', desc: 'Destination compliance, last-mile delivery, demurrage avoidance.', depts: ['Logistics & Shipment Operations', 'Document Control & Compliance'] },
  { n: 11, title: 'Payment Cycles (Supplier and Customer)', desc: 'Advance, arrival, bank-routed payment patterns per market.', depts: ['Finance & Treasury'] },
  { n: 12, title: 'Broker Commission Lifecycle', desc: 'Buy-side and sell-side broker accruals and settlement.', depts: ['Trade Desk', 'Finance & Treasury'] },
  { n: 13, title: 'Inventory Movement (Model C Focus)', desc: 'Dubai warehouse lots, local distribution traceability.', depts: ['Logistics & Shipment Operations'] },
  { n: 14, title: 'Position Book & Exposure Management (Model B Focus)', desc: 'Speculative positions, mark-to-market, exposure heatmap.', depts: ['Trade Desk', 'Executive / Trade Management'] },
  { n: 15, title: 'Exception & Claims Management', desc: 'Disputes, insurance claims, demurrage recovery, lessons learned.', depts: ['Exception & Claims Management'] },
]

const BASELINE_OPERATING_MODELS: Array<{ code: 'Model A' | 'Model B' | 'Model C'; title: string; desc: string }> = [
  { code: 'Model A', title: 'Model A — Back-to-Back Trading (Customer-Driven Procurement)', desc: 'Confirmed customer requirement triggers procurement. Risk is execution, not price.' },
  { code: 'Model B', title: 'Model B — Speculative Position Trading (Market-Driven Procurement)', desc: 'MAXONS buys ahead of demand. Position held in transit / Dubai / origin until matched.' },
  { code: 'Model C', title: 'Model C — Local Stock & Distribute (Dubai Inventory Trading)', desc: 'Dubai warehouse → UAE customers in shorter cycles, smaller lots, local credit.' },
]

function slugFromTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
}

// ─── In-memory cache ──────────────────────────────────────────────────────

interface CacheEntry {
  graph: WorkflowGraph
  cachedAt: number
}

const CACHE_TTL_MS = 60_000
let CACHE: CacheEntry | null = null

export function clearWorkflowCache(): void {
  CACHE = null
}

async function getWorkflowDocCommitDate(): Promise<string> {
  try {
    const { stdout } = await execFileP(
      'git',
      ['log', '-1', '--format=%cI', '--', WORKFLOW_PATH_REL],
      { cwd: REPO_ROOT },
    )
    const trimmed = stdout.trim()
    if (trimmed) return trimmed
  } catch {
    // fall through
  }
  // Fall back to file mtime if git log is unavailable.
  try {
    const path = resolve(REPO_ROOT, WORKFLOW_PATH_REL)
    const s = await stat(path)
    return s.mtime.toISOString()
  } catch {
    return new Date(0).toISOString()
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function getWorkflowGraph(): Promise<WorkflowGraph> {
  const now = Date.now()
  if (CACHE && now - CACHE.cachedAt < CACHE_TTL_MS) {
    return CACHE.graph
  }

  let graph: WorkflowGraph
  try {
    const path = resolve(REPO_ROOT, WORKFLOW_PATH_REL)
    const md = await readFile(path, 'utf-8')
    const updatedAt = await getWorkflowDocCommitDate()
    const parsed = parseWorkflowDoc(md, updatedAt)
    // If the parser produced fewer than 10 workflow nodes, the doc format
    // probably drifted — fall back so the tab is never empty.
    const wfCount = parsed.nodes.filter(n => n.type === 'workflow').length
    graph = wfCount >= 10 ? parsed : baselineGraph(updatedAt)
  } catch (err) {
    console.warn('[workflow-parser] doc unreadable, using baseline:', err)
    graph = baselineGraph(new Date().toISOString())
  }

  CACHE = { graph, cachedAt: now }
  return graph
}

export function parseWorkflowDoc(md: string, updatedAt: string): WorkflowGraph {
  const lines = md.split(/\r?\n/)
  const nodes: WorkflowGraphNode[] = []
  const edges: WorkflowGraphEdge[] = []

  // Departments — fixed list per master plan §1.8.
  for (const dept of KNOWN_DEPARTMENTS) {
    nodes.push({
      id: `dept-${slugFromTitle(dept)}`,
      type: 'department',
      title: dept,
      description: '',
      meta: { active: true },
    })
  }

  // Operating models — within section 1.1 of the doc.
  let inOperatingModelsSection = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('### 1.1')) inOperatingModelsSection = true
    else if (line.startsWith('### ') && !line.startsWith('### 1.1')) inOperatingModelsSection = false
    if (!inOperatingModelsSection) continue
    const m = line.match(OPERATING_MODEL_HEADING_RE)
    if (m) {
      const code = m[1]
      const desc = m[2]
      const bodyParts: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith('#')) break
        bodyParts.push(lines[j])
      }
      nodes.push({
        id: `model-${code.replace(/\s+/g, '-').toLowerCase()}`,
        type: 'operating_model',
        title: `${code} — ${desc}`,
        description: bodyParts.join('\n').trim().slice(0, 400),
        meta: { code },
      })
    }
  }

  // Workflows — Part 3, headings shaped `### Workflow N — Title`.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(WORKFLOW_HEADING_RE)
    if (!m) continue
    const num = parseInt(m[1], 10)
    const title = m[2]
    const bodyParts: string[] = []
    let trigger = ''
    let sequence = ''
    let inTrigger = false
    let inSequence = false
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j]
      if (ln.startsWith('### Workflow')) break
      if (ln.startsWith('### ') && !ln.startsWith('### Workflow')) break
      if (ln.startsWith('## ')) break
      bodyParts.push(ln)
      if (ln.startsWith('#### Trigger')) { inTrigger = true; inSequence = false; continue }
      if (ln.startsWith('#### Sequence')) { inSequence = true; inTrigger = false; continue }
      if (ln.startsWith('#### ')) { inTrigger = false; inSequence = false; continue }
      if (inTrigger) trigger += ln + '\n'
      if (inSequence) sequence += ln + '\n'
    }

    nodes.push({
      id: `wf-${num}`,
      type: 'workflow',
      title: `W${num}. ${title}`,
      description: bodyParts.join('\n').trim().slice(0, 1200),
      meta: {
        number: num,
        trigger: trigger.trim().slice(0, 300),
        sequence: sequence.trim().slice(0, 600),
      },
    })

    // Department edges — heuristic match against body text.
    const bodyLower = bodyParts.join('\n').toLowerCase()
    const referencedDepts = KNOWN_DEPARTMENTS.filter(d =>
      bodyLower.includes(d.toLowerCase().split(/[\s/]/)[0]),
    )
    for (const dept of referencedDepts) {
      edges.push({
        id: `e-wf-${num}-${slugFromTitle(dept)}`,
        source: `dept-${slugFromTitle(dept)}`,
        target: `wf-${num}`,
        label: 'owns',
      })
    }

    // Sequential edge to previous workflow.
    if (num > 1) {
      edges.push({
        id: `e-flow-${num - 1}-${num}`,
        source: `wf-${num - 1}`,
        target: `wf-${num}`,
        label: 'next',
      })
    }
  }

  // Operating-model → workflow edges. Body-text references to "Model A/B/C"
  // are how the doc annotates which model a workflow belongs to.
  const modelRefs: Array<{ code: string; needles: string[] }> = [
    { code: 'Model A', needles: ['model a', 'back-to-back'] },
    { code: 'Model B', needles: ['model b', 'speculative', 'position book'] },
    { code: 'Model C', needles: ['model c', 'dubai warehouse', 'local stock'] },
  ]
  for (const node of nodes) {
    if (node.type !== 'workflow') continue
    const haystack = (node.description + ' ' + node.title).toLowerCase()
    for (const ref of modelRefs) {
      if (ref.needles.some(n => haystack.includes(n))) {
        edges.push({
          id: `e-${slugFromTitle(ref.code)}-${node.id}`,
          source: `model-${slugFromTitle(ref.code)}`,
          target: node.id,
          label: 'applies-to',
        })
      }
    }
  }

  return { nodes, edges, updated_at: updatedAt, source: 'maxons-doc' }
}

export function baselineGraph(updatedAt: string): WorkflowGraph {
  const nodes: WorkflowGraphNode[] = []
  const edges: WorkflowGraphEdge[] = []

  for (const dept of KNOWN_DEPARTMENTS) {
    nodes.push({
      id: `dept-${slugFromTitle(dept)}`,
      type: 'department',
      title: dept,
      description: '',
      meta: { active: true },
    })
  }

  for (const m of BASELINE_OPERATING_MODELS) {
    nodes.push({
      id: `model-${slugFromTitle(m.code)}`,
      type: 'operating_model',
      title: m.title,
      description: m.desc,
      meta: { code: m.code },
    })
  }

  for (const wf of BASELINE_WORKFLOWS) {
    nodes.push({
      id: `wf-${wf.n}`,
      type: 'workflow',
      title: `W${wf.n}. ${wf.title}`,
      description: wf.desc,
      meta: { number: wf.n },
    })
    for (const dept of wf.depts) {
      edges.push({
        id: `e-wf-${wf.n}-${slugFromTitle(dept)}`,
        source: `dept-${slugFromTitle(dept)}`,
        target: `wf-${wf.n}`,
        label: 'owns',
      })
    }
    if (wf.n > 1) {
      edges.push({
        id: `e-flow-${wf.n - 1}-${wf.n}`,
        source: `wf-${wf.n - 1}`,
        target: `wf-${wf.n}`,
        label: 'next',
      })
    }
  }

  // Crude operating-model attribution for the baseline.
  const modelEdges: Array<[string, number[]]> = [
    ['Model A', [2, 3, 4, 9, 10, 11]],
    ['Model B', [1, 4, 8, 14]],
    ['Model C', [5, 6, 7, 13]],
  ]
  for (const [code, wfs] of modelEdges) {
    for (const n of wfs) {
      edges.push({
        id: `e-${slugFromTitle(code)}-wf-${n}`,
        source: `model-${slugFromTitle(code)}`,
        target: `wf-${n}`,
        label: 'applies-to',
      })
    }
  }

  return { nodes, edges, updated_at: updatedAt, source: 'baseline-fallback' }
}
