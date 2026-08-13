<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { isValidBchAddress, buildPaymentUri, displayAddress, shortenAddress } from '../utils/bch.js'
import { displayToRaw, priceToSatsPerWholeToken } from '../utils/token.js'
import { convertBchToFiat, convertFiatToBch, getBchUsd, FIAT_CURRENCIES, DEFAULT_CURRENCY } from '../services/prices.js'
import { searchTokens, getTokenPrice } from '../services/cauldron.js'
import { getNormalizedMetadata } from '../services/bcmr.js'
import { saveRequest, getRequest, updateRequestStatus, getSettings, rememberAddress } from '../utils/storage.js'
import { getAddressBalance, explorerAddressUrl, explorerTxUrl } from '../services/blockchain.js'
import { decodeRequestPayload, buildShareUrl } from '../utils/requestLink.js'
import { BCHPURZE_WALLET_URL } from '../config.js'
import QrCode from '../components/QrCode.vue'

const route = useRoute()
const router = useRouter()

const mode = ref(route.query.mode === 'token' ? 'token' : 'bch')
const step = ref('form') // 'form' | 'result'
const activeRequest = ref(null)
const viewingSharedLink = ref(false) // true when opened via a ?p= payload from someone else

// ---- BCH form state ----
const bchForm = reactive({
  address: '',
  amountBch: '',
  amountFiat: '',
  currency: DEFAULT_CURRENCY,
  description: '',
  expiresMinutes: ''
})
const bchErrors = ref({})
const lastEdited = ref('bch') // tracks which field the user is typing so we know which direction to convert

function resetBchForm() {
  const settings = getSettings()
  bchForm.address = settings.lastAddress || ''
  bchForm.amountBch = ''
  bchForm.amountFiat = ''
  bchForm.currency = settings.currency || DEFAULT_CURRENCY
  bchForm.description = ''
  bchForm.expiresMinutes = ''
}

async function syncFromBch() {
  if (!bchForm.amountBch) { bchForm.amountFiat = ''; return }
  const fiat = await convertBchToFiat(Number(bchForm.amountBch), bchForm.currency)
  bchForm.amountFiat = fiat !== null ? fiat.toFixed(2) : ''
}
async function syncFromFiat() {
  if (!bchForm.amountFiat) { bchForm.amountBch = ''; return }
  const bch = await convertFiatToBch(Number(bchForm.amountFiat), bchForm.currency)
  bchForm.amountBch = bch !== null ? bch.toFixed(8) : ''
}
watch(() => bchForm.amountBch, () => { if (lastEdited.value === 'bch') syncFromBch() })
watch(() => bchForm.amountFiat, () => { if (lastEdited.value === 'fiat') syncFromFiat() })
watch(() => bchForm.currency, () => { if (bchForm.amountBch) syncFromBch() })

// Reset form settings when navigating to the request page (to pick up latest settings like currency)
watch(() => route.path, (newPath) => {
  if (newPath.startsWith('/request') && step.value === 'form') {
    resetBchForm()
  }
})

function validateBch() {
  const errors = {}
  if (!isValidBchAddress(bchForm.address)) errors.address = 'Enter a valid BCH address'
  if (!bchForm.amountBch && !bchForm.amountFiat) {
    // amount is optional (open-ended request) — allowed
  } else if (bchForm.amountBch && Number(bchForm.amountBch) <= 0) {
    errors.amountBch = 'Amount must be greater than zero'
  }
  bchErrors.value = errors
  return Object.keys(errors).length === 0
}

function generateBchRequest() {
  if (!validateBch()) return
  const uri = buildPaymentUri({
    address: bchForm.address,
    amountBch: bchForm.amountBch || undefined,
    message: bchForm.description || undefined
  })
  const expiresAt = bchForm.expiresMinutes ? Date.now() + Number(bchForm.expiresMinutes) * 60_000 : null
  rememberAddress(displayAddress(bchForm.address))
  const entry = saveRequest({
    asset: 'BCH',
    address: displayAddress(bchForm.address),
    amount: bchForm.amountBch || null,
    fiatAmount: bchForm.amountFiat || null,
    fiatCurrency: bchForm.currency,
    description: bchForm.description,
    uri,
    expiresAt
  })
  openResult(entry)
}

