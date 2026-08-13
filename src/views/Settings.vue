<script setup>
import { ref, onMounted } from 'vue'
import { getSettings, saveSettings, listRequests, requestsToCsv, deleteRequest, getWatchlist, toggleWatch } from '../utils/storage.js'
import { clearCache } from '../services/cache.js'
import { FIAT_CURRENCIES } from '../services/prices.js'
import { RIFTEN_API_BASE, BCH_EXPLORER_BASE, APP } from '../config.js'
import { shortenAddress } from '../utils/bch.js'

const settings = ref(getSettings())
const requests = ref(listRequests())
const watchlist = ref(getWatchlist())
const saved = ref(false)

function update(patch) {
  settings.value = saveSettings(patch)
  saved.value = true
  setTimeout(() => (saved.value = false), 1200)
}

function exportCsv() {
  const csv = requestsToCsv()
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'cashscan-history.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function removeRequest(id) {
  deleteRequest(id)
  requests.value = listRequests()
}

function removeWatch(cat) {
  toggleWatch(cat)
  watchlist.value = getWatchlist()
}

function resetCache() {
  clearCache()
  saved.value = true
  setTimeout(() => (saved.value = false), 1200)
}
</script>

<template>
  <div class="page">
    <h2 style="margin-bottom: 14px;">Settings</h2>

    <div class="section">
      <div class="section-title">Preferences</div>
      <div class="card">
        <div class="field">
          <label>Default currency</label>
          <select :value="settings.currency" @change="update({ currency: $event.target.value })">
            <option v-for="c in FIAT_CURRENCIES" :key="c" :value="c">{{ c }}</option>
          </select>
          <div class="field-hint">Used throughout the app to display BCH price and currency conversions.</div>
        </div>
        <div class="field">
          <label>Confirmations required to mark a request paid</label>
          <select :value="settings.confirmationsRequired" @change="update({ confirmationsRequired: Number($event.target.value) })">
            <option :value="0">0 confirmations (zero-conf)</option>
            <option :value="1">1 confirmation</option>
            <option :value="3">3 confirmations</option>
            <option :value="6">6 confirmations</option>
          </select>
        </div>
        <div class="save-hint" v-if="saved">Saved.</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">API Configuration</div>
      <div class="card">
        <div class="card-row"><span class="label">CashToken indexer</span><span class="value mono small">{{ RIFTEN_API_BASE }}</span></div>
        <div class="card-row"><span class="label">Block explorer</span><span class="value mono small">{{ BCH_EXPLORER_BASE }}</span></div>
        <p class="hint">Override via VITE_RIFTEN_API_BASE / VITE_BCH_EXPLORER_BASE in .env — see README.</p>
        <button class="btn btn-ghost" @click="resetCache">Clear cached market data</button>
      </div>
    </div>

    <div class="section" v-if="watchlist.length">
      <div class="section-title">Watchlist</div>
      <div class="card">
        <div class="card-row" v-for="cat in watchlist" :key="cat">
          <span class="value mono small">{{ cat.slice(0, 14) }}…</span>
          <button class="btn-link" @click="removeWatch(cat)">Remove</button>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Request History</div>
      <button class="btn btn-secondary" style="margin-bottom: 10px;" :disabled="!requests.length" @click="exportCsv">Export CSV</button>
      <div v-if="!requests.length" class="empty-state"><p>No requests yet.</p></div>
      <div class="card history-card" v-for="r in requests" :key="r.id">
        <router-link :to="`/request/${r.id}`" class="history-link">
          <div class="card-row">
            <span class="label">{{ r.description || (r.asset === 'BCH' ? 'BCH request' : (r.tokenSymbol || 'Token') + ' request') }}</span>
            <span class="value small">{{ new Date(r.createdAt).toLocaleDateString() }}</span>
          </div>
          <div class="card-row">
            <span class="value mono small">{{ shortenAddress(r.address) }}</span>
            <span class="pill" :class="r.status === 'confirmed' ? 'pill-good' : r.status === 'wrong-token' ? 'pill-bad' : 'pill-pending'">
              <span class="pill-dot"></span>{{ r.status }}
            </span>
          </div>
        </router-link>
        <button class="btn-link delete-btn" @click="removeRequest(r.id)">Delete</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">About CashScan</div>
      <div class="card info-card">
        <p>CashScan creates shareable BCH and CashToken payment requests, displays public token information, and can observe payments sent to a public address.</p>
        <p>It is a non-custodial client: it does not create wallets, hold funds, request seed phrases, or sign transactions.</p>
        <a class="repository" :href="APP.repositoryUrl" target="_blank" rel="noopener">View the source repository ↗</a>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Important Disclaimer</div>
      <div class="card info-card disclaimer-card">
        <p>CashScan is provided for informational and request-generation purposes. It is not a wallet, exchange, custodian, or financial adviser.</p>
        <p>Always verify the receiving address, asset, amount, and confirmation status in a trusted wallet or block explorer before treating a payment as final.</p>
        <p>Token prices, liquidity, supply, holders, and market activity come from third-party public indexers and may be delayed, incomplete, or unavailable.</p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Frequently Asked Questions</div>
      <div class="faq-list">
        <details>
          <summary>Does CashScan have access to my funds?</summary>
          <p>No. CashScan only works with public BCH addresses and public indexer data. It never asks for or stores private keys, seed phrases, or wallet passwords.</p>
        </details>
        <details>
          <summary>What does a share link contain?</summary>
          <p>A request link embeds the public receiving address, requested asset and amount, and optional description. Do not include private or sensitive information in a request description.</p>
        </details>
        <details>
          <summary>Does a CashToken request send the token automatically?</summary>
          <p>No. The request communicates the token category and amount. The sender still needs a compatible wallet and must review the asset and recipient address before sending.</p>
        </details>
        <details>
          <summary>Why does a request show pending after payment?</summary>
          <p>CashScan observes public indexer data. Indexing and blockchain confirmations can take time. Use your wallet or a block explorer as the final source of payment confirmation.</p>
        </details>
        <details>
          <summary>Why is token data missing or different elsewhere?</summary>
          <p>Token metadata and market data are sourced from public services. A token can have no registry record, unreachable artwork, incomplete indexer coverage, or different data freshness across providers.</p>
        </details>
      </div>
    </div>

    <p class="version-tag">{{ APP.name }} · non-custodial · no account</p>
  </div>
