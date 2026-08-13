// Every external call in the app should go through this so timeout / retry
// behaviour is consistent, instead of being reimplemented per-service.

export async function getJSON(url, { timeoutMs = 8000, retries = 1 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timer)
      if (!res.ok) {
        // 404 is often a legitimate "no data" response (e.g. no BCMR entry) —
        // let callers decide how to treat it rather than throwing.
        if (res.status === 404) return null
        throw new Error(`Request failed (${res.status})`)
      }
      return await res.json()
    } catch (err) {
      clearTimeout(timer)
      lastErr = err
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        continue
      }
    }
  }
  throw lastErr || new Error('Request failed')
}

export function qs(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  if (!entries.length) return ''
  return '?' + new URLSearchParams(entries).toString()
}
