// Master-plan tree parser.
//
// Phase 1.10ak: Atlas /atlas/plan endpoint reads .agent/master-plan.md and
// returns a tree the UI can render. The parser walks the markdown line by
// line, classifies headings (#, ##, ###, ####) into levels 1..4, and groups
// every non-heading line as the body of the most recent heading.
//
// Tolerance contract: never throw. If the file is empty or malformed, return
// a single-root tree with the whole content as its body. Unknown heading
// depths >4 collapse into level-4 leaves under the nearest H4.

export interface PlanNode {
  id: string
  level: number
  title: string
  body: string
  children: PlanNode[]
  source: { line: number; raw: string }
}

export interface PlanTree {
  root: PlanNode
  flat: PlanNode[]
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80)
}

export function parsePlan(markdown: string): PlanTree {
  const lines = markdown.split(/\r?\n/)
  const root: PlanNode = {
    id: 'root',
    level: 0,
    title: 'Plan',
    body: '',
    children: [],
    source: { line: 0, raw: '' },
  }
  const flat: PlanNode[] = []
  // Stack of ancestors keyed by level — we always append children to the
  // deepest ancestor whose level is less than the new node's level.
  const stack: PlanNode[] = [root]
  // Prelude collector: lines before the first heading become root.body.
  let preludeLines: string[] = []
  let currentNode: PlanNode | null = null
  let currentBodyLines: string[] = []
  const idCounts = new Map<string, number>()

  function commitBody(): void {
    if (currentNode) {
      currentNode.body = currentBodyLines.join('\n').replace(/\s+$/, '')
    } else {
      root.body = preludeLines.join('\n').replace(/\s+$/, '')
    }
  }

  function uniqueId(slug: string): string {
    const count = idCounts.get(slug) ?? 0
    idCounts.set(slug, count + 1)
    return count === 0 ? slug : `${slug}-${count + 1}`
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(HEADING_RE)
    if (m) {
      // Commit the body accumulated so far against the previous node.
      commitBody()
      currentBodyLines = []

      const hashes = m[1].length
      // Clamp to 1..4 — anything deeper is treated as a level-4 leaf.
      const level = Math.min(Math.max(hashes, 1), 4)
      const title = m[2].trim()
      const slugBase = slugify(title) || `node-${i + 1}`
      const id = uniqueId(`${level}-${slugBase}`)

      const node: PlanNode = {
        id,
        level,
        title,
        body: '',
        children: [],
        source: { line: i + 1, raw: line },
      }

      // Pop the stack until top.level < node.level, then attach.
      while (stack.length > 1 && stack[stack.length - 1].level >= node.level) {
        stack.pop()
      }
      stack[stack.length - 1].children.push(node)
      stack.push(node)

      flat.push(node)
      currentNode = node
    } else {
      if (currentNode) currentBodyLines.push(line)
      else preludeLines.push(line)
    }
  }

  commitBody()

  return { root, flat }
}

// Round-trip a tree back to markdown. Walks depth-first and emits each
// heading at its source level followed by its body. Used after a reorder
// or amend operation to write the full file back.
export function serializePlan(tree: PlanTree): string {
  const out: string[] = []
  if (tree.root.body) {
    out.push(tree.root.body)
    out.push('')
  }
  function walk(node: PlanNode): void {
    if (node.level > 0) {
      const hashes = '#'.repeat(node.level)
      out.push(`${hashes} ${node.title}`)
      if (node.body) {
        out.push('')
        out.push(node.body)
      }
      out.push('')
    }
    for (const child of node.children) walk(child)
  }
  for (const child of tree.root.children) walk(child)
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '') + '\n'
}

// Find a node by id, depth-first.
export function findNode(tree: PlanTree, id: string): PlanNode | null {
  if (tree.root.id === id) return tree.root
  return tree.flat.find(n => n.id === id) ?? null
}

// Move a node within the tree. Returns true if the move succeeded, false if
// either the moved id or the new parent id couldn't be resolved (e.g. moved
// node is an ancestor of the new parent — we refuse to create a cycle).
export function moveNode(
  tree: PlanTree,
  movedId: string,
  newParentId: string,
  newIndex: number,
): boolean {
  const moved = findNode(tree, movedId)
  const newParent = newParentId === 'root' ? tree.root : findNode(tree, newParentId)
  if (!moved || !newParent) return false

  // Cycle guard: refuse if newParent is moved itself or any of its descendants.
  function isDescendant(candidate: PlanNode, ancestor: PlanNode): boolean {
    if (candidate === ancestor) return true
    return ancestor.children.some(c => isDescendant(candidate, c))
  }
  if (isDescendant(newParent, moved)) return false

  // Find current parent and remove.
  function detach(node: PlanNode, target: PlanNode): boolean {
    const idx = node.children.indexOf(target)
    if (idx >= 0) {
      node.children.splice(idx, 1)
      return true
    }
    for (const child of node.children) {
      if (detach(child, target)) return true
    }
    return false
  }
  if (!detach(tree.root, moved)) return false

  // Adjust the moved node's level to fit under its new parent.
  const targetLevel = Math.min(Math.max(newParent.level + 1, 1), 4)
  function relevel(node: PlanNode, lvl: number): void {
    node.level = lvl
    for (const c of node.children) relevel(c, Math.min(lvl + 1, 4))
  }
  relevel(moved, targetLevel)

  const insertAt = Math.max(0, Math.min(newIndex, newParent.children.length))
  newParent.children.splice(insertAt, 0, moved)
  return true
}

// Rebuild flat list after structural mutations (reorder, edit, etc.).
export function rebuildFlat(root: PlanNode): PlanNode[] {
  const out: PlanNode[] = []
  function walk(n: PlanNode): void {
    if (n.level > 0) out.push(n)
    for (const c of n.children) walk(c)
  }
  walk(root)
  return out
}
