<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  getTokenPrice, getTokenCandles, getTokenVolume, getTokenTVL,
  getFirstPool, getLatestTransactions, getBchPrice, getActivePools
} from '../services/cauldron.js'
import { getNormalizedMetadata } from '../services/bcmr.js'
import { getTokenChainInsights } from '../services/chaingraph.js'
import { priceToSatsPerWholeToken } from '../utils/token.js'
import { isWatched, toggleWatch } from '../utils/storage.js'
import { CAULDRON_APP_URL, BCH_EXPLORER_BASE } from '../config.js'
import SkeletonLoader from '../components/SkeletonLoader.vue'

const props = defineProps({ category: { type: String, required: true } })
const route = useRoute()

const meta = ref({ loading: true, data: null })
const priceInfo = reactive({ loading: true, error: false, satsPerToken: null, priceChange: null })
const candles = ref({ loading: true, error: false, points: [] })
const stats = reactive({ loading: true, error: false, tvlBch: null, tvlToken: null, volumeBch: null, txCount: null })
const firstPool = ref({ loading: true, data: null })
const pools = ref({ loading: true, data: [] })
const activity = ref({ loading: true, error: false, items: [] })
const range = ref('1D')
const watched = ref(isWatched(props.category))
const iconFailed = ref(false)
const chain = ref({ loading: true, error: false, data: null })

const RANGES = { '1H': 3600, '1D': 86400, '1W': 604800, '1M': 2592000, ALL: 31536000 }

async function loadMeta() {
  meta.value = { loading: true, data: null }
  try {
    meta.value = { loading: false, data: await getNormalizedMetadata(props.category) }
  } catch {
    meta.value = { loading: false, data: null }
  }
}

async function loadPrice() {
  priceInfo.loading = true
  priceInfo.error = false
  try {
    const [current, bch] = await Promise.all([getTokenPrice(props.category), getBchPrice()])
    const decimals = meta.value.data?.decimals ?? 0
    const satsPerToken = current?.price ? priceToSatsPerWholeToken(current.price, decimals) : null
    priceInfo.satsPerToken = satsPerToken
    priceInfo.usd = satsPerToken && bch ? (satsPerToken / 1e8) * bch.usd : null
  } catch {
    priceInfo.error = true
  } finally {
    priceInfo.loading = false
  }
}

async function loadCandles() {
  candles.value = { loading: true, error: false, points: [] }
  try {
    const seconds = RANGES[range.value]
    const end = Math.floor(Date.now() / 1000)
    const start = end - seconds
    const stepsize = Math.max(300, Math.floor(seconds / 80))
    const data = await getTokenCandles(props.category, { start, end, stepsize })
    const points = (data?.candlesticks || []).map((c) => c.close)
    candles.value = { loading: false, error: false, points }
    if (points.length >= 2) {
      const change = ((points[points.length - 1] - points[0]) / points[0]) * 100
      priceInfo.priceChange = change
    }
  } catch {
    candles.value = { loading: false, error: true, points: [] }
  }
}

async function loadStats() {
  stats.loading = true
  stats.error = false
  stats.tvlBch = null
  stats.tvlToken = null
  stats.volumeBch = null
  try {
    const [volumeResult, tvlResult] = await Promise.allSettled([
      getTokenVolume(props.category),
      getTokenTVL(props.category)
    ])
    const volume = volumeResult.status === 'fulfilled' ? volumeResult.value : null
    const tvl = tvlResult.status === 'fulfilled' ? tvlResult.value : null
    const volumeSats = Number(volume?.volume_sats)
    const tvlSats = Number(tvl?.satoshis)

    stats.volumeBch = Number.isFinite(volumeSats) ? volumeSats / 1e8 : null
    if (Number.isFinite(tvlSats)) {
      stats.tvlBch = tvl.satoshis / 1e8
      const decimals = meta.value.data?.decimals ?? 0
      const tokenAmount = Number(tvl.token_amount)
      stats.tvlToken = Number.isFinite(tokenAmount) ? tokenAmount / Math.pow(10, decimals) : null
    }
    stats.error = volumeResult.status === 'rejected' && tvlResult.status === 'rejected'
  } catch {
    stats.error = true
  } finally {
    stats.loading = false
  }
}

async function loadFirstPool() {
  firstPool.value = { loading: true, data: null }
  try {
    firstPool.value = { loading: false, data: await getFirstPool(props.category) }
  } catch {
    firstPool.value = { loading: false, data: null }
  }
}

