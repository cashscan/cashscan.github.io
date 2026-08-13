// Tiny in-memory + localStorage-backed TTL cache. Not a general-purpose
// library on purpose — spec asks for minimal dependencies.

const mem = new Map()
const LS_PREFIX = 'cr:cache:'

function readLocalStorage(key) {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.expires < Date.now()) {
      localStorage.removeItem(LS_PREFIX + key)
      return null
    }
    return parsed.value
  } catch {
    return null
  }
}

function writeLocalStorage(key, value, ttlMs) {
  try {
    localStorage.setItem(
      LS_PREFIX + key,
      JSON.stringify({ value, expires: Date.now() + ttlMs })
    )
  } catch {
    // storage full / disabled — silently degrade to memory-only cache
  }
}

/**
 * Fetch `key` from cache, or call `fn()` and cache the result for `ttlMs`.
 * `persist` also mirrors the value into localStorage so it survives reloads
 * (useful for token metadata, which changes rarely).
 */
export async function cached(key, ttlMs, fn, { persist = false } = {}) {
  const now = Date.now()
  const hit = mem.get(key)
  if (hit && hit.expires > now) return hit.value

  if (persist) {
    const lsHit = readLocalStorage(key)
    if (lsHit !== null) {
      mem.set(key, { value: lsHit, expires: now + ttlMs })
      return lsHit
    }
  }

  const value = await fn()
  mem.set(key, { value, expires: now + ttlMs })
  if (persist) writeLocalStorage(key, value, ttlMs * 20) // persisted copy lives longer
  return value
}

export function clearCache() {
  mem.clear()
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(LS_PREFIX))
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* noop */
  }
}

export const TTL = {
  TOKEN_LIST: 60_000, // 1 min
  TOKEN_PRICE: 20_000, // 20s
  TOKEN_METADATA: 6 * 60 * 60_000, // 6h
  CHAIN_INSIGHTS: 5 * 60_000, // 5 min
  HISTORY: 5 * 60_000, // 5 min
  BCH_PRICE: 30_000
}
