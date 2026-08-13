<script setup>
import { ref, watch, onMounted } from 'vue'
import QRCode from 'qrcode'

const props = defineProps({
  data: { type: String, required: true },
  size: { type: Number, default: 260 }
})

const canvasRef = ref(null)
const copied = ref(false)

async function render() {
  if (!canvasRef.value || !props.data) return
  await QRCode.toCanvas(canvasRef.value, props.data, {
    width: props.size,
    margin: 1,
    color: { dark: '#06090A', light: '#E9F3EC' }
  })
}

onMounted(render)
watch(() => props.data, render)

async function copyUri() {
  try {
    await navigator.clipboard.writeText(props.data)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* clipboard unavailable — user can still select/copy manually */
  }
}

async function share() {
  if (navigator.share) {
    try {
      await navigator.share({ title: 'CashScan request', text: props.data })
      return
    } catch {
      /* user cancelled or share failed — fall back to copy */
    }
  }
  copyUri()
}

function download() {
  if (!canvasRef.value) return
  const link = document.createElement('a')
  link.download = 'cashscan-qr.png'
  link.href = canvasRef.value.toDataURL('image/png')
  link.click()
}

function print() {
  window.print()
}
</script>

<template>
  <div class="qr-wrap">
    <div class="qr-frame">
      <canvas ref="canvasRef"></canvas>
    </div>
    <div class="btn-row">
      <button class="btn btn-secondary" @click="copyUri">{{ copied ? 'Copied!' : 'Copy URI' }}</button>
      <button class="btn btn-secondary" @click="share">Share</button>
    </div>
    <div class="btn-row">
      <button class="btn btn-ghost" @click="download">Download</button>
      <button class="btn btn-ghost" @click="print">Print</button>
    </div>
  </div>
</template>

<style scoped>
.qr-wrap { display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
.qr-frame {
  align-self: center;
  padding: 14px;
  background: #e9f3ec;
  border-radius: var(--radius);
  box-shadow: 0 0 30px var(--glow);
}
canvas { display: block; max-width: 100%; height: auto; }
</style>
