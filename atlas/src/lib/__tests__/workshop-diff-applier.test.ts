import { describe, it, expect } from 'vitest'
import {
  applyAddOp,
  applyEditOp,
  applyRemoveOp,
  applyReorderOp,
  applyOpsToMasterPlan,
} from '../workshop-diff-applier'

// Fixture used by the sub-letter reorder test (the bug-class the user
// explicitly flagged). Phases 1.3, 1.3a, 1.3b, 1.3c, 1.3d, 1.4 — note
// that "1.3" must NOT match against "1.3a" or any of its siblings.
const SUB_LETTER_FIXTURE = [
  '# Master plan',
  '',
  '## Phase 1.3 — Top of 1.3',
  '',
  'body of 1.3',
  '',
  '## Phase 1.3a — First sub',
  '',
  'body of 1.3a',
  '',
  '## Phase 1.3b — Second sub',
  '',
  'body of 1.3b',
  '',
  '## Phase 1.3c — Third sub',
  '',
  'body of 1.3c',
  '',
  '## Phase 1.3d — Fourth sub',
  '',
  'body of 1.3d',
  '',
  '## Phase 1.4 — After the subs',
  '',
  'body of 1.4',
  '',
].join('\n')

describe('parser correctness (regression guards)', () => {
  it('finds "1.4" as exactly itself, not as "1.3" or "1.3a"', () => {
    // 1.4 is the only fixture phase with no children — safe target for the
    // regex-exactness check. (Removing parents with children is refused
    // by the cascade default — see the dedicated test in applyRemoveOp.)
    const result = applyRemoveOp(SUB_LETTER_FIXTURE, { op: 'remove', phase_id: '1.4' })
    expect(result.verdict.applied).toBe(true)
    // 1.3 + its full sub-block must survive intact.
    for (const id of ['1.3 ', '1.3a', '1.3b', '1.3c', '1.3d']) {
      expect(result.markdown).toContain(`Phase ${id}`)
    }
    // Only 1.4 and its body are gone.
    expect(result.markdown).not.toContain('Phase 1.4 — After the subs')
    expect(result.markdown).not.toContain('body of 1.4')
  })

  it('handles UPPERCASE-suffix ids like 1.3d-DESIGNER-CREATE', () => {
    const md = [
      '## Phase 1.3 — Foo',
      '',
      '## Phase 1.3d-DESIGNER-CREATE — Designer creates layouts',
      '',
      'previous designer body',
    ].join('\n')
    const result = applyEditOp(md, {
      op: 'edit',
      phase_id: '1.3d-DESIGNER-CREATE',
      body: 'fresh designer body',
    })
    expect(result.verdict.applied).toBe(true)
    expect(result.markdown).toContain('1.3d-DESIGNER-CREATE')
    expect(result.markdown).toContain('fresh designer body')
    expect(result.markdown).not.toContain('previous designer body')
  })

  it('handles ### depth-3 headers without "Phase" prefix', () => {
    const md = [
      '# Plan',
      '',
      '### 1.3 Pilot commodity',
      '',
      'body of 1.3',
      '',
      '### 1.4 Three relationship graphs',
      '',
      'body of 1.4',
    ].join('\n')
    const result = applyRemoveOp(md, { op: 'remove', phase_id: '1.3' })
    expect(result.verdict.applied).toBe(true)
    expect(result.markdown).not.toContain('Pilot commodity')
    expect(result.markdown).toContain('Three relationship graphs')
  })
})

