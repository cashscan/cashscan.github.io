import { NOSTR_RELAYS } from '../config.js'
import { cached, TTL } from './cache.js'
import { getSettings } from '../utils/storage.js'

const NOTE_KIND = 1
const RELAY_TIMEOUT_MS = 5_000
const MAX_NOTE_LENGTH = 2_000
const HIDDEN_CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u206F]/

const SYSTEM_UNSAFE_NOTE_PATTERNS = [
  { id: 'external-links', label: 'External links', pattern: /https?:\/\//i },
  { id: 'website-addresses', label: 'Website addresses', pattern: /\bwww\./i },
  { id: 'uri-scheme-links', label: 'URI-scheme links', pattern: /\b(?:nostr|bitcoin|bitcoincash|lightning):/i },
  { id: 'credential-requests', label: 'Seed phrase or private-key requests', pattern: /\b(seed phrase|recovery phrase|private key|wallet password)\b/i },
  { id: 'wallet-prompts', label: 'Wallet connection or verification prompts', pattern: /\b(wallet connect|connect wallet|verify wallet)\b/i },
  { id: 'scam-claims', label: 'Airdrop, giveaway, or guaranteed-return claims', pattern: /\b(airdrop|giveaway|claim now|double your|guaranteed return)\b/i },
  { id: 'payment-requests', label: 'Send or deposit requests', pattern: /\b(send|deposit)\b.{0,40}\b(bch|bitcoin|crypto|token)s?\b/i }
]

export const SYSTEM_COMMUNITY_FILTERS = SYSTEM_UNSAFE_NOTE_PATTERNS.map(({ id, label }) => ({ id, label }))

function requestRelay(relayUrl, filter) {
  return new Promise((resolve) => {
    let settled = false
    let socket
    const notes = []
    const subscriptionId = `cashscan-${Math.random().toString(36).slice(2)}`

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket?.close() } catch { /* relay cleanup is best-effort */ }
      resolve(notes)
    }
    const timer = setTimeout(finish, RELAY_TIMEOUT_MS)

    try {
      socket = new WebSocket(relayUrl)
      socket.onopen = () => socket.send(JSON.stringify(['REQ', subscriptionId, filter]))
      socket.onmessage = (message) => {
        try {
          const payload = JSON.parse(message.data)
          if (payload[0] === 'EVENT' && payload[1] === subscriptionId && payload[2]?.kind === NOTE_KIND) notes.push(payload[2])
          if (payload[0] === 'EOSE' && payload[1] === subscriptionId) finish()
        } catch {
          // Ignore malformed relay messages and keep waiting for EOSE/timeout.
        }
      }
      socket.onerror = finish
    } catch {
      finish()
    }
  })
}

function recentFallbackFilter() {
  return {
    kinds: [NOTE_KIND],
    since: Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60,
    limit: 100
  }
}

function isRelated(note, category, symbol) {
  const content = note.content || ''
  const normalizedSymbol = symbol?.trim().replace(/^#/, '')
  if (content.toLowerCase().includes(category.toLowerCase())) return true
  if (!normalizedSymbol) return false
  const symbolPattern = new RegExp(`(^|[^a-z0-9])#?${normalizedSymbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i')
  return symbolPattern.test(content)
}

function isSafeCommunityNote(note, userFilters, activeSystemFilterIds) {
  const content = note.content || ''
  if (!content.trim() || content.length > MAX_NOTE_LENGTH || HIDDEN_CONTROL_CHARACTERS.test(content)) return false
  if (SYSTEM_UNSAFE_NOTE_PATTERNS.some(({ id, pattern }) => activeSystemFilterIds.includes(id) && pattern.test(content))) return false
  const normalizedContent = content.toLocaleLowerCase()
  return !userFilters.some((filter) => normalizedContent.includes(filter.toLocaleLowerCase()))
}

/**
 * Find public text notes that explicitly mention a token category or ticker.
 * A relay can decline search filters, so callers must treat an empty result as
 * "no indexed notes" rather than proof that no discussion exists.
 */
export function getTokenCommunityNotes(category, symbol) {
  const symbolKey = symbol?.toUpperCase() || ''
  const userFilters = getSettings().communityFilters
    .filter((filter) => typeof filter === 'string' && filter.trim())
    .map((filter) => filter.trim())
  const settings = getSettings()
  const systemFilterStates = settings.communitySystemFilterStates || {}
  const activeSystemFilterIds = SYSTEM_UNSAFE_NOTE_PATTERNS
    .filter(({ id }) => systemFilterStates[id] ?? settings.communitySystemFiltersEnabled)
    .map(({ id }) => id)
  const filterKey = userFilters.map((filter) => filter.toLocaleLowerCase()).sort().join('|')
  return cached(`nostr:v4:${category}:${symbolKey}:${activeSystemFilterIds.join('|')}:${filterKey}`, TTL.COMMUNITY, async () => {
    const searches = [category]
    if (symbolKey) searches.push(symbolKey)
    const searchBatches = await Promise.all(
      NOSTR_RELAYS.flatMap((relay) => searches.map((search) => requestRelay(relay, { kinds: [NOTE_KIND], search, limit: 20 })))
    )
    // NIP-50 search support is optional. When a relay returns no search
    // candidates, inspect a small recent window and match token mentions locally.
    const searchNotes = searchBatches.flat()
    const fallbackBatches = searchNotes.length ? [] : await Promise.all(
      NOSTR_RELAYS.map((relay) => requestRelay(relay, recentFallbackFilter()))
    )
    const candidates = searchNotes.length ? searchNotes : fallbackBatches.flat()
    const seen = new Set()
    const relatedNotes = candidates.filter((note) => note?.id && isRelated(note, category, symbolKey))
    const safeNotes = relatedNotes.filter((note) => isSafeCommunityNote(note, userFilters, activeSystemFilterIds))
    const notes = safeNotes
      .filter((note) => !seen.has(note.id) && seen.add(note.id))
      .sort((first, second) => Number(second.created_at || 0) - Number(first.created_at || 0))
      .slice(0, 5)
      .map((note) => ({ id: note.id, content: note.content, createdAt: Number(note.created_at || 0), pubkey: note.pubkey }))
    return {
      notes,
      source: searchNotes.length ? 'search' : 'recent-fallback',
      candidateCount: candidates.length,
      relatedCount: relatedNotes.length,
      filteredCount: relatedNotes.length - safeNotes.length
    }
  })
}