async function loadPools() {
  pools.value = { loading: true, data: [] }
  try {
    // BCH pools are keyed by the token's own category vs the "BCH" pseudo-token —
    // the indexer treats the native asset as one side of every pair implicitly,
    // so we query with the token id on both sides and let the API resolve it.
    const data = await getActivePools(props.category, props.category)
    pools.value = { loading: false, data: Array.isArray(data) ? data : (data?.pools || []) }
  } catch {
    pools.value = { loading: false, data: [] }
  }
}

async function loadActivity() {
  activity.value = { loading: true, error: false, items: [] }
  try {
    const tx = await getLatestTransactions({ token: props.category, limit: 8 })
    activity.value = { loading: false, error: false, items: tx || [] }
  } catch {
    activity.value = { loading: false, error: true, items: [] }
  }
}

async function loadChainInsights() {
  chain.value = { loading: true, error: false, data: null }
  try {
    chain.value = { loading: false, error: false, data: await getTokenChainInsights(props.category) }
  } catch {
    chain.value = { loading: false, error: true, data: null }
  }
}

async function loadAll() {
  await loadMeta()
  loadPrice()
  loadCandles()
  loadStats()
  loadFirstPool()
  loadPools()
  loadActivity()
  loadChainInsights()
}

onMounted(loadAll)
watch(range, loadCandles)
watch(() => props.category, () => { watched.value = isWatched(props.category); loadAll() })
watch(() => meta.value.data?.icon, () => { iconFailed.value = false })

function toggleWatchlist() {
  toggleWatch(props.category)
  watched.value = isWatched(props.category)
}

function copyCategory() {
  navigator.clipboard?.writeText(props.category).catch(() => {})
}

