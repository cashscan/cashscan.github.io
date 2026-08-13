// Thin layer on top of cauldron.js's BCMR calls that normalizes the
// "metadata might not exist" cases into one predictable shape, so views
// never have to guard against null / missing fields themselves.
// Also provides fallback to Paytaca BCMR when Riften doesn't have metadata.
import { getTokenMetadata, getTokenMetadataAll } from './cauldron.js'
import { IPFS_GATEWAY_BASE, PAYTACA_BCMR_API_BASE, RIFTEN_TOKEN_ICON_BASE } from '../config.js'
import { getJSON } from './http.js'
import { cached, TTL } from './cache.js'

/**
 * Fetch token metadata from Paytaca BCMR
 */
async function getPaytacaMetadata(category) {
  try {
    return await getJSON(`${PAYTACA_BCMR_API_BASE}/api/v1/tokens/${category}`)
  } catch {
    return null
  }
}

function riftenIconUrl(category) {
  return category ? `${RIFTEN_TOKEN_ICON_BASE.replace(/\/$/, '')}/${encodeURIComponent(category)}` : null
}

function normalizeIconUrl(icon, category) {
  if (!icon || typeof icon !== 'string') return null
  const trimmed = icon.trim()
  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '')
    return path ? `${IPFS_GATEWAY_BASE.replace(/\/$/, '')}/${path}` : null
  }
  try {
    const url = new URL(trimmed)
    // Some registries publish a public ipfs.io gateway URL directly. It is
    // valid metadata, but that gateway can deny browser traffic. Riften's
    // verified icon endpoint is a stable image proxy for the same category.
    if (url.hostname === 'ipfs.io' || url.pathname.startsWith('/ipfs/')) {
      return riftenIconUrl(category) || url.href
    }
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/**
 * @returns {{ found: boolean, name: ?string, symbol: ?string, description: ?string,
 *   decimals: ?number, icon: ?string, website: ?string, category: ?string, registry: ?string }}
 */
export async function getNormalizedMetadata(category) {
  let raw = null
  try {
    // Try Riften first
    raw = await getTokenMetadata(category)
  } catch {
    raw = null
  }

  // If Riften doesn't have it, try Paytaca
  if (!raw) {
    try {
      const paytacaData = await cached(`bcmr:paytaca:${category}`, TTL.TOKEN_METADATA, () =>
        getPaytacaMetadata(category),
        { persist: true }
      )
      if (paytacaData) {
        return {
          found: true,
          name: paytacaData.name ?? null,
          symbol: paytacaData.symbol ?? null,
          description: paytacaData.description ?? null,
          decimals: typeof paytacaData.decimals === 'number' ? paytacaData.decimals : 0,
          icon: normalizeIconUrl(paytacaData.icon_url ?? paytacaData.image, category),
          website: paytacaData.website ?? null,
          category,
          registry: 'paytaca'
        }
      }
    } catch {
      // Paytaca also failed, return empty
    }
  }

  if (!raw) {
    return {
      found: false,
      name: null,
      symbol: null,
      description: null,
      decimals: null,
      icon: null,
      website: null,
      category,
      registry: null
    }
  }

  return {
    found: true,
    name: raw.name ?? null,
    symbol: raw.token?.symbol ?? null,
    description: raw.description ?? null,
    decimals: typeof raw.token?.decimals === 'number' ? raw.token.decimals : 0,
    icon: normalizeIconUrl(raw.uris?.icon, category),
    website: raw.uris?.web ?? null,
    category: raw.token?.category ?? category,
    registry: raw.filemeta?.source ?? 'riften'
  }
}

/** Whether *any* registry (including off-chain / OTR) has an entry. Used for the "verified" badge nuance in spec section 22. */
export async function hasAnyRegistryEntry(category) {
  try {
    const all = await getTokenMetadataAll(category)
    return Array.isArray(all) && all.length > 0
  } catch {
    return false
  }
}