// ---- Token form state ----
const tokenForm = reactive({
  query: '',
  selected: null, // { token_id, name, symbol, decimals, ... } + metadata merged in
  amount: '',
  address: getSettings().lastAddress || '',
  message: ''
})
const tokenResults = ref([])
const tokenSearchLoading = ref(false)
const tokenErrors = ref({})
let searchDebounce = null

watch(() => tokenForm.query, (q) => {
  clearTimeout(searchDebounce)
  if (!q || tokenForm.selected) { tokenResults.value = []; return }
  searchDebounce = setTimeout(async () => {
    tokenSearchLoading.value = true
    try {
      const results = (await searchTokens(q, { limit: 8 })) || []
      // Enrich search results with BCMR metadata so names/symbols display correctly
      const enriched = await Promise.all(
        results.map(async (t) => {
          try {
            const meta = await getNormalizedMetadata(t.token_id)
            return { ...t, name: meta?.name || t.name, symbol: meta?.symbol || t.symbol, icon: meta?.icon || t.icon }
          } catch {
            return t
          }
        })
      )
      tokenResults.value = enriched
    } catch {
      tokenResults.value = []
    } finally {
      tokenSearchLoading.value = false
    }
  }, 300)
})

const tokenValuePreview = ref(null) // { bch, fiat } estimated value of the entered amount

async function selectToken(t) {
  tokenForm.selected = t
  tokenForm.query = t.name || t.symbol || t.token_id
  tokenResults.value = []
  tokenValuePreview.value = null
  // Enrich with BCMR metadata (icon, website) when the search result is thin.
  try {
    const meta = await getNormalizedMetadata(t.token_id)
    tokenForm.selected = { ...t, ...meta, decimals: t.decimals ?? meta.decimals ?? 0 }
  } catch {
    /* keep the thinner search result — still usable */
  }
  // Fetch a live price so the amount field can show "≈ 0.002 BCH / $0.80" as
  // the person types — makes it obvious what they're actually requesting.
  try {
    const [price, bchUsd] = await Promise.all([getTokenPrice(tokenForm.selected.token_id), getBchUsd()])
    if (price?.price) {
      tokenForm.selected.satsPerToken = priceToSatsPerWholeToken(price.price, tokenForm.selected.decimals ?? 0)
      tokenForm.selected.bchUsd = bchUsd?.usd ?? null
    }
  } catch {
    /* price preview is a nice-to-have — request creation still works without it */
  }
}

function clearToken() {
  tokenForm.selected = null
  tokenForm.query = ''
  tokenValuePreview.value = null
}

watch(() => tokenForm.amount, (amt) => {
  const selected = tokenForm.selected
  if (!amt || !selected?.satsPerToken || Number(amt) <= 0) { tokenValuePreview.value = null; return }
  const bch = (Number(amt) * selected.satsPerToken) / 1e8
  const fiat = selected.bchUsd ? bch * selected.bchUsd : null
  tokenValuePreview.value = { bch, fiat }
})

// Truncate long strings (like token IDs) in the middle with ellipsis
function truncateMiddle(str, maxLength = 24) {
  if (!str || str.length <= maxLength) return str
  const start = Math.ceil((maxLength - 3) / 2)
  const end = maxLength - 3 - start
  return str.slice(0, start) + '...' + str.slice(-end)
}

function validateToken() {
  const errors = {}
  if (!tokenForm.selected) errors.token = 'Select a CashToken'
  if (!isValidBchAddress(tokenForm.address)) errors.address = 'Enter a valid BCH address'
  if (!tokenForm.amount || Number(tokenForm.amount) <= 0) errors.amount = 'Enter an amount greater than zero'
  tokenErrors.value = errors
  return Object.keys(errors).length === 0
}

