<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getBchUsd, convertBchToFiat } from '../services/prices.js'
import { APP } from '../config.js'
import { getSettings, listRequests } from '../utils/storage.js'
import SkeletonLoader from '../components/SkeletonLoader.vue'

const router = useRouter()

const priceState = ref({ loading: true, error: false, data: null })
const settings = ref(getSettings())
const recentRequests = ref([])

const displayCurrency = computed(() => settings.value.currency || 'USD')

async function loadPrice() {
  priceState.value = { loading: true, error: false, data: null }
  try {
    const usdPrice = await getBchUsd()
    if (!usdPrice) {
      priceState.value = { loading: false, error: true, data: null }
      return
    }
    
    // Convert USD price to selected currency
    let price = usdPrice.usd
    let currency = displayCurrency.value
    if (currency !== 'USD') {
      const fiatPrice = await convertBchToFiat(1, currency) // 1 BCH in selected currency
      if (fiatPrice !== null) {
        price = fiatPrice
      }
    }
    
    priceState.value = { loading: false, error: false, data: { price, currency } }
  } catch {
    priceState.value = { loading: false, error: true, data: null }
  }
}

onMounted(() => {
  loadPrice()
  recentRequests.value = listRequests().slice(0, 3)
})

// Reload price when currency setting changes
watch(() => displayCurrency.value, () => {
  loadPrice()
})
</script>

<template>
  <div class="page">
    <div class="dashboard-intro">
      <div>
        <div class="eyebrow">Receive payments</div>
        <h1>Request BCH or CashTokens</h1>
        <p>Create a shareable request for your public address. CashScan never holds your funds.</p>
      </div>
    </div>

    <div class="receive-panel">
      <div class="receive-panel-heading">
        <span>Start a request</span>
        <span class="receive-panel-note">No account needed</span>
      </div>
      <div class="price-block">
        <span class="label">BCH spot price</span>
        <SkeletonLoader v-if="priceState.loading" height="36px" width="150px" />
        <div v-else-if="priceState.error || !priceState.data" class="error-inline">
          Price unavailable. <button class="btn-link" @click="loadPrice">Retry</button>
        </div>
        <div v-else class="price-value">{{ displayCurrency === 'USD' ? '$' : '' }}{{ priceState.data.price.toFixed(2) }}{{ displayCurrency !== 'USD' ? ' ' + displayCurrency : '' }}</div>
      </div>
      <div class="receive-actions" aria-label="Choose payment asset">
        <button class="btn btn-primary receive-action" @click="router.push('/request?mode=bch')"><span>Receive BCH</span><small>Share a BCH payment request</small></button>
        <button class="btn btn-secondary receive-action" @click="router.push('/request?mode=token')"><span>Receive token</span><small>Request a CashToken</small></button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Recent Requests</div>
      <div v-if="recentRequests.length" class="request-list card">
        <router-link v-for="request in recentRequests" :key="request.id" :to="`/request/${request.id}`" class="recent-request">
          <span class="request-copy">
            <strong>{{ request.asset === 'BCH' ? (request.amount ? `${request.amount} BCH` : 'Open BCH request') : `${request.amount} ${request.tokenSymbol || 'token'}` }}</strong>
            <span>{{ request.description || 'Payment request' }}</span>
          </span>
          <span :class="['pill', request.status === 'confirmed' ? 'pill-good' : 'pill-pending']"><span class="pill-dot"></span>{{ request.status }}</span>
        </router-link>
      </div>
      <div v-else class="empty-receive">
        <strong>No requests yet</strong>
        <span>Your generated BCH and CashToken requests will appear here.</span>
      </div>
    </div>

    <div class="section">
      <button class="btn btn-ghost" @click="router.push('/tokens')">Explore CashTokens</button>
    </div>

    <p class="footnote">{{ APP.tagline }}</p>
  </div>
</template>

<style scoped>
.dashboard-intro { margin: 2px 0 18px; }
.dashboard-intro h1 { font-size: 27px; line-height: 1.1; letter-spacing: 0; }
.dashboard-intro p { margin: 7px 0 0; max-width: 360px; color: var(--text-dim); font-size: 13px; line-height: 1.45; }
.eyebrow { margin-bottom: 8px; color: var(--bch); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.receive-panel { border: 1px solid var(--bch-dim); background: linear-gradient(135deg, rgba(22, 214, 140, 0.14), var(--surface) 62%); border-radius: var(--radius); padding: 18px; }
.receive-panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; color: var(--bch); font-family: var(--font-display); font-size: 15px; font-weight: 600; }
.receive-panel-note { color: var(--text-dim); font-family: var(--font-mono); font-size: 10px; font-weight: 400; letter-spacing: 0.04em; text-transform: uppercase; }
.price-block { min-height: 82px; }
.receive-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 14px; }
.receive-action { min-height: 72px; flex-direction: column; align-items: flex-start; padding: 13px 14px; gap: 4px; text-align: left; }
.receive-action small { color: inherit; font-family: var(--font-body); font-size: 11px; font-weight: 400; opacity: 0.76; line-height: 1.2; }
.price-value {
  font-family: var(--font-display);
  font-size: 36px;
  font-weight: 700;
  color: var(--bch);
  letter-spacing: 0;
}
.error-inline { color: var(--text-dim); font-size: 13px; }
.btn-link { background: none; border: none; color: var(--bch); font-family: var(--font-mono); font-size: 13px; padding: 0; }
.request-list { padding: 0; overflow: hidden; }
.recent-request { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 14px; color: var(--text); }
.recent-request + .recent-request { border-top: 1px solid var(--border); }
.request-copy { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.request-copy strong { font-family: var(--font-display); font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.request-copy span { color: var(--text-dim); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty-receive { display: flex; flex-direction: column; gap: 4px; border: 1px dashed var(--border); padding: 18px; color: var(--text-dim); font-size: 13px; }
.empty-receive strong { color: var(--text); font-family: var(--font-display); }
.footnote { text-align: center; color: var(--text-dim); font-size: 12px; margin: 16px 0 8px; }
</style>
