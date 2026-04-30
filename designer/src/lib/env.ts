export function getEnv(name: string, fallback?: string): string | undefined {
  const value = process.env[name]
  return value && value.length > 0 ? value : fallback
}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.length === 0) {
    throw new Error(`Required environment variable not set: ${name}`)
  }
  return value
}

export function getRepoRoot(): string {
  return process.env.REPO_ROOT ?? '/workspace/cropsintel-v3'
}

export function getPort(): number {
  return parseInt(process.env.PORT ?? '8080', 10)
}

export function getApiToken(): string {
  return process.env.DESIGNER_API_TOKEN ?? ''
}
