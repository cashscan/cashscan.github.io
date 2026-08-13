// -----------------------------------------------------------------------
// Read-only BCH address observer. CashScan never signs or broadcasts
// transactions here — this file only ever performs GET-style lookups so a
// payment can be *detected*, never moved. Swap BLOCKCHAIN_API_BASE (see
// src/config.js) to point at a different indexer without touching callers.
// -----------------------------------------------------------------------
import { BLOCKCHAIN_API_BASE, BCH_EXPLORER_BASE } from '../config.js'
import { getJSON } from './http.js'
import { toCashAddr } from '../utils/bch.js'

/**
 * Returns { balanceSat, utxos } for a CashAddr address. Uses fullstack.cash's
 * public REST API (no key required for light use); if it fails, callers
 * should surface a retry state rather than assuming zero balance.
 */
export async function getAddressBalance(address) {
  const addr = toCashAddr(address)
  const data = await getJSON(`${BLOCKCHAIN_API_BASE}/electrumx/balance/${addr}`, { timeoutMs: 10000, retries: 1 })
  const bal = data?.balance
  if (!bal) return null
  return {
    confirmedSat: bal.confirmed ?? 0,
    unconfirmedSat: bal.unconfirmed ?? 0,
    totalSat: (bal.confirmed ?? 0) + (bal.unconfirmed ?? 0)
  }
}

/** Recent transaction ids touching this address, newest first. */
export async function getAddressTransactions(address, limit = 10) {
  const addr = toCashAddr(address)
  const data = await getJSON(`${BLOCKCHAIN_API_BASE}/electrumx/transactions/${addr}`, { timeoutMs: 10000 })
  const txs = data?.transactions ?? []
  return txs.slice(0, limit)
}

/** Confirmations for a given txid, via its containing block height vs tip. */
export async function getTxConfirmations(txid) {
  const details = await getJSON(`${BLOCKCHAIN_API_BASE}/electrumx/tx/data/${txid}`, { timeoutMs: 10000 })
  return details?.confirmations ?? 0
}

export function explorerAddressUrl(address) {
  return `${BCH_EXPLORER_BASE}/address/${toCashAddr(address)}`
}

export function explorerTxUrl(txid) {
  return `${BCH_EXPLORER_BASE}/tx/${txid}`
}
