/** One usage window: which one, how much is used (0 to 100), when it resets. */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * The prompt cache as the band last saw it: when the main thread last sent a
 * request (clock milliseconds), how much context the next request re-sends,
 * the model's context window, and the model. After a resume, `usd` is Claude
 * Code's own estimate of re-caching that context; the next request drops it.
 */
export type CacheFacts = { lastAt: number; tokens: number; window: number; model: string | null; usd?: number }

/** Whether the cache card is open, remembered only for the state it was set in. */
export type Fold = { mode: 'warm' | 'cold'; open: boolean }

declare module 'claude-code' {
  interface PluginState {
    'ribbon': { windows: Window[]; cache: CacheFacts | null; fold: Fold | null }
  }
}
