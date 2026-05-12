// 1.10bb-c Session 9A — credential vault.
//
// Symmetric authenticated encryption for atlas_connections secrets. Uses
// libsodium's XSalsa20-Poly1305 (crypto_secretbox) — same primitive Supabase
// Vault uses underneath, but here the key is held in a Railway env var
// instead of a managed-DB extension. Trade-off: simpler to deploy + portable
// across Postgres providers, at the cost of putting key-rotation policy on
// the operator instead of the DB.
//
// Key handling
//   • ATLAS_VAULT_KEY env var holds a base64-encoded 32-byte (256-bit) key.
//   • Generate one once:
//       node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
//   • Set on Railway BEFORE running any /atlas/connections POST/rotate.
//   • Rotating the key requires re-encrypting every existing row — script
//     belongs in a follow-on; not in 9A.
//
// Storage shape (atlas_connections columns)
//   • encrypted_value  bytea — XSalsa20-Poly1305 ciphertext (includes MAC)
//   • encryption_nonce bytea — 24-byte nonce, fresh per encrypt
//
// On Railway, missing key surfaces as a clean error rather than crashing the
// process — admins get a 503 with a hint instead of opaque 500s.

import sodium from 'libsodium-wrappers'

let ready = false
let key: Uint8Array | null = null
let initError: string | null = null

async function ensureReady(): Promise<void> {
  if (ready) return
  await sodium.ready
  const raw = process.env.ATLAS_VAULT_KEY
  if (!raw) {
    initError = 'ATLAS_VAULT_KEY env var is not set. Generate with `node -e \'console.log(require("crypto").randomBytes(32).toString("base64"))\'` and set on Railway.'
    ready = true
    return
  }
  try {
    const decoded = sodium.from_base64(raw, sodium.base64_variants.ORIGINAL)
    if (decoded.length !== sodium.crypto_secretbox_KEYBYTES) {
      initError = `ATLAS_VAULT_KEY must decode to ${sodium.crypto_secretbox_KEYBYTES} bytes; got ${decoded.length}. Re-generate with the recommended command.`
    } else {
      key = decoded
    }
  } catch (err) {
    initError = `ATLAS_VAULT_KEY is not valid base64: ${err instanceof Error ? err.message : String(err)}`
  }
  ready = true
}

export class VaultUnconfiguredError extends Error {
  constructor(detail: string) {
    super(detail)
    this.name = 'VaultUnconfiguredError'
  }
}

export interface VaultEncrypted {
  /** Ciphertext bytes (includes the 16-byte Poly1305 MAC). */
  ciphertext: Uint8Array
  /** 24-byte nonce — must be stored alongside the ciphertext. */
  nonce: Uint8Array
}

/**
 * Encrypt a UTF-8 plaintext secret. Each call generates a fresh nonce.
 * Throws VaultUnconfiguredError when the key isn't loadable so callers can
 * map that to a 503 cleanly.
 */
export async function vaultEncrypt(plaintext: string): Promise<VaultEncrypted> {
  await ensureReady()
  if (!key) throw new VaultUnconfiguredError(initError ?? 'Vault key not loaded')
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES)
  const ciphertext = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, key)
  return { ciphertext, nonce }
}

/**
 * Decrypt a previously-encrypted secret. Returns the original UTF-8 string.
 * Throws VaultUnconfiguredError if key missing, or a generic Error on
 * MAC/key mismatch (which is the "wrong key" / "tampered ciphertext" case).
 */
export async function vaultDecrypt(ciphertext: Uint8Array, nonce: Uint8Array): Promise<string> {
  await ensureReady()
  if (!key) throw new VaultUnconfiguredError(initError ?? 'Vault key not loaded')
  const plain = sodium.crypto_secretbox_open_easy(ciphertext, nonce, key)
  return sodium.to_string(plain)
}

/**
 * Last-4-chars mask used in list responses. Returns the literal "••••" pad
 * when the input is shorter than 4 chars so we never leak the full short
 * secret. The output is purely for display — callers MUST NOT round-trip it
 * back as a real credential.
 */
export function maskSecret(plaintext: string): { masked: string; last4: string } {
  const trimmed = plaintext.trim()
  if (trimmed.length <= 4) {
    return { masked: '••••', last4: '' }
  }
  const last4 = trimmed.slice(-4)
  return { masked: `••••••••${last4}`, last4 }
}

/**
 * Operator-facing readiness check. Used by the /atlas/connections route to
 * decide whether to refuse with a clean 503 vs. proceeding into a write.
 */
export async function vaultIsReady(): Promise<{ ok: boolean; error?: string }> {
  await ensureReady()
  if (key) return { ok: true }
  return { ok: false, error: initError ?? 'Vault key not loaded' }
}
