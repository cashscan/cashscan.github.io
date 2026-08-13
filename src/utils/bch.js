// Address handling backed by cashaddrjs rather than string-prefix guessing.
import { decode as cashaddrDecode, encode as cashaddrEncode } from 'cashaddrjs'

const PREFIX = 'bitcoincash'

/**
 * Validate + normalize any accepted BCH address form (with/without prefix,
 * legacy base58) into a canonical lower-case CashAddr with prefix.
 * Returns null if the address is not a valid BCH address.
 */
export function toCashAddr(input) {
  if (!input || typeof input !== 'string') return null
  const trimmed = input.trim()
  const withPrefix = trimmed.includes(':') ? trimmed : `${PREFIX}:${trimmed}`
  try {
    const { prefix, type, hash } = cashaddrDecode(withPrefix)
    return cashaddrEncode(prefix || PREFIX, type, hash)
  } catch {
    return null
  }
}

export function isValidBchAddress(input) {
  return toCashAddr(input) !== null
}

/** Address for display purposes: CashAddr with prefix, per spec section 33. */
export function displayAddress(input) {
  return toCashAddr(input) || input
}

/** Short "bitcoincash:qxy...9z8w" form for compact UI display. */
export function shortenAddress(address, head = 10, tail = 6) {
  const addr = toCashAddr(address) || address
  const [prefix, payload] = addr.includes(':') ? addr.split(':') : [PREFIX, addr]
  if (payload.length <= head + tail) return `${prefix}:${payload}`
  return `${prefix}:${payload.slice(0, head)}…${payload.slice(-tail)}`
}

// ---- Unit conversion (spec section 35) ------------------------------------

export const SATS_PER_BCH = 100_000_000

export function bchToSats(bch) {
  return BigInt(Math.round(Number(bch) * SATS_PER_BCH))
}

export function satsToBch(sats) {
  return Number(sats) / SATS_PER_BCH
}

export function bchToMbch(bch) {
  return Number(bch) * 1000
}

export function mbchToBch(mbch) {
  return Number(mbch) / 1000
}

export function formatBch(bch, decimals = 8) {
  return Number(bch).toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '.0')
}

// ---- Payment URI (spec section 5) -----------------------------------------

/**
 * Build a BIP21-style `bitcoincash:` payment URI. Only includes amount /
 * message when provided — never emits an invalid or malformed URI.
 */
export function buildPaymentUri({ address, amountBch, message, label }) {
  const addr = toCashAddr(address)
  if (!addr) throw new Error('Invalid BCH address')
  const [, payload] = addr.split(':')
  const params = new URLSearchParams()
  if (amountBch !== undefined && amountBch !== null && amountBch !== '') {
    params.set('amount', Number(amountBch).toFixed(8))
  }
  if (label) params.set('label', label)
  if (message) params.set('message', message)
  const query = params.toString()
  return `${PREFIX}:${payload}${query ? `?${query}` : ''}`
}

/** Parse a scanned/typed BCH URI or bare address into its component parts. */
export function parsePaymentUri(uri) {
  if (!uri) return null
  const trimmed = uri.trim()
  try {
    const withPrefix = trimmed.startsWith(PREFIX) ? trimmed : `${PREFIX}:${trimmed}`
    const [addrPart, queryPart] = withPrefix.split('?')
    const addr = toCashAddr(addrPart)
    if (!addr) return null
    const params = new URLSearchParams(queryPart || '')
    return {
      address: addr,
      amountBch: params.get('amount') ? Number(params.get('amount')) : null,
      message: params.get('message') || null,
      label: params.get('label') || null
    }
  } catch {
    return null
  }
}
