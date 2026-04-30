import { execFileSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { getRepoRoot } from './env'
import { ChangedFile } from '../types'

export function listChangedFiles(headBefore: string, headAfter: string): string[] {
  const repoRoot = getRepoRoot()
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', `${headBefore}..${headAfter}`],
      { cwd: repoRoot, encoding: 'utf-8' },
    )
    return out
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[designer] git diff failed (${msg}) — falling back to working tree`)
    return []
  }
}

export function readUIFiles(paths: string[]): ChangedFile[] {
  const repoRoot = getRepoRoot()
  const result: ChangedFile[] = []

  for (const rel of paths) {
    if (!isUIFile(rel)) continue
    const abs = join(repoRoot, rel)
    if (!existsSync(abs)) continue
    try {
      const contents = readFileSync(abs, 'utf-8')
      result.push({ path: rel, contents })
    } catch {
      // ignore unreadable
    }
  }

  return result
}

export function isUIFile(path: string): boolean {
  return /\.(tsx|jsx|css|scss)$/i.test(path) && !/node_modules|dist|\.next|build/i.test(path)
}

export function getDiff(headBefore: string, headAfter: string): string {
  const repoRoot = getRepoRoot()
  try {
    return execFileSync(
      'git',
      ['diff', `${headBefore}..${headAfter}`],
      { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 8 * 1024 * 1024 },
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[designer] git diff content failed: ${msg}`)
    return ''
  }
}
