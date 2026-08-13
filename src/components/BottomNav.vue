<script setup>
const items = [
  { to: '/', label: 'Receive', icon: '↓' },
  { to: '/request', label: 'New request', icon: '+' },
  { to: '/activity', label: 'Requests', icon: '≋' },
  { to: '/tokens', label: 'Explore', icon: '◎' },
  { to: '/settings', label: 'Settings', icon: '⚙' }
]
</script>

<template>
  <nav class="bottom-nav">
    <router-link
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="nav-item"
      :class="{ active: $route.path === item.to }"
    >
      <span class="nav-icon" aria-hidden="true">{{ item.icon }}</span>
      <span class="nav-label">{{ item.label }}</span>
    </router-link>
  </nav>
</template>

<style scoped>
.bottom-nav {
  position: fixed;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 100%;
  max-width: 560px;
  display: flex;
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 6px 4px calc(6px + var(--safe-bottom));
  z-index: 20;
}
.nav-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 2px;
  border-radius: var(--radius-sm);
  color: var(--text-dim);
  min-height: 48px;
  justify-content: center;
}
.nav-icon { font-size: 18px; line-height: 1; }
.nav-label { font-family: var(--font-display); font-size: 10px; letter-spacing: 0.03em; }
.nav-item.active { color: var(--bch); }
.nav-item.active .nav-icon { text-shadow: 0 0 12px var(--glow); }
</style>