</template>

<style scoped>
.save-hint { color: var(--bch); font-size: 12px; margin-top: 6px; }
.hint { color: var(--text-dim); font-size: 11px; margin: 8px 0; }
.field-hint { color: var(--text-dim); font-size: 11px; margin-top: 4px; }
.value.small, .value.mono.small { font-size: 11px; }
.btn-link { background: none; border: none; color: var(--red); font-size: 12px; }
.version-tag { text-align: center; color: var(--text-dim); font-size: 11px; margin: 28px 0 8px; }
.history-card { padding: 0; overflow: hidden; }
.history-link { display: block; padding: 16px; color: inherit; }
.history-link:active { background: var(--surface-raised); }
.delete-btn { width: 100%; text-align: right; padding: 8px 16px 12px; border-top: 1px solid var(--border); }
.info-card { color: var(--text-dim); font-size: 13px; line-height: 1.5; }
.info-card p { margin: 0; }
.info-card p + p { margin-top: 10px; }
.disclaimer-card { border-left: 3px solid var(--amber); }
.repository { display: inline-block; margin-top: 12px; font-family: var(--font-mono); font-size: 12px; }
.faq-list { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.faq-list details { background: var(--surface); }
.faq-list details + details { border-top: 1px solid var(--border); }
.faq-list summary { padding: 14px; color: var(--text); cursor: pointer; font-family: var(--font-display); font-size: 14px; }
.faq-list p { margin: 0; padding: 0 14px 14px; color: var(--text-dim); font-size: 13px; line-height: 1.5; }
</style>