describe('applyAddOp', () => {
  it('appends at EOF when no parent_id', () => {
    const md = '# Plan\n\n## Phase 1.0 — existing\n\nbody\n'
    const result = applyAddOp(md, {
      op: 'add',
      phase_id: '1.1',
      title: 'New phase',
      body: 'new body',
    })
    expect(result.verdict.applied).toBe(true)
    expect(result.markdown).toContain('## Phase 1.1 — New phase')
    expect(result.markdown).toContain('new body')
    // Original phase still present.
    expect(result.markdown).toContain('## Phase 1.0 — existing')
  })

  it('inserts as child after last existing child of parent', () => {
    const md = [
      '## Phase 1.3 — Top',
      '',
      '## Phase 1.3a — Existing sub',
      '',
      'body a',
      '',
      '## Phase 1.4 — Next top',
      '',
      'body 4',
      '',
    ].join('\n')
    const result = applyAddOp(md, {
      op: 'add',
      phase_id: '1.3b',
      parent_id: '1.3',
      title: 'New sub',
      body: 'new sub body',
    })
    expect(result.verdict.applied).toBe(true)
    // 1.3b lands between 1.3a and 1.4.
    const idx3a = result.markdown.indexOf('Phase 1.3a')
    const idx3b = result.markdown.indexOf('Phase 1.3b')
    const idx4 = result.markdown.indexOf('Phase 1.4')
    expect(idx3a).toBeGreaterThanOrEqual(0)
    expect(idx3b).toBeGreaterThan(idx3a)
    expect(idx4).toBeGreaterThan(idx3b)
  })

  it('inserts as first child when parent has no children', () => {
    const md = [
      '## Phase 1.3 — Top',
      '',
      'body 3',
      '',
      '## Phase 1.4 — Next',
      '',
      'body 4',
      '',
    ].join('\n')
    const result = applyAddOp(md, {
      op: 'add',
      phase_id: '1.3a',
      parent_id: '1.3',
      title: 'First child',
      body: 'child body',
    })
    expect(result.verdict.applied).toBe(true)
    const idx3 = result.markdown.indexOf('Phase 1.3 — Top')
    const idx3a = result.markdown.indexOf('Phase 1.3a')
    const idx4 = result.markdown.indexOf('Phase 1.4')
    expect(idx3a).toBeGreaterThan(idx3)
    expect(idx3a).toBeLessThan(idx4)
  })

  it('skips when phase_id already exists', () => {
    const md = '## Phase 1.0 — existing\n\nbody\n'
    const result = applyAddOp(md, {
      op: 'add',
      phase_id: '1.0',
      title: 'Duplicate',
      body: 'should not land',
    })
    expect(result.verdict.applied).toBe(false)
    expect(result.verdict.reason).toMatch(/already exists/)
    expect(result.markdown).toBe(md)
    expect(result.markdown).not.toContain('should not land')
  })

  it('skips when parent_id is given but not found', () => {
    const md = '## Phase 1.0 — existing\n\nbody\n'
    const result = applyAddOp(md, {
      op: 'add',
      phase_id: '99.99',
      parent_id: 'does-not-exist',
      title: 'Orphan',
      body: 'b',
    })
    expect(result.verdict.applied).toBe(false)
    expect(result.verdict.reason).toMatch(/parent_id .* not found/)
    expect(result.markdown).toBe(md)
  })
})

