/** One usage window: which one, how much is used (0 to 100), when it resets. */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * The prompt cache as the band last saw it: when the main thread last sent a
 * request (clock milliseconds), how much context the next request re-sends,
 * the model's context window, and the model.
 */
export type CacheFacts = { lastAt: number; tokens: number; window: number; model: string | null }

/** Whether the cache card is open, remembered only for the state it was set in. */
/** What the cache-tax mod's `$.cacheTax.status()` gave, when that mod is installed: the keepwarm line the band shows. */
export type Keepwarm = { state: 'on' | 'off' | 'stopped'; leftMs: number }

export type Fold = { mode: 'warm' | 'cold'; open: boolean }

declare module 'claude-code' {
  interface PluginState {
    'ribbon': { windows: Window[]; cache: CacheFacts | null; fold: Fold | null; keepwarm: Keepwarm | null }
  }
}
