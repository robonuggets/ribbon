// Which prompt-cache length this chat's main thread writes with, read from the end of its
// transcript. Claude Code does not hand that to mods, so the transcript is the source:
// every assistant row's usage says how many tokens went to the 1 hour and 5 min caches.

export type Ttl = 'unknown' | '5m' | '1h'

/** How many bytes from the end of the transcript are read; the last replies sit there. */
export const TAIL_BYTES = 3_000_000

type Row = {
  type?: unknown
  isSidechain?: unknown
  message?: { usage?: { cache_creation?: { ephemeral_1h_input_tokens?: unknown; ephemeral_5m_input_tokens?: unknown } } }
}

/**
 * The cache length of the last main-thread reply that wrote to the cache, given the
 * transcript's tail. The first line is dropped: a tail can start inside one.
 */
export function ttlFromTail(tail: string): Ttl {
  const lines = tail.split('\n').slice(1)
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!
    if (!line.includes('"assistant"')) continue
    let row: Row
    try {
      row = JSON.parse(line) as Row
    } catch {
      continue
    }
    if (row.type !== 'assistant' || row.isSidechain) continue
    const cc = row.message?.usage?.cache_creation
    if (Number(cc?.ephemeral_1h_input_tokens ?? 0) > 0) return '1h'
    if (Number(cc?.ephemeral_5m_input_tokens ?? 0) > 0) return '5m'
  }
  return 'unknown'
}
