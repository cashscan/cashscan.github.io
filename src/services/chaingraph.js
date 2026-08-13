import { CHAINGRAPH_API_BASE } from '../config.js'
import { cached, TTL } from './cache.js'

const TOKEN_ID = '$tokenId'
const MAX_OUTPUTS = 5_000

function tokenId(category) {
  return `\\x${category}`
}

async function query(document, variables) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(CHAINGRAPH_API_BASE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: document, variables }),
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Chaingraph request failed (${response.status})`)
    const payload = await response.json()
    if (payload.errors?.length) throw new Error(payload.errors[0].message || 'Chaingraph query failed')
    return payload.data
  } finally {
    clearTimeout(timer)
  }
}

function amount(value) {
  try { return BigInt(value || 0) } catch { return 0n }
}

function isUserLockingBytecode(lockingBytecode) {
  // Chaingraph serializes PostgreSQL bytea values as "\\x<hex>". Strip that
  // transport prefix before matching BCH's standard P2PKH locking bytecode.
  const hex = (lockingBytecode || '').replace(/^\\x/i, '')
  return /^76a914[0-9a-f]{40}88ac$/i.test(hex)
}

function formatAuthchain(authchain) {
  if (!authchain) return null
  const migrations = (authchain.migrations || [])
    .map(({ migration_index: index, transaction }) => ({
      index: Number(index),
      txid: transaction?.hash?.replace(/^\\x/, '') || null,
      timestamp: transaction?.block_inclusions?.[0]?.block?.timestamp || null
    }))
    .filter((entry) => entry.txid)
  return {
    length: Number(authchain.authchain_length || migrations.length),
    authhead: authchain.authhead?.hash?.replace(/^\\x/, '') || null,
    migrations
  }
}

const INSIGHTS_QUERY = `
  query TokenInsights(${TOKEN_ID}: bytea!) {
    transaction(where: { hash: { _eq: ${TOKEN_ID} } }) {
      outputs(where: { token_category: { _eq: ${TOKEN_ID} } }) {
        fungible_token_amount
      }
      authchains {
        authchain_length
        authhead { hash }
        migrations(order_by: { migration_index: asc }) {
          migration_index
          transaction {
            hash
            block_inclusions { block { timestamp } }
          }
        }
      }
    }
    output(
      limit: ${MAX_OUTPUTS}
      where: {
        token_category: { _eq: ${TOKEN_ID} }
        locking_bytecode_pattern: { _neq: "6a" }
        transaction: { _or: [{ node_validations: {} }, { block_inclusions: { block: { accepted_by: {} } } }] }
        _not: { spent_by: { transaction: { _or: [{ node_validations: {} }, { block_inclusions: { block: { accepted_by: {} } } }] } } }
      }
    ) {
      locking_bytecode
      fungible_token_amount
    }
  }
`

/**
 * Returns currently indexed, unspent fungible-token output statistics. Figures
 * are source-backed chain observations, not wallet balances or ownership claims.
 */
export function getTokenChainInsights(category) {
  return cached(`chain-insights:${category}`, TTL.CHAIN_INSIGHTS, async () => {
    const data = await query(INSIGHTS_QUERY, { tokenId: tokenId(category) })
    const genesis = data.transaction?.[0]
    const outputs = data.output || []
    let circulatingSupply = 0n
    let userSupply = 0n
    let contractSupply = 0n
    const userLocks = new Set()
    const contractLocks = new Set()

    for (const output of outputs) {
      const tokenAmount = amount(output.fungible_token_amount)
      if (tokenAmount <= 0n) continue
      circulatingSupply += tokenAmount
      if (isUserLockingBytecode(output.locking_bytecode)) {
        userSupply += tokenAmount
        userLocks.add(output.locking_bytecode)
      } else {
        contractSupply += tokenAmount
        contractLocks.add(output.locking_bytecode)
      }
    }

    return {
      circulatingSupply,
      userSupply,
      contractSupply,
      userHolders: userLocks.size,
      contractHolders: contractLocks.size,
      totalHolders: userLocks.size + contractLocks.size,
      truncated: outputs.length === MAX_OUTPUTS,
      authchain: formatAuthchain(genesis?.authchains?.[0])
    }
  })
}