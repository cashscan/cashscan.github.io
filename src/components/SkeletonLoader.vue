<script setup>
defineProps({
  height: { type: String, default: '18px' },
  width: { type: String, default: '100%' },
  rows: { type: Number, default: 1 }
})
</script>

<template>
  <div class="skeleton-group">
    <div
      v-for="n in rows"
      :key="n"
      class="skeleton"
      :style="{ height, width, marginBottom: n < rows ? '8px' : 0 }"
    />
  </div>
</template>

<style scoped>
.skeleton-group { width: 100%; }
</style>
