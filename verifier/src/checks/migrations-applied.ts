import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { Gap, TaskSpec } from '../types'

function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? join(__dirname, '..', '..', '..')
}

function readAllMigrationsSql(root: string): string {
  const migrationsDir = join(root, 'supabase', 'migrations')
  if (!existsSync(migrationsDir)) return ''

  let sql = ''
  try {
    const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql'))
    for (const file of files) {
      sql += readFileSync(join(migrationsDir, file), 'utf-8') + '\n'
    }
  } catch {
    // silently ignore read errors
  }
  return sql
}

export function checkMigrationsApplied(spec: TaskSpec): Gap[] {
  const gaps: Gap[] = []
  const { tablesCreated, functionsCreated } = spec.migrationsRequired

  if (tablesCreated.length === 0 && functionsCreated.length === 0) return gaps

  const allSql = readAllMigrationsSql(getRepoRoot())

  for (const table of tablesCreated) {
    const re = new RegExp(
      `CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?${table}\\b`,
      'i',
    )
    if (!re.test(allSql)) {
      gaps.push({
        check: 'migrations-applied',
        severity: 'fail',
        expected: `Table '${table}' defined in supabase/migrations/`,
        actual: `No CREATE TABLE for '${table}' found in any migration file`,
        remediation: `Add a migration file that creates the '${table}' table`,
      })
    }
  }

  for (const func of functionsCreated) {
    const re = new RegExp(
      `CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?${func}\\b`,
      'i',
    )
    if (!re.test(allSql)) {
      gaps.push({
        check: 'migrations-applied',
        severity: 'warn',
        expected: `Function '${func}' defined in supabase/migrations/`,
        actual: `No CREATE FUNCTION for '${func}' found in any migration file`,
        remediation: `Add a migration file that creates the '${func}' function`,
      })
    }
  }

  return gaps
}
