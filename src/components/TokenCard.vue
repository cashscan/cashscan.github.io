<script setup>
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

const props = defineProps({
  token: { type: Object, required: true }, // { token_id, name, symbol, decimals, tvl, volume, price_change, icon }
  metadata: { type: Object, default: null } // { name, symbol, icon, found }
})
const router = useRouter()

const displayName = computed(() => props.metadata?.name || props.token.name || 'Unnamed')
const displaySymbol = computed(() => props.metadata?.symbol || props.token.symbol || '—')
const displayIcon = computed(() => props.metadata?.icon || props.token.icon || null)
const initials = computed(() => (displaySymbol.value || displayName.value || '?').slice(0, 3).toUpperCase())
const imageFailed = ref(false)

watch(displayIcon, () => {
  imageFailed.value = false
})

function open() {
  router.push(`/tokens/${props.token.token_id}`)
}
</script>

<template>
  <button class="token-card" @click="open">
    <div class="icon-slot">
      <img v-if="displayIcon && !imageFailed" :src="displayIcon" :alt="displaySymbol" @error="imageFailed = true" />
      <span v-else class="icon-fallback" :title="displaySymbol">{{ initials }}</span>
    </div>
    <div class="token-main">
      <div class="token-name-row">
        <span class="token-name">{{ displayName }}</span>
        <span class="token-symbol">{{ displaySymbol }}</span>
      </div>
      <div class="token-cat mono">{{ token.token_id ? token.token_id.slice(0, 10) + '…' : 'no category' }}</div>
    </div>
    <div class="token-stats">
      <div class="stat-value mono">{{ token.tvl ? Number(token.tvl).toFixed(3) + ' BCH' : '—' }}</div>
      <div class="stat-label">TVL</div>
    </div>
  </button>
</template>

<style scoped>
.token-card {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px;
  color: var(--text);
}
.token-card:active { border-color: var(--bch-dim); }
.icon-slot {
  width: 40px; height: 40px;
  border-radius: 10px;
  background: var(--surface-raised);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}
.icon-slot img { width: 100%; height: 100%; object-fit: cover; }
.icon-fallback { font-family: var(--font-mono); font-size: 11px; color: var(--bch); }
.token-main { flex: 1; min-width: 0; }
.token-name-row { display: flex; align-items: baseline; gap: 6px; }
.token-name { font-family: var(--font-display); font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.token-symbol { font-size: 11px; color: var(--text); opacity: 0.75; font-family: var(--font-mono); }
.token-cat { font-size: 11px; color: var(--text); opacity: 0.6; margin-top: 2px; }
.token-stats { text-align: right; flex-shrink: 0; }
.stat-value { font-size: 13px; }
.stat-label { font-size: 10px; color: var(--text-dim); letter-spacing: 0.06em; }
</style>