describe('applyEditOp', () => {
  it('replaces body and keeps existing title when title not provided', () => {
    const md = [
      '## Phase 1.0 — Original title',
      '',
      'old body',
      '',
      '## Phase 1.1 — Next',
      '',
      'b',
    ].join('\n')
    const result = applyEditOp(md, {
      op: 'edit',
      phase_id: '1.0',
      body: 'new body',
    })
    expect(result.verdict.applied).toBe(true)
    expect(result.markdown).toContain('Phase 1.0 — Original title')
    expect(result.markdown).toContain('new body')
    expect(result.markdown).not.toContain('old body')
    // 1.1 must be untouched.
    expect(result.markdown).toContain('## Phase 1.1 — Next')
    expect(result.markdown).toContain('\nb')
  })

  it('updates title and preserves body when only title provided', () => {
    const md = [
      '## Phase 1.0 — Old title',
      '',
      'preserved body',
      '',
      '## Phase 1.1 — Next',
    ].join('\n')
    const result = applyEditOp(md, {
      op: 'edit',
      phase_id: '1.0',
      title: 'New title',
    })
    expect(result.verdict.applied).toBe(true)
    expect(result.markdown).toContain('Phase 1.0 — New title')
    expect(result.markdown).not.toContain('Old title')
    expect(result.markdown).toContain('preserved body')
  })

  it('updates both title and body when both provided', () => {
    const md = '## Phase 1.0 — Old\n\nold body\n'
    const result = applyEditOp(md, {
      op: 'edit',
      phase_id: '1.0',
      title: 'New',
      body: 'new body',
    })
    expect(result.verdict.applied).toBe(true)
    expect(result.markdown).toContain('Phase 1.0 — New')
    expect(result.markdown).toContain('new body')
    expect(result.markdown).not.toContain('Old')
    expect(result.markdown).not.toContain('old body')
  })

  it('skips when phase_id not found', () => {
    const md = '## Phase 1.0 — Exists\n\nbody\n'
    const result = applyEditOp(md, {
      op: 'edit',
      phase_id: '99.99',
      body: 'nope',
    })
    expect(result.verdict.applied).toBe(false)
    expect(result.verdict.reason).toMatch(/not found/)
    expect(result.markdown).toBe(md)
  })

  it('preserves header depth when editing', () => {
    const md = '### 1.5 deep header\n\nbody\n'
    const result = applyEditOp(md, {
      op: 'edit',
      phase_id: '1.5',
      title: 'edited',
      body: 'new body',
    })
    expect(result.verdict.applied).toBe(true)
    expect(result.markdown).toMatch(/^### /m) // still depth-3
    expect(result.markdown).not.toMatch(/^## /m) // no depth-2 sneaking in
  })
})

describe('applyRemoveOp', () => {
  it('deletes the section cleanly', () => {
    const md = [
      '## Phase 1.0 — A',
      '',
      'body A',
      '',
      '## Phase 1.1 — B',
      '',
      'body B',
      '',
    ].join('\n')
    const result = applyRemoveOp(md, { op: 'remove', phase_id: '1.0' })
    expect(result.verdict.applied).toBe(true)
    expect(result.markdown).not.toContain('Phase 1.0')
    expect(result.markdown).not.toContain('body A')
    expect(result.markdown).toContain('Phase 1.1 — B')
    expect(result.markdown).toContain('body B')
  })

  it('skips when phase_id not found', () => {
    const md = '## Phase 1.0 — A\n\nbody\n'
    const result = applyRemoveOp(md, { op: 'remove', phase_id: '99.99' })
    expect(result.verdict.applied).toBe(false)
    expect(result.markdown).toBe(md)
  })

  it('refuses on parent with children, lists them in reason', () => {
    // Defensive cascade default: removing 1.3 from the sub-letter fixture
    // would orphan 1.3a/1.3b/1.3c/1.3d. Force the user to be explicit
    // about cascade by removing children first.
    const result = applyRemoveOp(SUB_LETTER_FIXTURE, { op: 'remove', phase_id: '1.3' })
    expect(result.verdict.applied).toBe(false)
    expect(result.verdict.reason).toMatch(/1\.3 has children/)
    expect(result.verdict.reason).toMatch(/1\.3a/)
    expect(result.verdict.reason).toMatch(/1\.3b/)
    expect(result.verdict.reason).toMatch(/1\.3c/)
    expect(result.verdict.reason).toMatch(/1\.3d/)
    // Markdown is unchanged — no partial removal.
    expect(result.markdown).toBe(SUB_LETTER_FIXTURE)
  })

  it('allows removing a child phase even when siblings exist', () => {
    // Children are leaf nodes (no grandchildren) — removing 1.3a from the
    // sub-letter fixture must succeed; 1.3 (parent) and 1.3b/1.3c/1.3d
    // (siblings) survive.
    const result = applyRemoveOp(SUB_LETTER_FIXTURE, { op: 'remove', phase_id: '1.3a' })
    expect(result.verdict.applied).toBe(true)
    expect(result.markdown).not.toContain('Phase 1.3a')
    expect(result.markdown).not.toContain('body of 1.3a')
    for (const id of ['1.3 ', '1.3b', '1.3c', '1.3d', '1.4']) {
      expect(result.markdown).toContain(`Phase ${id}`)
    }
  })

  it('allows cascade when children are removed first in the same pipeline', () => {
    // Multi-op pipeline: remove all four children, then remove the parent.
    // This proves the user can express explicit cascade via separate ops.
    const result = applyOpsToMasterPlan(SUB_LETTER_FIXTURE, [
      { op: 'remove', phase_id: '1.3a' },
      { op: 'remove', phase_id: '1.3b' },
      { op: 'remove', phase_id: '1.3c' },
      { op: 'remove', phase_id: '1.3d' },
      { op: 'remove', phase_id: '1.3' },
    ])
    expect(result.applied).toHaveLength(5)
    expect(result.skipped).toHaveLength(0)
    expect(result.markdown).not.toContain('Phase 1.3 — Top of 1.3')
    expect(result.markdown).not.toContain('Phase 1.3a')
    expect(result.markdown).not.toContain('Phase 1.3b')
    expect(result.markdown).not.toContain('Phase 1.3c')
    expect(result.markdown).not.toContain('Phase 1.3d')
    // 1.4 survives.
    expect(result.markdown).toContain('Phase 1.4')
  })
})

describe('applyReorderOp — sub-letter pattern (load-bearing test)', () => {
  it('reorders [1.3a, 1.3c, 1.3b, 1.3d] keeping 1.3 and 1.4 in place', () => {
    const result = applyReorderOp(SUB_LETTER_FIXTURE, {
      op: 'reorder',
      parent_id: '1.3',
      ordered_phase_ids: ['1.3a', '1.3c', '1.3b', '1.3d'],
    })
    expect(result.verdict.applied).toBe(true)
    // Document order of headers in result:
    const positions = ['1.3 ', '1.3a', '1.3c', '1.3b', '1.3d', '1.4'].map(
      (id) => result.markdown.indexOf(`Phase ${id}`),
    )
    // None should be -1 (all present).
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0)
    // And they should be strictly increasing.
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
    // Each phase's body should travel with its header.
    expect(result.markdown).toMatch(/Phase 1\.3a[\s\S]*body of 1\.3a[\s\S]*Phase 1\.3c/)
    expect(result.markdown).toMatch(/Phase 1\.3c[\s\S]*body of 1\.3c[\s\S]*Phase 1\.3b/)
    expect(result.markdown).toMatch(/Phase 1\.3b[\s\S]*body of 1\.3b[\s\S]*Phase 1\.3d/)
    expect(result.markdown).toMatch(/Phase 1\.3d[\s\S]*body of 1\.3d[\s\S]*Phase 1\.4/)
  })

  it('full reorder [1.3d, 1.3c, 1.3b, 1.3a] reverses the sub-block', () => {
    const result = applyReorderOp(SUB_LETTER_FIXTURE, {
      op: 'reorder',
      parent_id: '1.3',
      ordered_phase_ids: ['1.3d', '1.3c', '1.3b', '1.3a'],
    })
    expect(result.verdict.applied).toBe(true)
    const positions = ['1.3 ', '1.3d', '1.3c', '1.3b', '1.3a', '1.4'].map(
      (id) => result.markdown.indexOf(`Phase ${id}`),
    )
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1])
    }
  })

  it('parent 1.3 stays before the reorder region; 1.4 stays after', () => {
    const result = applyReorderOp(SUB_LETTER_FIXTURE, {
      op: 'reorder',
      parent_id: '1.3',
      ordered_phase_ids: ['1.3d', '1.3a'],
    })
    expect(result.verdict.applied).toBe(true)
    const idx_1_3 = result.markdown.indexOf('Phase 1.3 — Top of 1.3')
    const idx_1_3d = result.markdown.indexOf('Phase 1.3d')
    const idx_1_3a = result.markdown.indexOf('Phase 1.3a')
    const idx_1_4 = result.markdown.indexOf('Phase 1.4')
    expect(idx_1_3).toBeLessThan(idx_1_3d)
    expect(idx_1_3d).toBeLessThan(idx_1_3a)
    expect(idx_1_3a).toBeLessThan(idx_1_4)
    // Unmentioned 1.3b and 1.3c travel with their adjacent listed phase's
    // block per the splice rule; they should still all be present.
    expect(result.markdown).toContain('Phase 1.3b')
    expect(result.markdown).toContain('Phase 1.3c')
  })

  it('skips when any phase_id in ordered list is missing', () => {
    const result = applyReorderOp(SUB_LETTER_FIXTURE, {
      op: 'reorder',
      parent_id: '1.3',
      ordered_phase_ids: ['1.3a', '1.3z-NOT-REAL', '1.3b'],
    })
    expect(result.verdict.applied).toBe(false)
    expect(result.verdict.reason).toMatch(/not found.*1\.3z-NOT-REAL/)
  })

  it('reports no-op when listed order matches current order', () => {
    const result = applyReorderOp(SUB_LETTER_FIXTURE, {
      op: 'reorder',
      parent_id: '1.3',
      ordered_phase_ids: ['1.3a', '1.3b', '1.3c', '1.3d'],
    })
    expect(result.verdict.applied).toBe(true)
    expect(result.verdict.reason).toMatch(/no-op/)
  })

  it('skips with reason when fewer than 2 ids given', () => {
    const result = applyReorderOp(SUB_LETTER_FIXTURE, {
      op: 'reorder',
      parent_id: '1.3',
      ordered_phase_ids: ['1.3a'],
    })
    expect(result.verdict.applied).toBe(false)
    expect(result.verdict.reason).toMatch(/at least 2/)
  })
})