const sparkPath = computed(() => {
  const pts = candles.value.points
  if (pts.length < 2) return ''
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const w = 300, h = 80
  return pts
    .map((p, i) => {
      const x = (i / (pts.length - 1)) * w
      const y = h - ((p - min) / span) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

// Converter widget
const convertAmount = ref('')
const convertDirection = ref('token') // 'token' -> bch/usd, or 'bch' -> token
const convertedBch = computed(() => {
  if (!convertAmount.value || !priceInfo.satsPerToken) return null
  const n = Number(convertAmount.value)
  if (convertDirection.value === 'token') return (n * priceInfo.satsPerToken) / 1e8
  return (n * 1e8) / priceInfo.satsPerToken
})

const formatTVL = computed(() => {
  if (stats.tvlBch === null) return '—'
  const bch = stats.tvlBch.toFixed(4) + ' BCH'
  if (stats.tvlToken === null) return bch
  const symbol = meta.value.data?.symbol || 'TOKEN'
  const token = stats.tvlToken.toFixed(4) + ' ' + symbol
  return bch + ' + ' + token
})

function formatTokenAmount(value) {
  if (value === null || value === undefined) return '—'
  const decimals = meta.value.data?.decimals ?? 0
  const digits = String(value).padStart(decimals + 1, '0')
  if (!decimals) return Number(digits).toLocaleString('en-US')
  const whole = digits.slice(0, -decimals).replace(/^0+(?=\d)/, '')
  const fraction = digits.slice(-decimals).replace(/0+$/, '')
  return `${Number(whole).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''}`
}
</script>

<template>
  <div class="page">
    <div class="header-row">
      <div class="icon-slot">
        <img v-if="meta.data?.icon && !iconFailed" :src="meta.data.icon" :alt="meta.data?.symbol || 'Token'" @error="iconFailed = true" />
        <span v-else class="icon-fallback">{{ (meta.data?.symbol || meta.data?.name || '?').slice(0, 3).toUpperCase() }}</span>
      </div>
      <div class="header-text">
        <h2>{{ meta.loading ? 'Loading…' : (meta.data?.name || 'Unknown token') }}</h2>
        <div class="mono muted">{{ meta.data?.symbol || '—' }}</div>
      </div>
      <button class="watch-btn" :class="{ active: watched }" @click="toggleWatchlist">{{ watched ? '★' : '☆' }}</button>
    </div>

    <div class="price-block">
      <SkeletonLoader v-if="priceInfo.loading" height="30px" width="140px" />
      <template v-else-if="priceInfo.usd">
        <div class="price">${{ priceInfo.usd.toFixed(6) }}</div>
        <div v-if="priceInfo.priceChange !== null" :class="['change', priceInfo.priceChange >= 0 ? 'up' : 'down']">
          {{ priceInfo.priceChange >= 0 ? '+' : '' }}{{ priceInfo.priceChange.toFixed(2) }}%
        </div>
      </template>
      <div v-else class="muted">Price unavailable</div>
    </div>

    <div class="range-row">
      <button v-for="r in Object.keys(RANGES)" :key="r" :class="['range-btn', { active: range === r }]" @click="range = r">{{ r }}</button>
    </div>

    <div class="chart-card">
      <SkeletonLoader v-if="candles.loading" height="80px" />
      <div v-else-if="candles.error || !candles.points.length" class="empty-inline">No trade history for this range.</div>
      <svg v-else viewBox="0 0 300 80" class="spark">
        <path :d="sparkPath" fill="none" stroke="var(--bch)" stroke-width="2" />
      </svg>
    </div>

    <div class="section">
      <div class="section-title">Token Information</div>
      <div class="card">
        <div class="card-row">
          <span class="label">Category</span>
          <button class="value mono link-btn" @click="copyCategory">{{ category.slice(0, 14) }}…</button>
        </div>
        <div class="card-row">
          <span class="label">Decimals</span>
          <span class="value">{{ meta.data?.decimals ?? '—' }}</span>
        </div>
        <div class="card-row">
          <span class="label">Market Activity (TVL)</span>
          <span class="value">{{ formatTVL }}</span>
        </div>
        <div class="card-row">
          <span class="label">Trading Volume</span>
          <span class="value">{{ stats.volumeBch !== null ? stats.volumeBch.toFixed(4) + ' BCH' : '—' }}</span>
        </div>
        <div class="card-row" v-if="firstPool.data">
          <span class="label">First pool</span>
          <span class="value">{{ new Date(firstPool.data.timestamp * 1000).toLocaleDateString() }}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Supply & Holders</div>
      <div class="card">
        <SkeletonLoader v-if="chain.loading" height="16px" rows="5" />
        <template v-else-if="chain.data">
          <div class="card-row"><span class="label">Current unspent supply</span><span class="value">{{ formatTokenAmount(chain.data.circulatingSupply) }}</span></div>
          <div class="card-row"><span class="label">User addresses holding</span><span class="value">{{ chain.data.userHolders.toLocaleString() }}</span></div>
          <div class="card-row"><span class="label">Smart-contract addresses</span><span class="value">{{ chain.data.contractHolders.toLocaleString() }}</span></div>
          <div class="card-row"><span class="label">Total holding addresses</span><span class="value">{{ chain.data.totalHolders.toLocaleString() }}</span></div>
          <div class="card-row"><span class="label">On user addresses</span><span class="value">{{ formatTokenAmount(chain.data.userSupply) }}</span></div>
          <div class="card-row"><span class="label">On smart contracts</span><span class="value">{{ formatTokenAmount(chain.data.contractSupply) }}</span></div>
          <p class="chain-note" :class="{ warning: chain.data.truncated }">{{ chain.data.truncated ? 'Only the first 5,000 indexed unspent outputs were included.' : 'Live unspent-output view from Chaingraph.' }}</p>
        </template>
        <div v-else class="empty-inline">Chain supply data is unavailable. <button class="btn-link" @click="loadChainInsights">Retry</button></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Authchain & Metadata</div>
      <div class="card">
        <div class="card-row"><span class="label">Genesis transaction</span><a class="value mono" :href="`${BCH_EXPLORER_BASE}/tx/${category}`" target="_blank" rel="noopener">{{ category.slice(0, 12) }}…</a></div>
        <template v-if="chain.data?.authchain">
          <div class="card-row"><span class="label">Authchain length</span><span class="value">{{ chain.data.authchain.length }}</span></div>
          <div class="card-row" v-if="chain.data.authchain.authhead"><span class="label">Authhead</span><a class="value mono" :href="`${BCH_EXPLORER_BASE}/tx/${chain.data.authchain.authhead}`" target="_blank" rel="noopener">{{ chain.data.authchain.authhead.slice(0, 12) }}…</a></div>
          <div v-if="chain.data.authchain.migrations.length" class="authchain-list">
            <span class="label">Metadata updates</span>
            <a v-for="entry in chain.data.authchain.migrations" :key="entry.txid" :href="`${BCH_EXPLORER_BASE}/tx/${entry.txid}`" target="_blank" rel="noopener" class="authchain-link">#{{ entry.index + 1 }} · {{ entry.txid.slice(0, 16) }}…</a>
          </div>
        </template>
        <div v-else-if="!chain.loading" class="empty-inline">No indexed authchain was found for this token.</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Metadata</div>
      <div class="card">
        <template v-if="meta.data?.found">
          <div class="badge-good">✓ BCMR metadata found</div>
          <p v-if="meta.data.description" class="description">{{ meta.data.description }}</p>
          <a v-if="meta.data.website" :href="meta.data.website" target="_blank" rel="noopener" class="value">{{ meta.data.website }} ↗</a>
        </template>
        <template v-else-if="!meta.loading">
          <div class="badge-warn">⚠ No BCMR metadata found</div>
        </template>
        <SkeletonLoader v-else height="16px" rows="2" />
      </div>
    </div>

    <div class="section">
      <div class="section-title">Convert</div>
      <div class="card">
        <div class="convert-row">
          <input type="text" inputmode="decimal" v-model="convertAmount" placeholder="Amount" />
          <select v-model="convertDirection">
            <option value="token">{{ meta.data?.symbol || 'TOKEN' }} → BCH</option>
            <option value="bch">BCH → {{ meta.data?.symbol || 'TOKEN' }}</option>
          </select>
        </div>
        <div v-if="convertedBch !== null" class="convert-result mono">
          = {{ convertedBch.toFixed(8) }} {{ convertDirection === 'token' ? 'BCH' : (meta.data?.symbol || 'TOKEN') }}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Recent Activity</div>
      <template v-if="activity.loading"><SkeletonLoader rows="3" height="18px" /></template>
      <template v-else-if="activity.error || !activity.items.length">
        <div class="empty-inline">No recent transaction activity indexed.</div>
      </template>
      <div v-else class="card">
        <a v-for="tx in activity.items" :key="tx.txid" :href="`${BCH_EXPLORER_BASE}/tx/${tx.txid}`" target="_blank" rel="noopener" class="activity-link">
          <span class="value mono">{{ tx.txid.slice(0, 12) }}…</span>
          <span class="label">View transaction ↗</span>
        </a>
      </div>
    </div>

    <div class="section btn-row">
      <a class="btn btn-primary" :href="`${CAULDRON_APP_URL}/swap/${category}`" target="_blank" rel="noopener">Trade on Cauldron</a>
      <a class="btn btn-secondary" :href="`${BCH_EXPLORER_BASE}/token/${category}`" target="_blank" rel="noopener">View on Explorer</a>
    </div>
  </div>
</template>

<style scoped>
.header-row { display: flex; align-items: center; gap: 12px; }
.icon-slot { width: 48px; height: 48px; border-radius: 12px; background: var(--surface); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.icon-slot img { width: 100%; height: 100%; object-fit: cover; }
.header-text { flex: 1; }
.watch-btn { background: none; border: none; font-size: 24px; color: var(--text-dim); }
.watch-btn.active { color: var(--amber); }
.price-block { margin-top: 14px; }
.price { font-family: var(--font-display); font-size: 28px; font-weight: 700; }
.change.up { color: var(--bch); }
.change.down { color: var(--red); }
.range-row { display: flex; gap: 6px; margin-top: 14px; }
.range-btn { flex: 1; padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface); color: var(--text-dim); font-size: 12px; font-family: var(--font-mono); }
.range-btn.active { color: var(--bch); border-color: var(--bch); }
.chart-card { margin-top: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px; }
.spark { width: 100%; height: 80px; display: block; }
.link-btn { background: none; border: none; color: var(--bch); cursor: pointer; }
.description { font-size: 13px; color: var(--text); margin: 8px 0; }
.badge-good { color: var(--bch); font-family: var(--font-mono); font-size: 13px; }
.badge-warn { color: var(--amber); font-family: var(--font-mono); font-size: 13px; }
.convert-row { display: flex; gap: 8px; }
.convert-result { margin-top: 10px; color: var(--bch); }
.empty-inline { color: var(--text-dim); font-size: 13px; padding: 8px 0; }
.activity-link { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); color: var(--text); text-decoration: none; transition: background-color 0.15s ease; }
.activity-link:last-child { border-bottom: none; }
.activity-link:hover { background-color: var(--surface-raised); }
.muted { color: var(--text-dim); }
.chain-note { margin: 12px 0 0; color: var(--text-dim); font-size: 11px; line-height: 1.4; }
.chain-note.warning { color: var(--amber); }
.authchain-list { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
.authchain-link { font-family: var(--font-mono); font-size: 12px; overflow-wrap: anywhere; }
</style>
