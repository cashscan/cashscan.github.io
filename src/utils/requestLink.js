// -----------------------------------------------------------------------
// Payment requests live only in the creator's localStorage (non-custodial,
// no backend — see spec sections 14 & 32). That means a link like
// "/request/<local-id>" only ever resolves on the device that created it.
//
// To make requests actually shareable, we encode the *entire* request into
// the URL itself. This is a compact BINARY layout (not JSON) because the
// two largest fields — a BCH address and a CashToken category — are both
// just hex/base32 text representations of raw bytes. Packing them back into
// raw bytes roughly halves the link/QR size versus encoding them as text
// inside base64'd JSON:
//   - a CashAddr hash serializes as ~34 text chars -> we store the 20 raw bytes
//   - a token category serializes as 64 hex chars  -> we store the 32 raw bytes
//
// A legacy JSON+base64 codec is kept as a fallback for any address type this
// binary layout doesn't recognize, and for decoding older links.
// -----------------------------------------------------------------------
import { decode as cashaddrDecode, encode as cashaddrEncode } from 'cashaddrjs'
import { toCashAddr } from './bch.js'

const BIN_MARKER = 0xc9 // first byte of the binary layout; legacy JSON payloads never start with this byte once base64-decoded
const ADDR_TYPE_CODES = { P2PKH: 0, P2SH: 1 }
const ADDR_TYPE_NAMES = ['P2PKH', 'P2SH']

// ---- byte <-> base64url ----------------------------------------------

function base64UrlEncodeBytes(bytes) {
  let binary = ''
  bytes.forEach((b) => { binary += String.fromCharCode(b) })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecodeBytes(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/')
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4)
  const binary = atob(withPadding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function base64UrlEncodeStr(str) { return base64UrlEncodeBytes(new TextEncoder().encode(str)) }
function base64UrlDecodeStr(str) { return new TextDecoder().decode(base64UrlDecodeBytes(str)) }

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  return bytes
}
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---- tiny binary reader/writer ----------------------------------------

class ByteWriter {
  constructor() { this.bytes = [] }
  u8(v) { this.bytes.push(v & 0xff) }
  u16(v) { this.bytes.push((v >>> 8) & 0xff, v & 0xff) }
  u32(v) { this.bytes.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff) }
  raw(arr) { for (const b of arr) this.bytes.push(b) }
  str8(s) {
    const enc = new TextEncoder().encode(s)
    if (enc.length > 255) throw new Error('field too long for compact payload')
    this.u8(enc.length)
    this.raw(enc)
  }
  str16(s) {
    const enc = new TextEncoder().encode(s)
    if (enc.length > 65535) throw new Error('field too long for compact payload')
    this.u16(enc.length)
    this.raw(enc)
  }
  toBytes() { return new Uint8Array(this.bytes) }
}

class ByteReader {
  constructor(bytes) { this.bytes = bytes; this.pos = 0 }
  u8() { return this.bytes[this.pos++] }
  u16() { const v = (this.bytes[this.pos] << 8) | this.bytes[this.pos + 1]; this.pos += 2; return v }
  u32() {
    const v = ((this.bytes[this.pos] << 24) | (this.bytes[this.pos + 1] << 16) | (this.bytes[this.pos + 2] << 8) | this.bytes[this.pos + 3]) >>> 0
    this.pos += 4
    return v
  }
  raw(n) { const b = this.bytes.slice(this.pos, this.pos + n); this.pos += n; return b }
  str8() { return new TextDecoder().decode(this.raw(this.u8())) }
  str16() { return new TextDecoder().decode(this.raw(this.u16())) }
}

// ---- compact binary layout ---------------------------------------------

function encodeBinary(request) {
  const fullAddr = toCashAddr(request.address)
  if (!fullAddr) throw new Error('invalid address')
  const decodedAddr = cashaddrDecode(fullAddr)
  const typeCode = ADDR_TYPE_CODES[decodedAddr.type]
  if (typeCode === undefined) throw new Error('unsupported address type for compact payload')

  const isToken = request.asset === 'TOKEN'
  const hasAmount = !!request.amount
  const hasDescription = !!request.description
  const hasFiat = !!(request.fiatAmount && request.fiatCurrency)
  const hasTokenSymbol = isToken && !!request.tokenSymbol
  const hasExpiry = !!request.expiresAt

  let catBytes = null
  if (isToken) {
    const catHex = request.tokenCategory || ''
    if (!/^[0-9a-fA-F]{64}$/.test(catHex)) throw new Error('unexpected token category format')
    catBytes = hexToBytes(catHex)
  }

  const flags =
    (isToken ? 1 << 0 : 0) |
    (hasAmount ? 1 << 1 : 0) |
    (hasDescription ? 1 << 2 : 0) |
    (hasFiat ? 1 << 3 : 0) |
    (hasTokenSymbol ? 1 << 4 : 0) |
    (hasExpiry ? 1 << 5 : 0)

  const w = new ByteWriter()
  w.u8(BIN_MARKER)
  w.u8(flags)
  w.u8(typeCode)
  w.u8(decodedAddr.hash.length)
  w.raw(decodedAddr.hash)

  if (isToken) {
    w.raw(catBytes)
    w.u8(request.tokenDecimals ?? 0)
    if (hasTokenSymbol) w.str8(request.tokenSymbol)
  }
  if (hasAmount) w.str8(String(request.amount))
  if (hasDescription) w.str16(request.description)
  if (hasFiat) {
    w.str8(String(request.fiatAmount))
    w.raw(new TextEncoder().encode(String(request.fiatCurrency).slice(0, 3).toUpperCase().padEnd(3, ' ')))
  }
  if (hasExpiry) w.u32(Math.floor(request.expiresAt / 1000))

  return base64UrlEncodeBytes(w.toBytes())
}