function generateTokenRequest() {
  if (!validateToken()) return
  const decimals = tokenForm.selected.decimals ?? 0
  let raw
  try {
    raw = displayToRaw(tokenForm.amount, decimals)
  } catch (e) {
    tokenErrors.value = { amount: e.message }
    return
  }
  // BCH payment URIs don't carry CashToken category/amount natively — we encode
  // the address as the scannable payload and keep token intent in local state,
  // matching wallets' current lack of a standard CashToken request URI.
  const uri = buildPaymentUri({
    address: tokenForm.address,
    message: tokenForm.message || `${tokenForm.amount} ${tokenForm.selected.symbol || ''}`.trim()
  })
  rememberAddress(displayAddress(tokenForm.address))
  const entry = saveRequest({
    asset: 'TOKEN',
    address: displayAddress(tokenForm.address),
    amount: tokenForm.amount,
    tokenCategory: tokenForm.selected.token_id,
    tokenSymbol: tokenForm.selected.symbol,
    tokenDecimals: decimals,
    description: tokenForm.message,
    uri,
    tokenRaw: raw.toString()
  })
  openResult(entry)
}

// ---- Result / monitoring ----
const monitor = reactive({ status: 'idle', receivedSat: null, error: false })
let pollTimer = null

function openResult(entry) {
  activeRequest.value = entry
  step.value = 'result'
  router.replace({ path: `/request/${entry.id}`, query: {} })
  if (entry.asset === 'BCH') startMonitoring(entry)
}

function startMonitoring(entry) {
  stopMonitoring()
  monitor.status = 'waiting'
  const poll = async () => {
    try {
      const bal = await getAddressBalance(entry.address)
      if (!bal) return
      const requestedSat = entry.amount ? Math.round(Number(entry.amount) * 1e8) : null
      const settings = getSettings()
      if (bal.confirmedSat > 0 || bal.unconfirmedSat > 0) {
        const received = bal.confirmedSat + bal.unconfirmedSat
        const detected = requestedSat === null || received >= requestedSat
        monitor.receivedSat = received
        if (detected) {
          const confirmed = settings.confirmationsRequired === 0 ? true : bal.confirmedSat >= received
          monitor.status = confirmed ? 'confirmed' : 'detected'
          updateRequestStatus(entry.id, confirmed ? 'confirmed' : 'detected')
          if (confirmed) stopMonitoring()
        } else {
          monitor.status = 'partial'
          updateRequestStatus(entry.id, 'partial')
        }
      }
    } catch {
      monitor.error = true
    }
  }
  poll()
  pollTimer = setInterval(poll, 15_000)
}
function stopMonitoring() {
  clearInterval(pollTimer)
  pollTimer = null
}
onUnmounted(stopMonitoring)

onMounted(() => {
  // A self-contained shared link: /request?p=<payload>. Works for anyone,
  // on any device — the entire request is encoded in the URL, not looked
  // up from the creator's local storage.
  if (route.query.p) {
    const decoded = decodeRequestPayload(route.query.p)
    if (decoded) {
      viewingSharedLink.value = true
      const uri = decoded.asset === 'TOKEN'
        ? buildPaymentUri({ address: decoded.address, message: decoded.description || `${decoded.amount} ${decoded.tokenSymbol || ''}`.trim() })
        : buildPaymentUri({ address: decoded.address, amountBch: decoded.amount || undefined, message: decoded.description || undefined })
      activeRequest.value = { id: null, status: 'pending', ...decoded, uri }
      step.value = 'result'
      if (decoded.asset === 'BCH') startMonitoring(activeRequest.value)
      return
    }
  }
  // A locally-saved request, viewable/re-shareable only on the device that created it.
  if (route.params.id) {
    const existing = getRequest(route.params.id)
    if (existing) {
      activeRequest.value = existing
      step.value = 'result'
      if (existing.asset === 'BCH' && existing.status !== 'confirmed') startMonitoring(existing)
      return
    }
  }
  // On form, ensure we have the latest settings (especially currency + last address)
  resetBchForm()
})

function newRequest() {
  stopMonitoring()
  step.value = 'form'
  activeRequest.value = null
  viewingSharedLink.value = false
  resetBchForm()
  router.replace({ path: '/request', query: {} })
}

function copyShareUrl() {
  if (shareUrl.value) {
    navigator.clipboard?.writeText(shareUrl.value).catch(() => {})
  }
}

