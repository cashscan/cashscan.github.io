// CashToken amounts are always integers on-chain. Converting to/from a
// human-readable decimal string must never touch floating point, or dust-level
// rounding errors compound across large supplies. Everything here works in
// BigInt for the raw side and plain strings for display.

/** raw integer amount (BigInt or numeric string) -> human display string */
export function rawToDisplay(raw, decimals = 0) {
  const value = BigInt(raw)
  if (decimals === 0) return value.toString()
  const negative = value < 0n
  const abs = negative ? -value : value
  const divisor = 10n ** BigInt(decimals)
  const whole = abs / divisor
  const frac = (abs % divisor).toString().padStart(decimals, '0').replace(/0+$/, '')
  const sign = negative ? '-' : ''
  return frac ? `${sign}${whole}.${frac}` : `${sign}${whole}`
}

/** human display string -> raw integer BigInt. Throws on malformed input. */
export function displayToRaw(display, decimals = 0) {
  const str = String(display).trim()
  if (!/^-?\d+(\.\d+)?$/.test(str)) throw new Error('Invalid token amount')
  const negative = str.startsWith('-')
  const unsigned = negative ? str.slice(1) : str
  const [wholePart, fracPart = ''] = unsigned.split('.')
  if (fracPart.length > decimals) {
    throw new Error(`Amount has more precision than token decimals (${decimals})`)
  }
  const paddedFrac = fracPart.padEnd(decimals, '0')
  const raw = BigInt(wholePart || '0') * 10n ** BigInt(decimals) + BigInt(paddedFrac || '0')
  return negative ? -raw : raw
}

/** Price API returns satoshis per smallest token unit — convert to sats per whole token. */
export function priceToSatsPerWholeToken(pricePerSmallestUnit, decimals) {
  return pricePerSmallestUnit * 10 ** decimals
}

export function formatTokenAmount(display, maxFractionDigits = 6) {
  const num = Number(display)
  if (!Number.isFinite(num)) return display
  if (num === 0) return '0'
  if (Math.abs(num) < 1) return num.toFixed(maxFractionDigits).replace(/0+$/, '').replace(/\.$/, '')
  return num.toLocaleString(undefined, { maximumFractionDigits: 4 })
}