function decodeBinary(bytes) {
  const r = new ByteReader(bytes)
  r.u8() // marker, already checked by caller
  const flags = r.u8()
  const isToken = !!(flags & 1)
  const hasAmount = !!(flags & 2)
  const hasDescription = !!(flags & 4)
  const hasFiat = !!(flags & 8)
  const hasTokenSymbol = !!(flags & 16)
  const hasExpiry = !!(flags & 32)

  const typeCode = r.u8()
  const type = ADDR_TYPE_NAMES[typeCode]
  if (!type) return null
  const hash = r.raw(r.u8())
  const address = cashaddrEncode('bitcoincash', type, hash)

  let tokenCategory = null
  let tokenDecimals = null
  let tokenSymbol = null
  if (isToken) {
    tokenCategory = bytesToHex(r.raw(32))
    tokenDecimals = r.u8()
    if (hasTokenSymbol) tokenSymbol = r.str8()
  }

  const amount = hasAmount ? r.str8() : null
  const description = hasDescription ? r.str16() : ''
  let fiatAmount = null
  let fiatCurrency = null
  if (hasFiat) {
    fiatAmount = r.str8()
    fiatCurrency = new TextDecoder().decode(r.raw(3)).trim()
  }
  const expiresAt = hasExpiry ? r.u32() * 1000 : null

  return { asset: isToken ? 'TOKEN' : 'BCH', address, amount, description, fiatAmount, fiatCurrency, tokenCategory, tokenSymbol, tokenDecimals, expiresAt }
}

// ---- legacy JSON layout (fallback + old links) --------------------------

function encodeLegacyJson(request) {
  const compact = {
    v: 1,
    a: request.asset === 'TOKEN' ? 't' : 'b',
    addr: request.address,
    amt: request.amount || undefined,
    desc: request.description || undefined,
    fa: request.fiatAmount || undefined,
    fc: request.fiatCurrency || undefined,
    tc: request.tokenCategory || undefined,
    ts: request.tokenSymbol || undefined,
    td: request.tokenDecimals ?? undefined,
    exp: request.expiresAt || undefined
  }
  Object.keys(compact).forEach((k) => compact[k] === undefined && delete compact[k])
  return base64UrlEncodeStr(JSON.stringify(compact))
}

function decodeLegacyJson(payload) {
  try {
    const p = JSON.parse(base64UrlDecodeStr(payload))
    if (!p.addr) return null
    return {
      asset: p.a === 't' ? 'TOKEN' : 'BCH',
      address: p.addr,
      amount: p.amt ?? null,
      description: p.desc ?? '',
      fiatAmount: p.fa ?? null,
      fiatCurrency: p.fc ?? null,
      tokenCategory: p.tc ?? null,
      tokenSymbol: p.ts ?? null,
      tokenDecimals: p.td ?? null,
      expiresAt: p.exp ?? null
    }
  } catch {
    return null
  }
}

// ---- public API -----------------------------------------------------------

/** Pack a saved request (or an in-progress one) into the shortest URL-safe payload we can manage. */
export function encodeRequestPayload(request) {
  try {
    return encodeBinary(request)
  } catch {
    // Address type the compact layout doesn't recognize, or something else
    // unusual about the request — fall back to the (larger) JSON layout
    // rather than failing to generate a link at all.
    return encodeLegacyJson(request)
  }
}

/** Reverse of encodeRequestPayload. Understands both the compact binary layout and older JSON links. Returns null if malformed. */
export function decodeRequestPayload(payload) {
  try {
    const bytes = base64UrlDecodeBytes(payload)
    if (bytes[0] === BIN_MARKER) {
      const decoded = decodeBinary(bytes)
      if (decoded) return decoded
    }
  } catch {
    /* fall through to legacy decode */
  }
  return decodeLegacyJson(payload)
}

/** Build the full shareable URL for a request, independent of the current route. */
export function buildShareUrl(request) {
  const payload = encodeRequestPayload(request)
  return `${window.location.origin}/#/request?p=${payload}`
}
