<script setup>
import { ref, reactive, watch, onMounted } from 'vue'
import { getTokens, searchTokens, searchTokensByVolume, getTokenTVL } from '../services/cauldron.js'
import { getNormalizedMetadata } from '../services/bcmr.js'
import TokenCard from '../components/TokenCard.vue'
import SkeletonLoader from '../components/SkeletonLoader.vue'

const PAGE_SIZE = 20

const query = ref('')
const sortBy = ref('tvl')
const filter = ref('all')
const tokens = ref([])
const tokenMetadata = ref({}) // Cache for token metadata
const state = reactive({ loading: true, enriching: false, error: false, hasMore: true, offset: 0 })
let debounce = null
let loadVersion = 0

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'volume', label: 'High Volume' },
  { key: 'tvl', label: 'High TVL' },
  { key: 'recent', label: 'Recently Active' }
]
const SORTS = [
  { key: 'tvl', label: 'TVL' },
  { key: 'volume', label: 'Volume' },
  { key: 'name', label: 'Name' },
  { key: 'symbol', label: 'Symbol' }
]

async function enrichTokensWithMetadata(tokenList, version) {
  // Fetch BCMR metadata for tokens that don't have it cached
  const promises = tokenList.map(async (token) => {
    if (!tokenMetadata.value[token.token_id]) {
      try {
        tokenMetadata.value[token.token_id] = await getNormalizedMetadata(token.token_id)
      } catch {
        tokenMetadata.value[token.token_id] = { found: false }
      }
    }
    // Fetch TVL if not already present
    if (!token.tvl) {
      try {
        const tvlData = await getTokenTVL(token.token_id)
        // TVL endpoint returns satoshis (total liquidity in satoshis)
        // This represents the BCH portion of the liquidity pools
        token.tvl = tvlData?.satoshis ? tvlData.satoshis / 1e8 : null
      } catch {
        token.tvl = null
      }
    }
    return token
  })
  await Promise.all(promises)
  if (version === loadVersion) state.enriching = false
}

async function load({ reset = false } = {}) {
  const version = ++loadVersion
  if (reset) {
    state.offset = 0
    tokens.value = []
    state.hasMore = true
  }
  state.loading = true
  state.enriching = false
  state.error = false
  try {
    let results
    if (filter.value === 'volume' && query.value) {
      results = await searchTokensByVolume(query.value)
    } else {
      const by = filter.value === 'all' ? sortBy.value : filter.value === 'recent' ? 'volume' : filter.value
      results = query.value
        ? await searchTokens(query.value, { limit: PAGE_SIZE, offset: state.offset, by, order: 'desc' })
        : await getTokens({ limit: PAGE_SIZE, offset: state.offset, by, order: 'desc' })
    }
    results = results || []
    if (version !== loadVersion) return
    tokens.value = reset ? results : [...tokens.value, ...results]
    state.hasMore = results.length === PAGE_SIZE
    state.offset += results.length
    state.enriching = results.length > 0
    // Metadata and TVL make cards richer, but the indexer's initial results
    // are enough to render a useful search list immediately.
    void enrichTokensWithMetadata(results, version)
  } catch {
    if (version === loadVersion) state.error = true
  } finally {
    if (version === loadVersion) state.loading = false
  }
}

watch([query, sortBy, filter], () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => load({ reset: true }), 180)
})

onMounted(() => load({ reset: true }))
</script>

<template>
  <div class="page">
    <h2 style="margin-bottom: 14px;">CashToken Explorer</h2>

    <input type="text" v-model="query" placeholder="Search by name, symbol or category…" class="search-input" />

    <div class="chip-row">
      <button v-for="f in FILTERS" :key="f.key" :class="['chip', { active: filter === f.key }]" @click="filter = f.key">
        {{ f.label }}
      </button>
    </div>

    <div class="sort-row">
      <span class="label">Sort</span>
      <select v-model="sortBy">
        <option v-for="s in SORTS" :key="s.key" :value="s.key">{{ s.label }}</option>
      </select>
    </div>

    <div class="section">
      <div v-if="state.enriching && tokens.length" class="refreshing">Updating token details…</div>
      <template v-if="state.loading && !tokens.length">
        <SkeletonLoader height="64px" rows="5" />
      </template>
      <template v-else-if="state.error && !tokens.length">
        <div class="empty-state">
          <p>Unable to reach the token indexer.</p>
          <button class="btn btn-secondary" @click="load({ reset: true })">Retry</button>
        </div>
      </template>
      <template v-else-if="!tokens.length">
        <div class="empty-state"><p>No tokens match your search.</p></div>
      </template>
      <template v-else>
        <TokenCard v-for="t in tokens" :key="t.token_id" :token="t" :metadata="tokenMetadata[t.token_id]" />
        <button v-if="state.hasMore" class="btn btn-ghost" style="margin-top: 12px;" :disabled="state.loading" @click="load()">
          {{ state.loading ? 'Loading…' : 'Load more' }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.search-input { margin-bottom: 12px; }
.chip-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; -webkit-overflow-scrolling: touch; }
.chip {
  flex-shrink: 0;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-dim);
  font-size: 12px;
  font-family: var(--font-mono);
}
.chip.active { border-color: var(--bch); color: var(--bch); }
.sort-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; }
.sort-row select { width: auto; min-height: 38px; padding: 8px 10px; }
.refreshing { margin: 0 0 8px; color: var(--text-dim); font-family: var(--font-mono); font-size: 11px; }
</style>
