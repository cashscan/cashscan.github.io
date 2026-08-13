# CashScan

A Bitcoin Cash token explorer with real-time liquidity data, price charts, and transaction tracking.
Inspired by the idea behind [Bitrequest](https://github.com/bitrequest/bitrequest.github.io) —
lightweight, no account, no private keys — rebuilt from scratch for Bitcoin Cash and
CashTokens, with its own design and codebase.

## Principles

- BCH only, native CashTokens only — never modeled as ERC-20-style tokens
- Non-custodial: no accounts, no private keys, no seed phrases, no server wallet
- 100% frontend for the MVP — Browser → Riften Labs indexer → BCH indexer → price feed
- Mobile-first, installable as a PWA

## Getting started

```bash
npm install
cp .env.example .env   # optional — defaults already point at the live Riften indexer
npm run dev
```

```bash
npm run build           # production build to dist/
npm run preview
```

## GitHub Pages

To publish CashScan at `https://cashscan.github.io`, the GitHub organization
must own a repository named exactly `cashscan.github.io`. Rename or transfer the
current `cashscan/cashscan` repository to `cashscan/cashscan.github.io`, then:

1. Push this repository to the `main` branch.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**. Do not use
  **Deploy from a branch**, which publishes Vite source files and causes an
  unresolved `vue` module error.
3. Push another commit or run **Deploy GitHub Pages** manually from the Actions
  tab, then wait for it to complete.

The site uses hash routing, so shared request links remain portable without
server-side route rewrites.

## Architecture

```
src/
  components/     BottomNav, QrCode, TokenCard, SkeletonLoader
  views/          Dashboard, Request, Tokens, TokenDetails, Activity, Settings
  services/       cauldron.js  — all Riften Labs Cauldron indexer calls
                   bcmr.js      — normalizes BCMR metadata (handles missing data)
                   prices.js    — BCH/USD (Delphi oracle, with a REST fallback)
                   blockchain.js— read-only address/tx lookups for payment monitoring
                   http.js      — shared fetch w/ timeout + retry
                   cache.js     — short-TTL cache (memory + localStorage)
  utils/
    bch.js        address validation/normalization (cashaddrjs), BIP21 URIs, units
    token.js      decimal-safe raw <-> display token amounts (BigInt, no floats)
    storage.js    localStorage-backed request history + watchlist + settings
  config.js       the one place app name + API base URLs live
```

No component builds a Riften Labs URL directly — everything goes through
`src/services/cauldron.js`, so an endpoint change (several are marked
"unstable" in Riften's own docs) only needs one file touched.

## API

Verified live against `https://docs.riftenlabs.com/cauldron/API/` on 2026-08-12:

- `https://indexer.riften.net/cauldron/...` — tokens, prices, volume, TVL, pools, tx feed
- `https://indexer.riften.net/bcmr/...` — on-chain token registry metadata
- `https://indexer.riften.net/oracle/...` — BCH/USD Delphi oracle

All are public, unauthenticated GET endpoints. Override any base URL via `.env`
(see `.env.example`) without touching source.

## What's intentionally out of scope for v1

- **Trading/swapping** — CashScan links out to Cauldron rather than
  re-implementing an AMM (spec section 23).
- **Full token comparison table & QR scanner** — the data layer (services/
  utils) already supports both; they're straightforward follow-ups once the
  core flows above are validated with real usage.
- **PDF receipts** — the print-friendly receipt view covers this for now;
  swap in a PDF library later if a saved file is required.
- **Private keys / signing** — never, by design (spec section 31).

## Security notes

- The app only ever asks for a **public BCH address** — never a seed phrase,
  private key, or password.
- Payment "monitoring" is read-only balance/tx polling against a public
  indexer. CashScan cannot move, hold, or touch funds at any point.
- Nothing sensitive is put in URLs or localStorage — only addresses, public
  token ids, and amounts you typed in yourself.
