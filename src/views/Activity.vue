<script setup>
import { ref, onMounted } from 'vue'
import { getLatestTransactions } from '../services/cauldron.js'
import { explorerTxUrl } from '../services/blockchain.js'
import SkeletonLoader from '../components/SkeletonLoader.vue'
import { listRequests } from '../utils/storage.js'

const state = ref({ loading: true, error: false, items: [] })
const myRequests = ref([])

function relativeTime(ts) {
  const seconds = Math.floor((Date.now() - ts * (ts > 1e12 ? 1 : 1000)) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
  return `${Math.floor(seconds / 86400)} days ago`
}

async function load() {
  state.value = { loading: true, error: false, items: [] }
  try {
    const tx = await getLatestTransactions({ limit: 25 })
    state.value = { loading: false, error: false, items: tx || [] }
  } catch {
    state.value = { loading: false, error: true, items: [] }
  }
}

onMounted(() => {
  load()
  myRequests.value = listRequests().slice(0, 5)
})
</script>

<template>
  <div class="page">
    <h2 style="margin-bottom: 14px;">Activity</h2>

    <div v-if="myRequests.length" class="section">
      <div class="section-title">Your Recent Requests</div>
      <div class="card" v-for="r in myRequests" :key="r.id">
        <div class="card-row">
          <span class="label">{{ r.description || (r.asset === 'BCH' ? 'BCH request' : r.tokenSymbol + ' request') }}</span>
          <span class="pill" :class="r.status === 'confirmed' ? 'pill-good' : r.status === 'wrong-token' ? 'pill-bad' : 'pill-pending'">
            <span class="pill-dot"></span>{{ r.status }}
          </span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Recent CashToken Activity</div>
      <template v-if="state.loading">
        <SkeletonLoader height="56px" rows="6" />
      </template>
      <template v-else-if="state.error">
        <div class="empty-state">
          <p>Unable to load activity feed.</p>
          <button class="btn btn-secondary" @click="load">Retry</button>
        </div>
      </template>
      <template v-else-if="!state.items.length">
        <div class="empty-state"><p>No recent Cauldron activity indexed.</p></div>
      </template>
      <template v-else>
        <div class="card" v-for="tx in state.items" :key="tx.txid">
          <div class="tx-row">
            <span :class="['status-dot', tx.blockhash ? 'confirmed' : 'pending']"></span>
            <div class="tx-info">
              <div class="mono">{{ tx.txid.slice(0, 16) }}…</div>
              <div class="label">Transaction activity · {{ tx.timestamp_guess ? relativeTime(tx.timestamp_guess) : (tx.blockhash ? 'confirmed' : 'pending') }}</div>
            </div>
            <a class="btn-link" :href="explorerTxUrl(tx.txid)" target="_blank" rel="noopener">View ↗</a>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tx-row { display: flex; align-items: center; gap: 10px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.status-dot.confirmed { background: var(--bch); box-shadow: 0 0 8px var(--bch); }
.status-dot.pending { background: var(--amber); }
.tx-info { flex: 1; min-width: 0; }
.btn-link { background: none; border: none; color: var(--bch); font-size: 12px; font-family: var(--font-mono); }
</style>
