// -----------------------------------------------------------------------
// Every call to the Riften Labs indexer lives here. Views/components must
// never build a Riften URL themselves — this is the single service layer
// spec section 8 asks for. Endpoints marked "unstable" in the upstream
// docs (https://docs.riftenlabs.com/cauldron/API/) are commented as such
// so a future breaking change is easy to locate.
// -----------------------------------------------------------------------
import { RIFTEN_API_BASE, BCH_USD_ORACLE_ID } from '../config.js'
import { getJSON, qs } from './http.js'
import { cached, TTL } from './cache.js'

const BASE = RIFTEN_API_BASE

// ---- Token discovery -----------------------------------------------------

/** List tokens, paginated + sorted. STABLE-ish surface, UNSTABLE endpoint. */
export function getTokens({ limit = 30, offset = 0, by = 'tvl', order = 'desc' } = {}) {
  return cached(`tokens:${limit}:${offset}:${by}:${order}`, TTL.TOKEN_LIST, () =>
    getJSON(`${BASE}/cauldron/tokens/list_cached${qs({ limit, offset, by, order })}`)
  )
}

/** Free-text token search (name / symbol / category). UNSTABLE endpoint. */
export function searchTokens(query, { limit = 30, offset = 0, by = 'tvl', order = 'desc' } = {}) {
  if (!query) return getTokens({ limit, offset, by, order })
  return cached(`search:${query}:${limit}:${offset}:${by}:${order}`, TTL.TOKEN_LIST, () =>
    getJSON(`${BASE}/cauldron/tokens/search_cached${qs({ q: query, limit, offset, by, order })}`)
  )
}

/** Search sorted purely by live trade volume — used for "High Volume" filter. */
export function searchTokensByVolume(query) {
  return cached(`searchvol:${query}`, TTL.TOKEN_LIST, () =>
    getJSON(`${BASE}/cauldron/tokens/search_by_volume${qs({ search_query: query })}`)
  )
}

/** Batch metadata lookup by category id, e.g. for a watchlist. */
export function getTokensByIds(ids = []) {
  if (!ids.length) return Promise.resolve([])
  return cached(`byids:${ids.join(',')}`, TTL.TOKEN_LIST, () =>
    getJSON(`${BASE}/cauldron/tokens/list_cached_by_ids${qs({ ids: ids.join(',') })}`)
  )
}

// ---- BCMR metadata ---------------------------------------------------------

/** Registry (name/symbol/description/icon/website). Returns null if absent. */
export function getTokenMetadata(category) {
  return cached(`bcmr:${category}`, TTL.TOKEN_METADATA, () => getJSON(`${BASE}/bcmr/token/${category}`), {
    persist: true
  })
}

/** All known BCMR entries for a token (multiple registries, incl. OTR). */
export function getTokenMetadataAll(category) {
  return cached(`bcmr-all:${category}`, TTL.TOKEN_METADATA, () => getJSON(`${BASE}/bcmr/token/${category}/all`))
}

// ---- Price ------------------------------------------------------------

/** Current price in satoshis per smallest token unit. */
export function getTokenPrice(category) {
  return cached(`price:${category}`, TTL.TOKEN_PRICE, () => getJSON(`${BASE}/cauldron/price/${category}/current`))
}

export function getTokenPriceHistory(category, { start, end, stepsize } = {}) {
  return cached(`pricehist:${category}:${start}:${end}:${stepsize}`, TTL.HISTORY, () =>
    getJSON(`${BASE}/cauldron/price/${category}/history${qs({ start, end, stepsize })}`)
  )
}

/** UNSTABLE endpoint — candlesticks for the price chart. */
export function getTokenCandles(category, { start, end, stepsize } = {}) {
  return cached(`candles:${category}:${start}:${end}:${stepsize}`, TTL.HISTORY, () =>
    getJSON(`${BASE}/cauldron/price/${category}/candlesticks${qs({ start, end, stepsize })}`)
  )
}

// ---- Volume / TVL -----------------------------------------------------

export function getTokenVolume(category, { start, end } = {}) {
  return cached(`volume:${category}:${start}:${end}`, TTL.TOKEN_PRICE, () =>
    getJSON(`${BASE}/cauldron/volume/${category}${qs({ start, end })}`)
  )
}

export function getTokenTVL(category) {
  return cached(`tvl:${category}`, TTL.TOKEN_PRICE, () => getJSON(`${BASE}/cauldron/valuelocked/${category}`))
}

export function getMarketTVL() {
  return cached('tvl:all', TTL.TOKEN_PRICE, () => getJSON(`${BASE}/cauldron/valuelocked`))
}

export function getMarketVolume({ start, end } = {}) {
  return cached(`volume:all:${start}:${end}`, TTL.TOKEN_PRICE, () =>
    getJSON(`${BASE}/cauldron/volume${qs({ start, end })}`)
  )
}

// ---- Pools --------------------------------------------------------------

/** UNSTABLE endpoint. Requires both token ids (BCH pools use the token's own id). */
export function getActivePools(tokenA, tokenB) {
  return cached(`pools:${tokenA}:${tokenB}`, TTL.TOKEN_LIST, () =>
    getJSON(`${BASE}/cauldron/pool/active${qs({ token_a: tokenA, token_b: tokenB })}`)
  )
}

/** UNSTABLE endpoint — first pool ever created for a token. 404 -> null. */
export function getFirstPool(category) {
  return cached(`firstpool:${category}`, TTL.TOKEN_METADATA, () =>
    getJSON(`${BASE}/cauldron/token/${category}/first_pool`)
  )
}

// ---- Activity -----------------------------------------------------------

/** Latest Cauldron transactions, optionally filtered by token. */
export function getLatestTransactions({ limit = 25, offset = 0, token } = {}) {
  return cached(`tx:${limit}:${offset}:${token}`, TTL.TOKEN_PRICE, () =>
    getJSON(`${BASE}/cauldron/tx/latest${qs({ limit, offset, token })}`)
  )
}

// ---- BCH/USD oracle -------------------------------------------------------

/** Current BCH/USD. `oracle_price` is in cents per the Riften docs. */
export async function getBchPrice() {
  return cached('bchprice', TTL.BCH_PRICE, async () => {
    const data = await getJSON(`${BASE}/oracle/delphi/closest${qs({ token_id: BCH_USD_ORACLE_ID })}`)
    if (!data) return null
    return { usd: data.oracle_price / 100, timestamp: data.oracle_timestamp }
  })
}

export function getBchPriceHistory({ start, end, stepsize } = {}) {
  return cached(`bchpricehist:${start}:${end}:${stepsize}`, TTL.HISTORY, () =>
    getJSON(`${BASE}/oracle/cash/history${qs({ start, end, stepsize })}`)
  )
}

export function getMarketStats() {
  return cached('marketstats', TTL.TOKEN_PRICE, () => getJSON(`${BASE}/cauldron/contract/count`))
}
