<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  getTokenPrice, getTokenCandles, getTokenVolume, getTokenTVL,
  getFirstPool, getLatestTransactions, getBchPrice, getActivePools
} from '../services/cauldron.js'
import { getNormalizedMetadata } from '../services/bcmr.js'
import { getTokenChainInsights } from '../services/chaingraph.js'
import { getTokenCommunityNotes } from '../services/nostr.js'
import { priceToSatsPerWholeToken } from '../utils/token.js'
import { getSettings, isWatched, toggleWatch } from '../utils/storage.js'
import { BCH_NOSTR_URL, CAULDRON_APP_URL, BCH_EXPLORER_BASE } from '../config.js'
import SkeletonLoader from '../components/SkeletonLoader.vue'

const props = defineProps({ category: { type: String, required: true } })
const route = useRoute()

const meta = ref({ loading: true, data: null })
const priceInfo = reactive({ loading: true, error: false, satsPerToken: null, priceChange: null })
const candles = ref({ loading: true, error: false, items: [] })
const stats = reactive({ loading: true, error: false, tvlBch: null, tvlToken: null, volumeBch: null, txCount: null })
const firstPool = ref({ loading: true, data: null })
const pools = ref({ loading: true, data: [] })
const activity = ref({ loading: true, error: false, items: [] })
const range = ref('1D')
const watched = ref(isWatched(props.category))
const iconFailed = ref(false)
const chain = ref({ loading: true, error: false, data: null })
const chartMode = ref('candle')
const showSma7 = ref(false)
const showSma21 = ref(false)
const selectedCandle = ref(null)
const chartRef = ref(null)
const categoryCopied = ref(false)
const community = ref({ loading: true, error: false, notes: [], source: null, candidateCount: 0, relatedCount: 0, filteredCount: 0 })
const communityEnabled = ref(getSettings().communityEnabled)

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
  candles.value = { loading: true, error: false, items: [] }
  selectedCandle.value = null
  try {
    const seconds = RANGES[range.value]
    const end = Math.floor(Date.now() / 1000)
    const start = end - seconds
    const stepsize = Math.max(300, Math.floor(seconds / 80))
    const data = await getTokenCandles(props.category, { start, end, stepsize })
    const items = (data?.candlesticks || []).map((c) => ({
      open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close),
      time: Number(c.time), volumeSats: Number(c.volume_sats || 0), transactions: Number(c.transaction_count || 0)
    })).filter((c) => [c.open, c.high, c.low, c.close].every(Number.isFinite))
    candles.value = { loading: false, error: false, items }
    if (items.length >= 2) {
      const change = ((items[items.length - 1].close - items[0].close) / items[0].close) * 100
      priceInfo.priceChange = change
    }
  } catch {
    candles.value = { loading: false, error: true, items: [] }
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

async function loadCommunity() {
  if (!communityEnabled.value) {
    community.value = { loading: false, error: false, notes: [], source: null, candidateCount: 0, relatedCount: 0, filteredCount: 0 }
    return
  }
  community.value = { loading: true, error: false, notes: [], source: null, candidateCount: 0, relatedCount: 0, filteredCount: 0 }
  try {
    const result = await getTokenCommunityNotes(props.category, meta.value.data?.symbol)
    community.value = { loading: false, error: false, ...result }
  } catch {
    community.value = { loading: false, error: true, notes: [], source: null, candidateCount: 0, relatedCount: 0, filteredCount: 0 }
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
  loadCommunity()
}

onMounted(loadAll)
watch(range, loadCandles)
watch(() => props.category, () => { watched.value = isWatched(props.category); categoryCopied.value = false; loadAll() })
watch(() => meta.value.data?.icon, () => { iconFailed.value = false })

function toggleWatchlist() {
  toggleWatch(props.category)
  watched.value = isWatched(props.category)
}

function scrollToSection(sectionId) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function copyCategory() {
  if (!navigator.clipboard) return
  try {
    await navigator.clipboard.writeText(props.category)
    categoryCopied.value = true
    setTimeout(() => { categoryCopied.value = false }, 1600)
  } catch {
    categoryCopied.value = false
  }
}

const sparkPath = computed(() => {
  const pts = candles.value.items.map((c) => c.close)
  const metrics = chartMetrics.value
  if (pts.length < 2 || !metrics) return ''
  return pts
    .map((p, i) => {
      const x = metrics.xFor(i)
      const y = metrics.yFor(p)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

function movingAverage(period) {
  return candles.value.items.map((candle, index, items) => {
    if (index < period - 1) return null
    const closes = items.slice(index - period + 1, index + 1).map((item) => item.close)
    return closes.reduce((total, close) => total + close, 0) / period
  })
}

const chartMetrics = computed(() => {
  const items = candles.value.items
  if (!items.length) return null
  const ma7 = movingAverage(7)
  const ma21 = movingAverage(21)
  const values = items.flatMap((item) => [item.low, item.high])
  for (const value of [...ma7, ...ma21]) if (value !== null) values.push(value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || Math.max(max * 0.01, 1)
  const width = 420
  const height = 150
  const padding = 4
  const xFor = (index) => padding + ((width - padding * 2) * index) / Math.max(items.length - 1, 1)
  const yFor = (value) => height - padding - ((value - min) / span) * (height - padding * 2)
  const linePath = (valuesToDraw) => valuesToDraw.map((value, index) => value === null ? '' : `${index === 0 || valuesToDraw[index - 1] === null ? 'M' : 'L'}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`).join(' ')
  return { width, height, xFor, yFor, candleWidth: Math.max(2, Math.min(10, ((width - padding * 2) / items.length) * 0.62)), ma7, ma21, linePath, min, max }
})

function selectCandle(event) {
  const metrics = chartMetrics.value
  const items = candles.value.items
  const bounds = chartRef.value?.getBoundingClientRect()
  if (!metrics || !bounds || !items.length) return
  const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width))
  const index = Math.round(ratio * (items.length - 1))
  selectedCandle.value = items[index]
}

function formatChartValue(value) {
  if (!Number.isFinite(value)) return '—'
  return value >= 1 ? value.toFixed(4) : value.toPrecision(5)
}

function formatCandleTime(timestamp) {
  return new Date(timestamp * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

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

function relativeTime(timestamp) {
  if (!timestamp) return 'Time unavailable'
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - Number(timestamp)))
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
  return `${Math.floor(seconds / 86400)} days ago`
}

function notePreview(content) {
  const normalized = (content || '').replace(/\s+/g, ' ').trim()
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized
}

function bchNostrNoteUrl(noteId) {
  return `${BCH_NOSTR_URL.replace(/\/$/, '')}/note/${noteId}`
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
      <div class="chart-toolbar">
        <div class="chart-mode" role="group" aria-label="Chart type">
          <button type="button" :class="{ active: chartMode === 'candle' }" @click="chartMode = 'candle'">Candles</button>
          <button type="button" :class="{ active: chartMode === 'line' }" @click="chartMode = 'line'">Line</button>
        </div>
        <div class="indicator-tools" aria-label="Chart indicators">
          <button type="button" :class="{ active: showSma7 }" @click="showSma7 = !showSma7">SMA 7</button>
          <button type="button" :class="{ active: showSma21 }" @click="showSma21 = !showSma21">SMA 21</button>
        </div>
      </div>
      <SkeletonLoader v-if="candles.loading" height="150px" />
      <div v-else-if="candles.error || !candles.items.length" class="empty-inline">No trade history for this range.</div>
      <template v-else-if="chartMetrics">
        <svg ref="chartRef" :viewBox="`0 0 ${chartMetrics.width} ${chartMetrics.height}`" preserveAspectRatio="none" class="spark" role="img" aria-label="Interactive token price chart" @mousemove="selectCandle" @mouseleave="selectedCandle = null">
          <line v-for="level in 4" :key="level" x1="4" :x2="chartMetrics.width - 4" :y1="(chartMetrics.height / 5) * level" :y2="(chartMetrics.height / 5) * level" class="chart-grid" />
          <template v-if="chartMode === 'candle'">
            <g v-for="(candle, index) in candles.items" :key="candle.time">
              <line :x1="chartMetrics.xFor(index)" :x2="chartMetrics.xFor(index)" :y1="chartMetrics.yFor(candle.high)" :y2="chartMetrics.yFor(candle.low)" :class="candle.close >= candle.open ? 'candle-up' : 'candle-down'" />
              <rect :x="chartMetrics.xFor(index) - chartMetrics.candleWidth / 2" :y="chartMetrics.yFor(Math.max(candle.open, candle.close))" :width="chartMetrics.candleWidth" :height="Math.max(1, Math.abs(chartMetrics.yFor(candle.open) - chartMetrics.yFor(candle.close)))" :class="candle.close >= candle.open ? 'candle-up' : 'candle-down'" />
            </g>
          </template>
          <path v-else :d="sparkPath" class="price-line" />
          <path v-if="showSma7" :d="chartMetrics.linePath(chartMetrics.ma7)" class="sma-seven" />
          <path v-if="showSma21" :d="chartMetrics.linePath(chartMetrics.ma21)" class="sma-twenty-one" />
          <line v-if="selectedCandle" :x1="chartMetrics.xFor(candles.items.indexOf(selectedCandle))" :x2="chartMetrics.xFor(candles.items.indexOf(selectedCandle))" y1="4" :y2="chartMetrics.height - 4" class="chart-cursor" />
        </svg>
        <div class="chart-readout">
          <template v-if="selectedCandle">
            <span>{{ formatCandleTime(selectedCandle.time) }}</span>
            <span>O {{ formatChartValue(selectedCandle.open) }}</span><span>H {{ formatChartValue(selectedCandle.high) }}</span><span>L {{ formatChartValue(selectedCandle.low) }}</span><span>C {{ formatChartValue(selectedCandle.close) }}</span>
            <span>{{ selectedCandle.transactions }} tx</span>
          </template>
          <template v-else><span>Hover the chart for OHLC and transaction details.</span><span>Range {{ formatChartValue(chartMetrics.min) }}–{{ formatChartValue(chartMetrics.max) }}</span></template>
        </div>
      </template>
    </div>

    <nav class="token-section-nav" aria-label="Token detail sections">
      <button type="button" @click="scrollToSection('token-convert')">Convert</button>
      <button type="button" @click="scrollToSection('token-information')">Info</button>
      <button type="button" @click="scrollToSection('token-supply')">Supply</button>
      <button type="button" @click="scrollToSection('token-authchain')">Authchain</button>
      <button type="button" @click="scrollToSection('token-metadata')">Metadata</button>
      <button v-if="communityEnabled" type="button" @click="scrollToSection('token-community')">Community</button>
      <button type="button" @click="scrollToSection('token-activity')">Activity</button>
    </nav>

    <div id="token-convert" class="section token-section-anchor">
      <div class="section-title">Convert</div>
      <div class="card">
        <div class="convert-row">
          <input type="text" inputmode="decimal" v-model="convertAmount" placeholder="Amount" />
          <div class="direction-switch" role="group" aria-label="Conversion direction">
            <button type="button" :class="{ active: convertDirection === 'token' }" @click="convertDirection = 'token'">{{ meta.data?.symbol || 'TOKEN' }} → BCH</button>
            <button type="button" :class="{ active: convertDirection === 'bch' }" @click="convertDirection = 'bch'">BCH → {{ meta.data?.symbol || 'TOKEN' }}</button>
          </div>
        </div>
        <div v-if="convertedBch !== null" class="convert-result mono">
          = {{ convertedBch.toFixed(8) }} {{ convertDirection === 'token' ? 'BCH' : (meta.data?.symbol || 'TOKEN') }}
        </div>
      </div>
    </div>

    <div id="token-information" class="section token-section-anchor">
      <div class="section-title">Token Information</div>
      <div class="card">
        <div class="card-row">
          <span class="label">Category</span>
          <button class="value mono link-btn category-copy" :title="categoryCopied ? 'Category copied' : 'Copy full token category'" :aria-label="categoryCopied ? 'Token category copied' : 'Copy full token category'" @click="copyCategory">
            {{ categoryCopied ? 'Copied' : `${category.slice(0, 14)}…` }}
          </button>
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

    <div id="token-supply" class="section token-section-anchor">
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

    <div id="token-authchain" class="section token-section-anchor">
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

    <div id="token-metadata" class="section token-section-anchor">
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

    <div v-if="communityEnabled" id="token-community" class="section token-section-anchor">
      <div class="section-title section-title-row"><span>Community</span><a :href="BCH_NOSTR_URL" target="_blank" rel="noopener">BCH Nostr ↗</a></div>
      <div class="card community-card">
        <SkeletonLoader v-if="community.loading" rows="2" height="18px" />
        <template v-else-if="community.notes.length">
          <article v-for="note in community.notes" :key="note.id" class="community-note">
            <p>{{ notePreview(note.content) }}</p>
            <div class="community-note-meta">
              <span>{{ relativeTime(note.createdAt) }}</span>
              <a :href="bchNostrNoteUrl(note.id)" target="_blank" rel="noopener">Open note ↗</a>
            </div>
          </article>
        </template>
        <div v-else-if="community.error" class="empty-inline">Community notes could not be reached. <button class="btn-link" @click="loadCommunity">Retry</button></div>
        <div v-else class="empty-inline">
          <template v-if="community.filteredCount">{{ community.filteredCount }} matching note{{ community.filteredCount === 1 ? '' : 's' }} were hidden by filters.</template>
          <template v-else-if="community.candidateCount">No recent Nostr notes explicitly mention this token.</template>
          <template v-else>No configured relay returned recent notes. Try again later or update the relay list.</template>
        </div>
      </div>
    </div>

    <div id="token-activity" class="section token-section-anchor">
      <div class="section-title">Recent Activity</div>
      <template v-if="activity.loading"><SkeletonLoader rows="3" height="18px" /></template>
      <template v-else-if="activity.error || !activity.items.length">
        <div class="empty-inline">No recent activity for this token is currently indexed.</div>
      </template>
      <div v-else class="card">
        <div v-for="tx in activity.items" :key="tx.txid" class="activity-item">
          <span :class="['activity-dot', tx.blockhash ? 'confirmed' : 'pending']" aria-hidden="true"></span>
          <div class="activity-copy">
            <strong>Token activity recorded</strong>
            <span>{{ relativeTime(tx.timestamp_guess) }} · {{ tx.blockhash ? 'Confirmed on the BCH network' : 'Awaiting confirmation' }}</span>
          </div>
          <a :href="`${BCH_EXPLORER_BASE}/tx/${tx.txid}`" target="_blank" rel="noopener" class="activity-explorer" :aria-label="`View transaction ${tx.txid} in explorer`">Details ↗</a>
        </div>
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
.chart-toolbar { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 10px; overflow-x: auto; }
.chart-mode, .indicator-tools { display: inline-flex; flex-shrink: 0; gap: 3px; padding: 3px; border: 1px solid var(--border); border-radius: 5px; background: var(--surface-raised); }
.chart-toolbar button { min-height: 28px; border: 0; border-radius: 3px; background: transparent; color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; padding: 0 8px; }
.chart-toolbar button.active { background: var(--surface); color: var(--bch); box-shadow: inset 0 0 0 1px var(--bch-dim); }
.spark { width: 100%; height: 150px; display: block; touch-action: pan-y; }
.chart-grid { stroke: var(--border); stroke-width: 0.5; }
.candle-up { fill: var(--bch); stroke: var(--bch); stroke-width: 1; }
.candle-down { fill: var(--red); stroke: var(--red); stroke-width: 1; }
.price-line, .sma-seven, .sma-twenty-one { fill: none; stroke-width: 1.6; }
.price-line { stroke: var(--bch); }
.sma-seven { stroke: var(--amber); }
.sma-twenty-one { stroke: #82aaff; }
.chart-cursor { stroke: var(--text-dim); stroke-dasharray: 2 2; stroke-width: 0.75; }
.chart-readout { display: flex; flex-wrap: wrap; gap: 5px 10px; min-height: 32px; margin-top: 8px; color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; line-height: 1.35; }
.chart-readout span:first-child { color: var(--text); }
.token-section-nav { position: sticky; top: 63px; z-index: 20; display: flex; gap: 6px; overflow-x: auto; margin: 14px -16px 0; padding: 9px 16px; background: rgba(6, 9, 10, 0.96); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); scrollbar-width: none; }
.token-section-nav::-webkit-scrollbar { display: none; }
.token-section-nav button { flex: 0 0 auto; padding: 7px 10px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
.token-section-nav button:hover { border-color: var(--bch-dim); color: var(--bch); }
.token-section-anchor { scroll-margin-top: 116px; }
.link-btn { background: none; border: none; color: var(--bch); cursor: pointer; }
.category-copy::after { content: ' copy'; color: var(--text-dim); font-family: var(--font-body); font-size: 11px; }
.description { font-size: 13px; color: var(--text); margin: 8px 0; }
.section-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.section-title-row a { color: var(--bch); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0; text-transform: none; }
.badge-good { color: var(--bch); font-family: var(--font-mono); font-size: 13px; }
.badge-warn { color: var(--amber); font-family: var(--font-mono); font-size: 13px; }
.convert-row { display: grid; gap: 10px; }
.convert-row input { min-width: 0; }
.direction-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 3px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-raised); }
.direction-switch button { min-width: 0; min-height: 40px; border: 0; border-radius: 5px; background: transparent; color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.direction-switch button.active { background: var(--surface); box-shadow: inset 0 0 0 1px var(--bch-dim); color: var(--bch); }
.convert-result { margin-top: 10px; color: var(--bch); }
.empty-inline { color: var(--text-dim); font-size: 13px; padding: 8px 0; }
.activity-item { display: flex; align-items: center; gap: 10px; padding: 12px 0; }
.activity-item + .activity-item { border-top: 1px solid var(--border); }
.activity-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.activity-dot.confirmed { background: var(--bch); box-shadow: 0 0 8px var(--bch); }
.activity-dot.pending { background: var(--amber); box-shadow: 0 0 8px rgba(228, 167, 59, 0.35); }
.activity-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.activity-copy strong { font-family: var(--font-display); font-size: 14px; }
.activity-copy span { color: var(--text-dim); font-size: 12px; line-height: 1.35; }
.activity-explorer { flex-shrink: 0; font-family: var(--font-mono); font-size: 12px; }
.muted { color: var(--text-dim); }
.chain-note { margin: 12px 0 0; color: var(--text-dim); font-size: 11px; line-height: 1.4; }
.chain-note.warning { color: var(--amber); }
.authchain-list { display: flex; flex-direction: column; gap: 8px; padding-top: 12px; }
.authchain-link { font-family: var(--font-mono); font-size: 12px; overflow-wrap: anywhere; }
.community-card { padding: 0; overflow: hidden; }
.community-note { padding: 14px; }
.community-note + .community-note { border-top: 1px solid var(--border); }
.community-note p { margin: 0; color: var(--text); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.community-note-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 9px; color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
</style>
