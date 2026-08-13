import { createRouter, createWebHashHistory } from 'vue-router'

const routes = [
  { path: '/', name: 'dashboard', component: () => import('./views/Dashboard.vue') },
  { path: '/request', name: 'request', component: () => import('./views/Request.vue') },
  { path: '/request/:id', name: 'request-detail', component: () => import('./views/Request.vue'), props: true },
  { path: '/tokens', name: 'tokens', component: () => import('./views/Tokens.vue') },
  { path: '/tokens/:category', name: 'token-details', component: () => import('./views/TokenDetails.vue'), props: true },
  { path: '/activity', name: 'activity', component: () => import('./views/Activity.vue') },
  { path: '/settings', name: 'settings', component: () => import('./views/Settings.vue') }
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})