describe('applyOpsToMasterPlan (orchestrator)', () => {
  it('runs a multi-op pipeline and accounts for each', () => {
    const md = [
      '# Plan',
      '',
      '## Phase 1.0 — A',
      '',
      'old A',
      '',
      '## Phase 1.1 — B',
      '',
      'b',
      '',
    ].join('\n')
    const result = applyOpsToMasterPlan(md, [
      { op: 'edit', phase_id: '1.0', body: 'new A' },
      { op: 'add', phase_id: '1.2', title: 'C', body: 'c' },
      { op: 'remove', phase_id: '1.1' },
    ])
    expect(result.applied).toHaveLength(3)
    expect(result.skipped).toHaveLength(0)
    expect(result.markdown).toContain('Phase 1.0 — A')
    expect(result.markdown).toContain('new A')
    expect(result.markdown).not.toContain('old A')
    expect(result.markdown).toContain('Phase 1.2 — C')
    expect(result.markdown).not.toContain('Phase 1.1')
  })

  it('continues past a skipped op without aborting', () => {
    const md = '## Phase 1.0 — A\n\nbody\n'
    const result = applyOpsToMasterPlan(md, [
      { op: 'remove', phase_id: '99.99' }, // not found, should skip
      { op: 'edit', phase_id: '1.0', body: 'edited' }, // should still apply
    ])
    expect(result.applied).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
    expect(result.skipped[0].reason).toMatch(/not found/)
    expect(result.markdown).toContain('edited')
  })

  it('handles add → edit on same phase in one pipeline', () => {
    const md = '## Phase 1.0 — existing\n\nbody\n'
    const result = applyOpsToMasterPlan(md, [
      { op: 'add', phase_id: '1.1', title: 'New', body: 'initial' },
      { op: 'edit', phase_id: '1.1', body: 'revised' },
    ])
    expect(result.applied).toHaveLength(2)
    expect(result.markdown).toContain('Phase 1.1 — New')
    expect(result.markdown).toContain('revised')
    expect(result.markdown).not.toContain('initial')
  })
})
