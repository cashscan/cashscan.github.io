<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { APP } from './config.js'
import { getBchUsd, convertBchToFiat } from './services/prices.js'
import { getTokens, getTokenTVL } from './services/cauldron.js'
import { getNormalizedMetadata } from './services/bcmr.js'
import { getSettings } from './utils/storage.js'
import BottomNav from './components/BottomNav.vue'

// The ticker is CashScan's signature element: a live terminal-style
// readout of BCH price + trending tokens, always running, reinforcing that
// this app watches the chain rather than holding funds.
const tickerItems = ref([])
let pollTimer = null

async function refreshTicker() {
  try {
    const [price, tokens] = await Promise.all([
      getBchUsd(),
      getTokens({ limit: 6, by: 'volume', order: 'desc' })
    ])
    
    // Get user's preferred currency from settings
    const settings = getSettings()
    const currency = settings.currency || 'USD'
    
    // Convert BCH price to selected currency if needed
    let displayPrice = price?.usd
    if (currency !== 'USD' && price?.usd) {
      const convertedPrice = await convertBchToFiat(1, currency)
      if (convertedPrice !== null) {
        displayPrice = convertedPrice
      }
    }
    
    // Enrich tokens with BCMR metadata
    const enrichedTokens = await Promise.all(
      (tokens || []).map(async (t) => {
        try {
          const meta = await getNormalizedMetadata(t.token_id)
          return {
            ...t,
            displaySymbol: meta?.symbol || t.symbol || '—',
            displayName: meta?.name || t.name || '—'
          }
        } catch {
          return { ...t, displaySymbol: t.symbol || '—', displayName: t.name || '—' }
        }
      })
    )
    
    // Fetch TVL for each token
    const withTVL = await Promise.all(
      enrichedTokens.map(async (t) => {
        try {
          const tvlData = await getTokenTVL(t.token_id)
          t.tvl = tvlData?.satoshis ? tvlData.satoshis / 1e8 : null
        } catch {
          t.tvl = null
        }
        return t
      })
    )
    
    const items = []
    if (displayPrice) {
      const priceLabel = currency === 'USD' ? `$${displayPrice.toFixed(2)}` : `${displayPrice.toFixed(2)} ${currency}`
      items.push({ label: `BCH/${currency}`, value: priceLabel, kind: 'bch' })
    }
    for (const t of withTVL) {
      const label = t.displaySymbol !== '—' ? t.displaySymbol : t.displayName
      let value = 'active'
      if (t.tvl) {
        value = `TVL ${Number(t.tvl).toFixed(2)}`
      }
      items.push({ label, value, kind: 'token' })
    }
    tickerItems.value = items.length ? items : [{ label: 'CASHSCAN', value: 'connecting to indexer…', kind: 'bch' }]
  } catch {
    tickerItems.value = [{ label: 'CASHSCAN', value: 'market feed unavailable', kind: 'bch' }]
  }
}

onMounted(() => {
  refreshTicker()
  pollTimer = setInterval(refreshTicker, 45_000)
})
onUnmounted(() => clearInterval(pollTimer))
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <img class="brand-mark" :src="APP.logoUrl" alt="Bitcoin Cash" />
      <div>
        <div class="brand-name">{{ APP.name.toUpperCase() }}</div>
        <div class="brand-tag">BCH + CASHTOKENS</div>
      </div>
    </div>
    <a v-if="APP.repositoryUrl" class="repository-link" :href="APP.repositoryUrl" target="_blank" rel="noopener" aria-label="Open CashScan repository on GitHub">
      GitHub <span aria-hidden="true">↗</span>
    </a>
  </header>

  <div class="ticker" role="status" aria-label="Live market ticker">
    <div class="ticker-track">
      <span v-for="(item, i) in [...tickerItems, ...tickerItems]" :key="i" class="ticker-item">
        <span class="ticker-label">{{ item.label }}</span>
        <span :class="['ticker-value', item.kind]">{{ item.value }}</span>
      </span>
    </div>
  </div>

  <main>
    <router-view />
  </main>

  <BottomNav />
</template>

<style scoped>
.topbar {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 16px 10px;
  background: rgba(6, 9, 10, 0.96);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand-mark {
  width: 34px;
  height: 34px;
  display: block;
  filter: drop-shadow(0 0 10px rgba(22, 214, 140, 0.28));
}
.brand-name {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.02em;
}
.brand-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  color: var(--text-dim);
}
.repository-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-dim);
  font-family: var(--font-mono);
  font-size: 11px;
  white-space: nowrap;
}
.repository-link:hover { color: var(--bch); }

.ticker {
  overflow: hidden;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  white-space: nowrap;
  position: relative;
}
.ticker::after {
  content: '';
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0px, transparent 1px, transparent 2px);
  pointer-events: none;
}
.ticker-track {
  display: inline-flex;
  animation: scroll-left 28s linear infinite;
  padding: 8px 0;
}
@keyframes scroll-left {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
.ticker-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 0 18px;
  border-right: 1px solid var(--border);
}
.ticker-label { color: var(--text-dim); letter-spacing: 0.06em; }
.ticker-value.bch { color: var(--bch); }
.ticker-value.token { color: var(--text); }
</style>
