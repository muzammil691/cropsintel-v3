import { execSync } from 'child_process'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { VerificationResult } from '../types'

export function getCurrentCommitSha(repoRoot: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, encoding: 'utf-8' }).trim()
  } catch {
    return 'unknown'
  }
}

export async function createRemediationTask(
  result: VerificationResult,
  originalTaskPath: string,
  queuedDir: string,
): Promise<string> {
  const originalSpec = readFileSync(originalTaskPath, 'utf-8')
  const remediationId = `${result.taskId}-remediation-${Date.now()}`

  const gapReport = result.gaps
    .map(g => `- [${g.severity.toUpperCase()}] ${g.check}: ${g.actual}\n  Fix: ${g.remediation}`)
    .join('\n')

  const remediationSpec = `# Task: ${result.taskId} — Remediation (Verification Agent)

**Verifier run:** ${new Date().toISOString()}
**Original task:** ${result.taskId}
**Gaps found:** ${result.gaps.length}

## Fix these gaps

The Verification Agent found the following gaps in the original implementation:

\`\`\`
${gapReport}
\`\`\`

${result.judgmentCallNotes ? `## AI Judgment Notes\n\n${result.judgmentCallNotes}\n\n` : ''}## Original task spec

${originalSpec}

---

**Done condition:** All gaps above are resolved. Run \`cd verifier && npm run audit ${result.taskId}\` to verify.
`

  if (!existsSync(queuedDir)) {
    mkdirSync(queuedDir, { recursive: true })
  }

  const remediationPath = join(queuedDir, `${remediationId}.md`)
  writeFileSync(remediationPath, remediationSpec, 'utf-8')
  console.log(`[verifier] Created remediation task: ${remediationPath}`)
  return remediationId
}