async function shareRequest() {
  if (!shareUrl.value) return

  // Try to use Web Share API if available
  if (navigator.share) {
    try {
      const title = activeRequest.value.asset === 'BCH'
        ? `${activeRequest.value.amount || 'Payment'} BCH Request`
        : `${activeRequest.value.amount} ${activeRequest.value.tokenSymbol} Request`
      await navigator.share({
        title,
        text: activeRequest.value.description || 'Payment request from CashScan',
        url: shareUrl.value
      })
      return
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e)
    }
  }

  // Fall back to copying to clipboard
  navigator.clipboard?.writeText(shareUrl.value).catch(() => {})
}

const statusPillClass = computed(() => {
  const s = activeRequest.value?.status
  if (s === 'confirmed' || s === 'detected') return 'pill-good'
  if (s === 'wrong-token' || s === 'expired') return 'pill-bad'
  return 'pill-pending'
})

const shareUrl = computed(() => {
  if (!activeRequest.value) return ''
  return buildShareUrl(activeRequest.value)
})
</script>

<template>
  <div class="page">
    <template v-if="step === 'form'">
      <div class="request-intro">
        <div class="eyebrow">New payment request</div>
        <h1>What are you receiving?</h1>
      </div>
      <div class="mode-switch" role="tablist" aria-label="Asset type">
        <button :class="['switch-btn', { active: mode === 'bch' }]" role="tab" :aria-selected="mode === 'bch'" @click="mode = 'bch'">BCH</button>
        <button :class="['switch-btn', { active: mode === 'token' }]" role="tab" :aria-selected="mode === 'token'" @click="mode = 'token'">CashToken</button>
      </div>

      <!-- BCH request form -->
      <form v-if="mode === 'bch'" class="card" @submit.prevent="generateBchRequest">
        <div class="field">
          <label>Your BCH address</label>
          <input type="text" v-model.trim="bchForm.address" placeholder="bitcoincash:q..." />
          <div v-if="bchErrors.address" class="field-error">{{ bchErrors.address }}</div>
          <a class="wallet-hint" :href="BCHPURZE_WALLET_URL" target="_blank" rel="noopener">Don't have an address? Connect a wallet ↗</a>
        </div>
        <div class="field">
          <label>Amount (BCH)</label>
          <input type="number" step="0.00000001" min="0" v-model="bchForm.amountBch" placeholder="0.01000000" @input="lastEdited = 'bch'" />
        </div>
        <div class="field">
          <label>Or amount in fiat</label>
          <div class="fiat-row">
            <input type="number" step="0.01" min="0" v-model="bchForm.amountFiat" placeholder="2.10" @input="lastEdited = 'fiat'" />
            <select v-model="bchForm.currency">
              <option v-for="c in FIAT_CURRENCIES" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label>Description</label>
          <input type="text" v-model="bchForm.description" placeholder="Coffee" maxlength="140" />
        </div>
        <div class="field">
          <label>Expires in (minutes, optional)</label>
          <input type="number" min="1" v-model="bchForm.expiresMinutes" placeholder="No expiration" />
        </div>
        <button type="submit" class="btn btn-primary">Create BCH request</button>
      </form>

      <!-- Token request form -->
      <form v-else class="card" @submit.prevent="generateTokenRequest">
        <div class="field">
          <label>Token</label>
          <input type="text" v-model="tokenForm.query" placeholder="Search token name or symbol…" @focus="tokenForm.selected = null" />
          <div v-if="tokenSearchLoading" class="field-hint">Searching…</div>
          <div v-if="tokenResults.length" class="token-results">
            <button v-for="t in tokenResults" :key="t.token_id" type="button" class="token-result" @click="selectToken(t)">
              <span>{{ t.name || t.symbol || t.token_id.slice(0, 12) }}</span>
              <span class="mono muted">{{ t.symbol }}</span>
            </button>
          </div>
          <div v-if="tokenForm.selected" class="selected-token">
            <div class="mono">{{ tokenForm.selected.symbol }} · {{ tokenForm.selected.decimals ?? 0 }} decimals</div>
            <div class="mono muted token-id-display" :title="tokenForm.selected.token_id">{{ truncateMiddle(tokenForm.selected.token_id) }}</div>
            <button type="button" class="btn-link" @click="clearToken">Change token</button>
          </div>
          <div v-if="tokenErrors.token" class="field-error">{{ tokenErrors.token }}</div>
        </div>
        <div class="field">
          <label>Amount</label>
          <input type="text" inputmode="decimal" v-model="tokenForm.amount" placeholder="1000" />
          <div v-if="tokenErrors.amount" class="field-error">{{ tokenErrors.amount }}</div>
          <div v-if="tokenValuePreview" class="field-hint mono">
            ≈ {{ tokenValuePreview.bch.toFixed(8) }} BCH<template v-if="tokenValuePreview.fiat"> · ${{ tokenValuePreview.fiat.toFixed(2) }}</template>
          </div>
        </div>
        <div class="field">
          <label>Recipient BCH address</label>
          <input type="text" v-model.trim="tokenForm.address" placeholder="bitcoincash:q..." />
          <div v-if="tokenErrors.address" class="field-error">{{ tokenErrors.address }}</div>
          <a class="wallet-hint" :href="BCHPURZE_WALLET_URL" target="_blank" rel="noopener">Don't have an address? Connect a wallet ↗</a>
        </div>
        <div class="field">
          <label>Message (optional)</label>
          <input type="text" v-model="tokenForm.message" maxlength="140" />
        </div>
        <button type="submit" class="btn btn-primary">Create token request</button>
      </form>
    </template>

    <template v-else-if="step === 'result' && activeRequest">
      <div v-if="viewingSharedLink" class="shared-banner">
        Shared payment request
      </div>
      <div class="card result-card">
        <div class="result-header">
          <span class="pill" :class="statusPillClass">
            <span class="pill-dot"></span>
            {{ activeRequest.status }}
          </span>
        </div>
        <div class="request-summary">
          <span class="summary-label">Requested</span>
          <strong>{{ activeRequest.asset === 'BCH' ? (activeRequest.amount ? `${activeRequest.amount} BCH` : 'Any BCH amount') : `${activeRequest.amount} ${activeRequest.tokenSymbol || 'token'}` }}</strong>
          <span>{{ activeRequest.description || 'Payment request' }}</span>
        </div>
        <QrCode :data="activeRequest.uri" />
        <div class="card-row">
          <span class="label">Share link</span>
          <button class="value mono share-link-btn" @click="copyShareUrl" title="Copy to clipboard">{{ shareUrl ? '…' + shareUrl.slice(-14) : '—' }} 📋</button>
        </div>
        <div class="card-row">
          <span class="label">Address</span>
          <span class="value">{{ shortenAddress(activeRequest.address) }}</span>
        </div>
        <div class="card-row" v-if="activeRequest.asset === 'BCH'">
          <span class="label">Amount</span>
          <span class="value">{{ activeRequest.amount ? activeRequest.amount + ' BCH' : 'Open amount' }}</span>
        </div>
        <div class="card-row" v-if="activeRequest.fiatAmount">
          <span class="label">Fiat equivalent</span>
          <span class="value">{{ activeRequest.fiatAmount }} {{ activeRequest.fiatCurrency }}</span>
        </div>
        <div class="card-row" v-if="activeRequest.asset === 'TOKEN'">
          <span class="label">Token amount</span>
          <span class="value">{{ activeRequest.amount }} {{ activeRequest.tokenSymbol }}</span>
        </div>
        <div class="card-row" v-if="activeRequest.description">
          <span class="label">Description</span>
          <span class="value">{{ activeRequest.description }}</span>
        </div>
        <a class="explorer-link" :href="explorerAddressUrl(activeRequest.address)" target="_blank" rel="noopener">
          Open address in explorer ↗
        </a>
      </div>

      <div class="btn-group">
        <button class="btn btn-primary" @click="copyShareUrl">Copy Share URL</button>
        <button class="btn btn-secondary" @click="shareRequest">Share Request</button>
      </div>
      <p class="btn-hint">Share URL works for all devices. Scan QR code with wallet apps.</p>

      <div v-if="activeRequest.asset === 'BCH'" class="card">
        <div class="section-title" style="margin-top:0;">Payment Monitor</div>
        <p v-if="monitor.status === 'waiting'" class="mono muted">Waiting for payment…</p>
        <p v-else-if="monitor.status === 'detected'" class="mono" style="color: var(--bch)">✓ Payment detected — awaiting confirmations</p>
        <p v-else-if="monitor.status === 'confirmed'" class="mono" style="color: var(--bch)">✓ Payment confirmed</p>
        <p v-else-if="monitor.status === 'partial'" class="mono" style="color: var(--amber)">Partial payment received</p>
        <p v-if="monitor.receivedSat !== null" class="mono muted">Received: {{ (monitor.receivedSat / 1e8).toFixed(8) }} BCH</p>
        <p v-if="monitor.error" class="field-error">Could not reach the blockchain indexer. It will keep retrying.</p>
        <p class="footnote-small">CashScan only observes this address — it never has access to funds sent here.</p>
        <a class="wallet-hint" :href="BCHPURZE_WALLET_URL" target="_blank" rel="noopener">Paid already? Check your wallet balance ↗</a>
      </div>

      <button class="btn btn-secondary" style="margin-top: 14px;" @click="newRequest">{{ viewingSharedLink ? 'Create your own request' : 'New request' }}</button>
    </template>
  </div>
