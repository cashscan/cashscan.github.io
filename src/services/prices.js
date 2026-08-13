// BCH/USD comes primarily from the Riften Delphi oracle (on-chain, decentralized).
// A public REST fallback is used only if the oracle is unreachable, so the app
// never depends on a single price provider (spec section 12).
import { getBchPrice as getOraclePrice } from './cauldron.js'
import { getJSON } from './http.js'
import { cached, TTL } from './cache.js'
import { FIAT_CURRENCIES, DEFAULT_CURRENCY } from '../config.js'

const FALLBACK_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin-cash&vs_currencies=usd'

export { FIAT_CURRENCIES, DEFAULT_CURRENCY }

export async function getBchUsd() {
  try {
    const oracle = await getOraclePrice()
    if (oracle && oracle.usd > 0) return { usd: oracle.usd, source: 'delphi-oracle' }
  } catch {
    /* fall through to backup provider */
  }
  try {
    const fallback = await cached('bchprice:fallback', TTL.BCH_PRICE, () => getJSON(FALLBACK_URL))
    const usd = fallback?.['bitcoin-cash']?.usd
    if (usd) return { usd, source: 'coingecko' }
  } catch {
    /* both providers down */
  }
  return null
}

// Simple multi-currency conversion. Rates beyond USD are approximated from a
// single public endpoint; swap this out if a dedicated FX source is added.
export async function getFiatRates() {
  return cached('fxrates', 10 * 60_000, async () => {
    try {
      return await getJSON('https://api.exchangerate-api.com/v4/latest/USD')
    } catch {
      return null
    }
  })
}

export async function convertBchToFiat(bchAmount, currency = DEFAULT_CURRENCY) {
  const price = await getBchUsd()
  if (!price) return null
  let usdValue = bchAmount * price.usd
  if (currency === 'USD') return usdValue
  const rates = await getFiatRates()
  const rate = rates?.rates?.[currency]
  return rate ? usdValue * rate : null
}

export async function convertFiatToBch(fiatAmount, currency = DEFAULT_CURRENCY) {
  const price = await getBchUsd()
  if (!price) return null
  let usdAmount = fiatAmount
  if (currency !== 'USD') {
    const rates = await getFiatRates()
    const rate = rates?.rates?.[currency]
    if (!rate) return null
    usdAmount = fiatAmount / rate
  }
  return usdAmount / price.usd
}
