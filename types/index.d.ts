/** One usage window: which one, how much is used (0 to 100), when it resets. */
export type Window = { kind: string; percentUsed: number; resetsAt?: string }

/**
 * The prompt cache as the band last saw it: when the main thread last sent a
 * request (clock milliseconds), how much context the next request re-sends,
 * the model's context window, and the model.
 */
export type CacheFacts = { lastAt: number; tokens: number; window: number; model: string | null }

/** Whether the cache card is open, remembered only for the state it was set in. */
export type Fold = { mode: 'warm' | 'cold'; open: boolean }

/** Which row the band draws: the usage gauges, or savvy-progress's agents bar. */
export type ViewMode = 'usage' | 'agents'

export type AgentStatus = 'running' | 'done' | 'failed'

/** One subagent of the session, as savvy-progress tracks it; `wave` groups the runs the band counts. */
export type AgentRun = {
  id: string
  agentId?: string
  type: string
  description: string
  model: string
  effort?: string
  status: AgentStatus
  startedAt: number
  endedAt?: number
  contextTokens: number
  contextMax: number
  tokens: number
  costUsd: number
  steps: number
  round: number
  wave: number
}

/** The agents pane's own toggles. It opens only from ×N or /agents-info. */
export type AgentsPanel = { isCompact: boolean; isDoneCollapsed: boolean }

declare module 'claude-code' {
  interface PluginState {
    'ribbon': {
      windows: Window[]
      cache: CacheFacts | null
      fold: Fold | null
      mode: ViewMode
      agents: AgentRun[]
      panel: AgentsPanel
      now: number
    }
  }
}
