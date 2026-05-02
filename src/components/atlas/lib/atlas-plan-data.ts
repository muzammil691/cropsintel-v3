// Hardcoded master-plan tree (1.10an-remediation-2)
//
// The cockpit's Plan tab fetches the live tree from `/atlas/plan` (see
// AtlasPlanTab.tsx + atlas-client.fetchPlan). This file ships a static
// fallback so the tree still renders if the API is unreachable, and so
// fixture-driven tests have a deterministic shape to assert against.

export interface PlanNode {
  /** Stable, unique slug — used for selection state + deep-linking. */
  id: string
  /** Display title shown in the tree row. */
  title: string
  /** Phase number this node belongs to (1, 2, 3, 4). */
  phase: 1 | 2 | 3 | 4
  /** Optional one-line summary shown in the sheet drawer. */
  summary?: string
  /** Status hint — drives the tree row chip. */
  status?: 'planned' | 'in-progress' | 'shipped' | 'blocked'
  /** Children form the collapsible sub-tree. */
  children?: PlanNode[]
}

export const PLAN: PlanNode = {
  id: 'cropsintel-v3',
  title: 'CropsIntel V3 master plan',
  phase: 1,
  summary: 'Multi-commodity trading intelligence platform — eleven runtime agents.',
  children: [
    {
      id: 'phase-1',
      title: 'Phase 1 — Foundation',
      phase: 1,
      summary: 'Auth, schema, Adela, Atlas conductor, Zyra v1.',
      status: 'in-progress',
      children: [
        { id: 'phase-1.1', title: '1.1 Schema bedrock', phase: 1, status: 'shipped' },
        { id: 'phase-1.2', title: '1.2 RLS + roles', phase: 1, status: 'shipped' },
        { id: 'phase-1.3', title: '1.3 Auth (email + WhatsApp + Google)', phase: 1, status: 'shipped' },
        { id: 'phase-1.4', title: '1.4 Subscription tiers', phase: 1, status: 'shipped' },
        { id: 'phase-1.5', title: '1.5 Admin shell', phase: 1, status: 'shipped' },
        { id: 'phase-1.6', title: '1.6 Adela ingestion', phase: 1, status: 'in-progress' },
        { id: 'phase-1.7', title: '1.7 Public landing', phase: 1, status: 'shipped' },
        { id: 'phase-1.8', title: '1.8 Customer area v1', phase: 1, status: 'planned' },
        { id: 'phase-1.9', title: '1.9 CRM bedrock', phase: 1, status: 'planned' },
        {
          id: 'phase-1.10',
          title: '1.10 Atlas conductor',
          phase: 1,
          status: 'in-progress',
          children: [
            { id: 'phase-1.10a', title: '1.10a Atlas auth + login', phase: 1, status: 'shipped' },
            { id: 'phase-1.10b', title: '1.10b Status + cost meter', phase: 1, status: 'shipped' },
            { id: 'phase-1.10c', title: '1.10c Trust modes', phase: 1, status: 'shipped' },
            { id: 'phase-1.10d', title: '1.10d Slash commands', phase: 1, status: 'shipped' },
            { id: 'phase-1.10e', title: '1.10e Mentions + agents', phase: 1, status: 'shipped' },
            { id: 'phase-1.10f', title: '1.10f Voice (TTS + STT)', phase: 1, status: 'shipped' },
            { id: 'phase-1.10g', title: '1.10g Live mode', phase: 1, status: 'shipped' },
            { id: 'phase-1.10h', title: '1.10h Artifacts pane', phase: 1, status: 'shipped' },
            { id: 'phase-1.10i', title: '1.10i Plan tree', phase: 1, status: 'shipped' },
            { id: 'phase-1.10j', title: '1.10j Workflow trace', phase: 1, status: 'shipped' },
            { id: 'phase-1.10k', title: '1.10k Audit log', phase: 1, status: 'shipped' },
            { id: 'phase-1.10l', title: '1.10l Forks + design audits', phase: 1, status: 'shipped' },
            { id: 'phase-1.10m', title: '1.10m Diagnose tool', phase: 1, status: 'shipped' },
            { id: 'phase-1.10n', title: '1.10n Unified cockpit', phase: 1, status: 'in-progress' },
          ],
        },
        { id: 'phase-1.11', title: '1.11 Zyra v1', phase: 1, status: 'planned' },
      ],
    },
    {
      id: 'phase-2',
      title: 'Phase 2 — Council + CRM Intelligence',
      phase: 2,
      summary: 'Multi-Brain debate, CRM next-best-action, quote drafting.',
      status: 'planned',
      children: [
        { id: 'phase-2.1', title: '2.1 Atlas debate / council', phase: 2, status: 'planned' },
        { id: 'phase-2.2', title: '2.2 CRM Intelligence agent', phase: 2, status: 'planned' },
        { id: 'phase-2.3', title: '2.3 Quote drafting assistant', phase: 2, status: 'planned' },
      ],
    },
    {
      id: 'phase-3',
      title: 'Phase 3 — Document AI + anomaly detection',
      phase: 3,
      summary: 'Doc classification, predictive ETA, anomaly scan, CS backup.',
      status: 'planned',
      children: [
        { id: 'phase-3.1', title: '3.1 Document classification + extraction', phase: 3, status: 'planned' },
        { id: 'phase-3.2', title: '3.2 Predictive ETA', phase: 3, status: 'planned' },
        { id: 'phase-3.3', title: '3.3 Anomaly detector', phase: 3, status: 'planned' },
        { id: 'phase-3.4', title: '3.4 Customer service backup', phase: 3, status: 'planned' },
      ],
    },
    {
      id: 'phase-4',
      title: 'Phase 4 — Verified social + self-improvement',
      phase: 4,
      summary: 'Verified-tier social network, Atlas-Pro self-management.',
      status: 'planned',
      children: [
        { id: 'phase-4.1', title: '4.1 Verified social network', phase: 4, status: 'planned' },
        { id: 'phase-4.2', title: '4.2 Atlas-Pro self-improvement', phase: 4, status: 'planned' },
      ],
    },
  ],
}

/**
 * Recursive title search. Returns a flat array of nodes whose title contains
 * the query (case-insensitive). Empty query returns empty list.
 */
export function searchPlan(node: PlanNode, query: string): PlanNode[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: PlanNode[] = []
  function visit(n: PlanNode) {
    if (n.title.toLowerCase().includes(q)) hits.push(n)
    n.children?.forEach(visit)
  }
  visit(node)
  return hits
}
