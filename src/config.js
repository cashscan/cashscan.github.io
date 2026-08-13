// -----------------------------------------------------------------------
// One place for app identity + API bases. Nothing else in the codebase
// should hard-code the app name or an API host — import from here instead.
// -----------------------------------------------------------------------

// Canonical source repository. Set VITE_REPOSITORY_URL to an empty value to
// remove repository links from a deployment without changing any component.
export const REPOSITORY_URL =
  import.meta.env.VITE_REPOSITORY_URL ?? 'https://github.com/cashscan/cashscan.github.io'

export const APP = {
  name: 'CashScan',
  tagline: 'Explore CashTokens. Track liquidity. Stay non-custodial.',
  short: 'CashScan',
  repositoryUrl: REPOSITORY_URL,
  logoUrl: 'https://bitcoincash.org/img/green/bitcoin-cash-circle.svg'
}

// Riften Labs Indexer — verified live against https://docs.riftenlabs.com/cauldron/API/
// on 2026-08-12. Endpoints marked "unstable" in the docs are isolated behind
// src/services/cauldron.js so a future change only touches one file.
export const RIFTEN_API_BASE =
  import.meta.env.VITE_RIFTEN_API_BASE || 'https://indexer.riften.net'
// Paytaca BCMR registry — used as a fallback source for token metadata
export const PAYTACA_BCMR_API_BASE =
  import.meta.env.VITE_PAYTACA_BCMR_API_BASE || 'https://tokencert.paytaca.com'
// Browser-safe gateway for BCMR image URIs published as ipfs://<CID>.
export const IPFS_GATEWAY_BASE =
  import.meta.env.VITE_IPFS_GATEWAY_BASE || 'https://dweb.link/ipfs/'
// Riften caches verified BCMR icon assets and serves them as browser-safe images.
export const RIFTEN_TOKEN_ICON_BASE =
  import.meta.env.VITE_RIFTEN_TOKEN_ICON_BASE || 'https://meta.riften.net/icon'
// Read-only Chaingraph endpoint used for token supply, holder, and authchain data.
export const CHAINGRAPH_API_BASE =
  import.meta.env.VITE_CHAINGRAPH_API_BASE || 'https://chaingraph.paryonusd.com/v1/graphql'
// Public relays queried for token-related community notes. Comma-separated
// overrides let a deployment use BCH/Nostr-specific relays as they emerge.
export const NOSTR_RELAYS = (import.meta.env.VITE_NOSTR_RELAYS || 'wss://relay.bchnostr.com,wss://relay.nostr.band,wss://relay.damus.io')
  .split(',')
  .map((relay) => relay.trim())
  .filter(Boolean)
export const BCH_NOSTR_URL =
  import.meta.env.VITE_BCH_NOSTR_URL || 'https://bchnostr.com/'
// Cauldron DEX web app, used only for outbound "trade this token" links.
// CashScan never embeds or proxies trading — see spec section 23.
export const CAULDRON_APP_URL =
  import.meta.env.VITE_CAULDRON_APP_URL || 'https://app.cauldron.quest'

// Public BCH block explorer used for outbound tx/address links.
// Swappable via env so a self-hosted or alternate explorer can replace it.
export const BCH_EXPLORER_BASE =
  import.meta.env.VITE_BCH_EXPLORER_BASE || 'https://explorer.salemkode.com'

// Chaingraph / indexer used only for address-balance polling in Request.vue's
// "waiting for payment" monitor. Kept behind src/services/blockchain.js so the
// provider can be swapped without touching any view.
export const BLOCKCHAIN_API_BASE =
  import.meta.env.VITE_BLOCKCHAIN_API_BASE || 'https://api.fullstack.cash/v5'

export const FIAT_CURRENCIES = ['USD', 'PHP', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD']

export const DEFAULT_CURRENCY = 'USD'

// The BCH/USD Delphi oracle contract id (v2, live) — see /oracle/delphi endpoints.
export const BCH_USD_ORACLE_ID =
  'be0d0d8324e8cda41d34b85bd203ce2482256eb337a0ad0fea82c2ddd7306c88'

// CashScan never handles private keys or wallet balances (spec section 31).
// For anyone who needs an address to receive into, or wants to check what a
// wallet actually holds, we link out to a companion wallet app rather than
// building custody features here.
export const BCHPURZE_WALLET_URL =
  import.meta.env.VITE_BCHPURZE_WALLET_URL || 'https://bchpurze.onrender.com'