</template>

<style scoped>
.request-intro { margin: 2px 0 16px; }
.request-intro h1 { font-size: 24px; letter-spacing: 0; }
.eyebrow { margin-bottom: 7px; color: var(--bch); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.mode-switch { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 14px; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); }
.switch-btn {
  padding: 10px;
  border-radius: 5px;
  border: 0;
  background: transparent;
  color: var(--text-dim);
  font-family: var(--font-display);
  font-size: 13px;
}
.switch-btn.active { background: var(--surface-raised); color: var(--bch); box-shadow: inset 0 0 0 1px var(--bch-dim); }
.field-error { color: var(--red); font-size: 12px; margin-top: 4px; }
.field-hint { color: var(--text-dim); font-size: 12px; margin-top: 4px; }
.fiat-row { display: flex; gap: 8px; }
.fiat-row select { max-width: 90px; }
.token-results { margin-top: 8px; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.token-result {
  display: flex; justify-content: space-between; width: 100%;
  padding: 10px 12px; background: var(--surface-raised); border: none; border-bottom: 1px solid var(--border);
  color: var(--text); font-size: 13px;
}
.token-result:last-child { border-bottom: none; }
.selected-token { margin-top: 8px; padding: 10px; background: var(--surface-raised); border-radius: var(--radius-sm); font-size: 13px; }
.token-id-display { display: block; word-break: break-all; overflow: hidden; text-overflow: ellipsis; }
.muted { color: var(--text-dim); }
.btn-link { background: none; border: none; color: var(--bch); font-size: 12px; padding: 6px 0 0; }
.result-header { display: flex; justify-content: flex-end; margin-bottom: 10px; }
.request-summary { margin: 0 0 14px; padding: 14px; border-left: 3px solid var(--bch); background: var(--surface-raised); display: flex; flex-direction: column; gap: 3px; }
.request-summary strong { font-family: var(--font-display); font-size: 22px; letter-spacing: 0; }
.request-summary span:last-child { color: var(--text-dim); font-size: 13px; overflow-wrap: anywhere; }
.summary-label { color: var(--bch); font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
.explorer-link { display: block; margin-top: 10px; font-size: 13px; text-align: center; }
.btn-group { display: flex; gap: 8px; margin-top: 14px; }
.btn-group .btn { flex: 1; }
.share-link-btn { background: none; border: none; color: var(--bch); cursor: pointer; font-family: var(--font-mono); font-size: 13px; padding: 0; }
.share-link-btn:hover { opacity: 0.8; }
.btn-hint { color: var(--text-dim); font-size: 11px; margin-top: 8px; text-align: center; }
.footnote-small { color: var(--text-dim); font-size: 11px; margin-top: 10px; }
.wallet-hint { display: inline-block; margin-top: 6px; font-size: 12px; color: var(--bch); }
.shared-banner {
  background: rgba(22, 214, 140, 0.1);
  border-left: 3px solid var(--bch);
  color: var(--bch);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  font-size: 13px;
  margin-bottom: 10px;
}
</style>
