// Everything persisted for the person using CashScan lives in localStorage.
// No account, no server-side database — see spec sections 14 & 32.

const KEYS = {
  requests: 'cr:requests',
  watchlist: 'cr:watchlist',
  settings: 'cr:settings'
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage disabled/full — request history simply won't persist this session
  }
}

// ---- Request history --------------------------------------------------

export function listRequests() {
  return read(KEYS.requests, []).sort((a, b) => b.createdAt - a.createdAt)
}

export function saveRequest(request) {
  const requests = read(KEYS.requests, [])
  const entry = {
    id: request.id || crypto.randomUUID(),
    createdAt: request.createdAt || Date.now(),
    asset: request.asset, // 'BCH' | 'TOKEN'
    address: request.address,
    amount: request.amount,
    fiatAmount: request.fiatAmount ?? null,
    fiatCurrency: request.fiatCurrency ?? null,
    tokenCategory: request.tokenCategory ?? null,
    tokenSymbol: request.tokenSymbol ?? null,
    tokenDecimals: request.tokenDecimals ?? null,
    description: request.description ?? '',
    uri: request.uri,
    status: request.status || 'pending', // pending | detected | confirmed | partial | wrong-token | expired
    expiresAt: request.expiresAt ?? null
  }
  requests.push(entry)
  write(KEYS.requests, requests)
  return entry
}

export function updateRequestStatus(id, status, extra = {}) {
  const requests = read(KEYS.requests, [])
  const idx = requests.findIndex((r) => r.id === id)
  if (idx === -1) return null
  requests[idx] = { ...requests[idx], status, ...extra }
  write(KEYS.requests, requests)
  return requests[idx]
}

export function getRequest(id) {
  return read(KEYS.requests, []).find((r) => r.id === id) || null
}

export function deleteRequest(id) {
  write(KEYS.requests, read(KEYS.requests, []).filter((r) => r.id !== id))
}

/** CSV export per spec section 39. */
export function requestsToCsv() {
  const rows = listRequests()
  const header = ['date', 'asset', 'token_category', 'amount', 'address', 'description', 'status', 'transaction_id']
  const lines = [header.join(',')]
  for (const r of rows) {
    const date = new Date(r.createdAt).toISOString()
    const cells = [
      date,
      r.asset,
      r.tokenCategory || '',
      r.amount,
      r.address,
      (r.description || '').replace(/"/g, '""'),
      r.status,
      r.txid || ''
    ].map((c) => (String(c).includes(',') ? `"${c}"` : c))
    lines.push(cells.join(','))
  }
  return lines.join('\n')
}

// ---- Watchlist ----------------------------------------------------------

export function getWatchlist() {
  return read(KEYS.watchlist, [])
}

export function isWatched(category) {
  return getWatchlist().includes(category)
}

export function toggleWatch(category) {
  const list = getWatchlist()
  const next = list.includes(category) ? list.filter((c) => c !== category) : [...list, category]
  write(KEYS.watchlist, next)
  return next
}

// ---- Settings -------------------------------------------------------------

const DEFAULT_SETTINGS = {
  currency: 'USD',
  theme: 'dark',
  confirmationsRequired: 0,
  communityEnabled: false,
  communitySystemFiltersEnabled: true,
  communitySystemFilterStates: {},
  communityFilters: [],
  bchExplorerBase: null,
  blockchainApiBase: null,
  lastAddress: null
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) }
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch }
  write(KEYS.settings, merged)
  return merged
}

/** Remembers the last BCH address used to create a request, so repeat
 * requests (a merchant's till, a creator's tip jar) don't require retyping
 * or re-pasting the address every time. */
export function rememberAddress(address) {
  saveSettings({ lastAddress: address })
}
