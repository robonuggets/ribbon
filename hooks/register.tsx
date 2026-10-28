import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, ThemeKey } from 'claude-code'

import type { AgentRun, AgentsPanel, CacheFacts, Fold, ViewMode, Window } from '../types'
import {
  EMPTY, HUE, INK, ORANGE, VIOLET, ROBO_SIZE, T_EMPTY, T_HUE, T_MUTED, T_TEXT, TEXT, TTL_MIN, TTL_MS, WORD, YELLOW,
  cardSvg, chipSvg, costOf, familyOf, fmtIdle, mineModel, roboSvg, svgDoc, usd,
} from './cache-art'
import type { CacheView } from './cache-art'
import { ROW_H, crewLabel, crewPercent, crewRowSvg } from './savvy-art'
import type { CrewView } from './savvy-art'
import {
  COMPACT_H, HEADER_H, LINE_H, ROW_H as AGENT_ROW_H, STATUS_GLYPH,
  agentSvg, colorOf, compactSvg, ctxBar, ctxOf, elapsed, fmtCost, fmtTime, fmtTokens, gridSvg, gridTiles,
  headerSvg, modelName, runCost, runModel, tierOf as tierOfType, totals, windowOf,
} from './savvy-pane-art'

// A band above the prompt in a warm dark look: card surface, cream text,
// dot-matrix bars. Shows how much of each usage window is LEFT, 7-day first, then
// 5-hour; 7D is orange, 5H is yellow; a window under 15% adds a bold LOW.
//
// After the first reply it also shows the prompt cache: WARM (red, Robo bobbing)
// for an hour after the last request, then COLD (blue, Robo frozen) with what the
// next message costs to re-cache. Hide / Show folds the card; warm starts folded,
// cold starts open, and a choice holds until the cache flips. Zero token cost:
// it reads the engine's own figures and draws.
//
// With the `agentsView` option on, a ⇄ button swaps the row for a progress bar
// of the session's subagents, and ×N opens a live panel of them (/agents-info
// too). Both are adapted from savvy-progress by johnnyvizz (MIT).

const LOW_AT = 15
/** How often the band redraws, so the countdown and the warm-to-cold flip stay current. */
const TICK_MS = 30_000

const windows = atom({ plugin: 'ribbon', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'ribbon', key: 'cache' } as const, null as CacheFacts | null)
const fold = atom({ plugin: 'ribbon', key: 'fold' } as const, null as Fold | null)
// The ⇄ button swaps the whole row for savvy-progress's agents bar. The choice is
// kept in $.store too, so the next session opens on the same view.
const viewMode = atom({ plugin: 'ribbon', key: 'mode' } as const, 'usage' as ViewMode)
// Every subagent of the session, as savvy-progress tracks them: the band counts
// the latest wave, the agents pane lists them all.
const agents = atom({ plugin: 'ribbon', key: 'agents' } as const, [] as AgentRun[])
const panel = atom({ plugin: 'ribbon', key: 'panel' } as const, { isCompact: false, isDoneCollapsed: false } as AgentsPanel)
/** The pane's clock, ticked each second while a subagent runs. */
const paneNow = atom({ plugin: 'ribbon', key: 'now' } as const, 0)
const MODE_KEY = 'mode'
const PANE = 'ribbon-agents'

const crewViewOf = (all: readonly AgentRun[]): CrewView => {
  const wave = Math.max(0, ...all.map(a => a.wave))
  const list = all.filter(a => a.wave === wave)
  const running = list.filter(r => r.status === 'running')
  return {
    // One subagent at work names the row; otherwise the generic title.
    title: running.length === 1 ? running[0]!.description || 'Subagent' : 'Subagents',
    done: list.filter(r => r.status !== 'running').length,
    running: running.length,
    total: list.length,
  }
}

// Workflows come from the progress-board mod when it is installed, whose state any
// plugin may read: the band adds each running workflow's agents to the wave.
type BoardWorkflow = { name: string; status: string; startedAt?: number; agents: { status: string }[]; agentCount?: number }
const boardWorkflows = { plugin: 'progress-board', key: 'workflows' } as const
const WORKFLOW_SUBAGENT = 'workflow-subagent'

const crewWithWorkflows = (all: readonly AgentRun[], flows: readonly BoardWorkflow[]): CrewView => {
  const live = flows.filter(w => w.status === 'running')
  if (live.length === 0) return crewViewOf(all)
  // progress-board already counts the live workflows' agents, so the band's own runs of
  // them are left out; runs from workflows that finished earlier still count.
  const since = Math.min(...live.map(w => w.startedAt ?? 0))
  const c = crewViewOf(all.filter(a => a.type !== WORKFLOW_SUBAGENT || a.startedAt < since))
  const inner = live.flatMap(w => w.agents)
  const running = inner.filter(a => a.status === 'running').length
  // agentCount also counts the agents a workflow has not spawned yet.
  const planned = live.reduce((n, w) => n + Math.max(w.agents.length, w.agentCount ?? 0), 0)
  return {
    title: live.length === 1 && c.running === 0 ? live[0]!.name || 'Workflow' : 'Agents · workflows',
    done: c.done + inner.length - running,
    running: c.running + running,
    total: c.total + planned,
  }
}

const readBoardWorkflows = async ($: EngineInterface): Promise<BoardWorkflow[]> => {
  try {
    const { value } = await ($.state.get as (ref: unknown) => Promise<{ value?: unknown }>)(boardWorkflows)
    return Array.isArray(value) ? (value as BoardWorkflow[]) : []
  } catch {
    return []
  }
}

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND', context: 'CTX' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1, context: 2 }
const COLORS: Record<string, string> = { seven_day: ORANGE, five_hour: YELLOW, context: VIOLET }
/** The same as theme keys, for text: raw yellow is unreadable on a light background. */
const T_COLORS: Record<string, ThemeKey> = { seven_day: 'claude', five_hour: 'warning', context: 'permission' }

/** The context window drawn as one more gauge: what is left before it fills up. */
const contextWindow = (c: CacheFacts | null): Window | null =>
  c && c.tokens > 0 && c.window > 0 ? { kind: 'context', percentUsed: Math.min(100, (c.tokens / c.window) * 100) } : null

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

// One row at every width: when room runs out the band drops pieces in a fixed
// order instead of stacking (Robo, the cold idle time, the reset times, the
// bars, the cache tail). Never dropped: each window's percent, the
// WARM / COLD word, the fold button.
/** CSS px on desktop, measured on captures: text ~7.5 a character. */
const DRAWN_PX = { char: 7.5, gap: 17, pad: 20, button: 34, wordButton: 64, sep: 16, swap: 34, wordSwap: 84 }
/** The terminal is a grid of 12 px columns. */
const GRID_PX = { char: 12, gap: 24, pad: 24, button: 0, wordButton: 0, sep: 0, swap: 0, wordSwap: 0 }
/** Desktop counts the band's columns in the code font's advance, ~8.65 px. */
const DRAWN_COLUMN_PX = 8.65
/** The widest a stretched bar gets; past this the free room stays as spacing. */
const BAR_MAX = 180
/** Better to drop a piece a little early than to clip the right edge. */
const SAFETY = 1.08
/** Dots per bar in the terminal, where the bar is text. */
const TERM_CELLS = 5
const BAR_H = 10

// The first tier is the roomy one: "left" after each figure, longer bars and a
// Show / Hide button in words. The rest are the compact steps down.
type Tier = { robo: boolean; idle: boolean; resets: boolean; bar: number; tail: boolean; words?: boolean }
const TIERS: Tier[] = [
  { robo: true, idle: true, resets: true, bar: 130, tail: true, words: true },
  { robo: true, idle: true, resets: true, bar: 112, tail: true },
  { robo: false, idle: false, resets: true, bar: 112, tail: true },
  { robo: false, idle: false, resets: false, bar: 112, tail: true },
  { robo: false, idle: false, resets: false, bar: 52, tail: true },
  { robo: false, idle: false, resets: false, bar: 0, tail: true },
  { robo: false, idle: false, resets: false, bar: 0, tail: false },
]

const leftOf = (w: Window): number => Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)

/** Reset time without inner spaces: 1d18h, 4h50m, 2h, 50m, now. */
const fmtShort = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'now'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return mins % 60 ? `${hours}h${mins % 60}m` : `${hours}h`
  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

/** The cache's words after the chip, for a tier: warm minutes, or cold idle and price. */
const tailOf = (v: CacheView, t: Tier): string => {
  if (!t.tail) return ''
  if (v.mode === 'warm') return ` ${Math.max(0, TTL_MIN - v.idleMin)}m${t.words ? ' left' : ''}`
  const mine = mineModel(v)
  const price = mine ? usd(costOf(mine, v.mode, v.tokens)) : ''
  return price ? (t.idle ? ` ${v.idle} ${price}` : ` ${price}`) : ` ${v.idle}`
}

/** The first tier whose one row fits the band, and the room it leaves over (px). */
const tierOf = (columns: number, list: readonly Window[], view: CacheView | null, drawn: boolean, now: number, swap: boolean): { tier: Tier; spare: number } => {
  const m = drawn ? DRAWN_PX : GRID_PX
  const room = columns * (drawn ? DRAWN_COLUMN_PX : 12)
  const text = (t: string) => t.length * m.char
  for (const t of TIERS) {
    const bar = t.bar === 0 ? 0 : drawn ? t.bar : TERM_CELLS * m.char
    const wins = list.reduce((n, w) => {
      const reset = t.resets ? fmtShort(w.resetsAt, now) : ''
      return n + text(`${NAMES[w.kind] ?? w.kind} `) + bar + text(` ${leftOf(w)}%${t.words ? ' left' : ''}`) + (reset ? text(` ${reset}`) : 0) + m.gap
    }, 0)
    const cache = !view ? 0
      : (drawn && t.robo ? ROBO_SIZE + 6 : 0) +
        (drawn ? chipSvg(view.mode).w : text(` ${WORD[view.mode]} `)) +
        text(tailOf(view, t)) + m.gap
    const seps = (list.length + (view ? 1 : 0) - 1) * m.sep
    const need = m.pad + wins + cache + seps + (view ? (t.words ? m.wordButton : m.button) : 0) + (swap ? (t.words ? m.wordSwap : m.swap) : 0)
    if (need * SAFETY <= room) return { tier: t, spare: room - need * SAFETY }
  }
  return { tier: TIERS[TIERS.length - 1]!, spare: 0 }
}

/**
 * A stepped gauge: ten segments (five on narrow tiers), one per 10% (or 20%), so
 * the eye can count what is left. A step that is only partly left lights up
 * dimmer, in proportion, rather than as a thin sliver.
 */
const barSvg = (left: number, color: string, w: number): string => {
  const n = w >= 80 ? 10 : 5
  const gap = 3
  const seg = (w - (n - 1) * gap) / n
  const lit = (Math.max(0, Math.min(100, left)) / 100) * n
  let body = ''
  for (let i = 0; i < n; i++) {
    const x = +(i * (seg + gap)).toFixed(2)
    const part = Math.max(0, Math.min(1, lit - i))
    body += `<rect x="${x}" width="${seg.toFixed(2)}" height="${BAR_H}" rx="2.5" fill="${EMPTY}"/>`
    if (part >= 1) body += `<rect x="${x}" width="${seg.toFixed(2)}" height="${BAR_H}" rx="2.5" fill="${color}"/>`
    else if (part > 0) body += `<rect x="${x}" width="${seg.toFixed(2)}" height="${BAR_H}" rx="2.5" fill="${color}" fill-opacity="${Math.max(0.25, part).toFixed(2)}"/>`
  }
  return svgDoc(w, BAR_H, body, false)
}

const dots = (left: number, cells: number): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
}

/** What the cache drawings read, or null until a request and its context size are known. */
export const viewOf = (c: CacheFacts | null, now: number): CacheView | null => {
  if (!c || c.lastAt <= 0 || c.tokens <= 0) return null
  const idleMs = Math.max(0, now - c.lastAt)
  return {
    mode: idleMs >= TTL_MS ? 'cold' : 'warm',
    idle: fmtIdle(idleMs),
    idleMin: Math.floor(idleMs / 60000),
    tokens: c.tokens,
    window: c.window,
    mine: familyOf(c.model),
  }
}

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  await update($, windows, () => clean(u.rateLimits))
}

/** Fresh context figures from the engine onto the cache facts, when it has them. */
const measure = async ($: EngineInterface, lastAt: number | null, model: string | null): Promise<void> => {
  const u = await $.session.usage()
  const m = model ?? (await $.session.model())
  await update($, cache, c => ({
    lastAt: lastAt ?? c?.lastAt ?? 0,
    tokens: u.context.tokens && u.context.tokens > 0 ? u.context.tokens : (c?.tokens ?? 0),
    window: u.context.window || c?.window || 0,
    model: m || c?.model || null,
  }))
}

// Opens the agents pane, or closes it when it is up; true when it ends up open.
async function togglePane($: EngineInterface): Promise<boolean> {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (isOpen) {
    await $.ui.close({ id: PANE })
    return false
  }
  const at = await $.clock.now()
  await update($, paneNow, () => at)
  await $.ui.open({ id: PANE, title: 'Agents' })
  return true
}

export const register: Register = (on, options) => {
  // The agents view is opt-in: off, the band is the usage row alone, with no ⇄,
  // no /agents-info and no subagent tracking.
  const agentsOn = options.agentsView === 'on'

  on('session.start', async ($, e, next) => {
    await pull($)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    if (!agentsOn) return next(e)
    const saved = await $.store.get(MODE_KEY)
    if (saved === 'usage' || saved === 'agents') await update($, viewMode, () => saved)
    await $.command.register({
      name: 'agents-info',
      description: 'Show or hide the panel of subagents: running and finished, with model, context, cost and time',
    })
    // Ticks the running agents' clocks; quiet when nothing runs.
    $.clock.every(1000, () => {
      void (async () => {
        const list = await read($, agents)
        if (!list.some(a => a.status === 'running')) return
        const at = await $.clock.now()
        await update($, paneNow, () => at)
      })()
    })
    return next(e)
  })

  if (agentsOn) {
    on('command.run', { command: 'agents-info' }, async ($, e) => {
      if ((e.args ?? '').trim() === 'open') {
        const at = await $.clock.now()
        await update($, paneNow, () => at)
        await $.ui.open({ id: PANE, title: 'Agents' })
        return { text: 'Agents panel opened.' }
      }
      return { text: (await togglePane($)) ? 'Agents panel opened.' : 'Agents panel closed.' }
    })

    // Subagents feed the agents bar and pane. A spawn with nothing running starts a new wave.
    on('agent.spawn', async ($, e, next) => {
      const started = await next(e)
      // A workflow's remote agent has no agentId and no loop to report its end: not tracked.
      const agentId = started.agentId
      if (started.deny !== undefined || !agentId) return started
      const at = await $.clock.now()
      await update($, agents, list => {
        const last = Math.max(0, ...list.map(a => a.wave))
        const wave = list.some(a => a.status === 'running') ? last : last + 1
        const round = 1 + list.filter(a => e.description && a.description === e.description).length
        const run: AgentRun = {
          id: agentId,
          agentId,
          type: e.subagentType,
          description: e.description,
          model: started.model,
          status: 'running',
          startedAt: at,
          contextTokens: 0,
          contextMax: windowOf(started.model),
          tokens: 0,
          costUsd: 0,
          steps: 0,
          round,
          wave,
        }
        return [...list.filter(a => a.id !== run.id), run].slice(-200)
      })
      await update($, paneNow, () => at)
      return started
    })
  }

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      await update($, windows, () => clean(e.rateLimits))
    }
    if (e.changed.includes('context') && e.context.tokens && e.context.tokens > 0) {
      const tokens = e.context.tokens
      await update($, cache, c => (c ? { ...c, tokens, window: e.context.window || c.window } : c))
    }
    return next(e)
  })

  // A resumed or forked session knows how long it was away and how big it is.
  on('classic.SessionStart', async ($, e, next) => {
    const r = await next(e)
    if (e.source === 'clear' || e.source === 'compact') {
      await update($, cache, () => null)
      await update($, fold, () => null)
      // A compaction keeps the session's subagents; only a clear starts the list over.
      if (agentsOn && e.source === 'clear') await update($, agents, () => [])
    } else if ((e.source === 'resume' || e.source === 'fork') && typeof e.seconds_since_last_response === 'number') {
      const now = await $.clock.now()
      const lastAt = now - e.seconds_since_last_response * 1000
      const window = (await $.session.usage()).context.window
      const model = typeof e.model === 'string' ? e.model : await $.session.model()
      const tokens = typeof e.context_tokens === 'number' ? e.context_tokens : 0
      await update($, cache, () => ({ lastAt, tokens, window, model }))
    }
    return r
  }).catch(($, e, next) => next(e)) // a band that fails to seed never holds up the session

  // Each main-thread request reads or writes the cache, so its start resets the hour.
  // A subagent's request instead updates its pane row: live context, tokens and cost.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null }))
    }
    const result = yield* next(e)
    const agentId = e.agentId
    const usage = result.usage
    if (!agentsOn || !agentId || !usage) return result
    const model = usage.model || e.model
    // The context is what the request sent; the run's tokens also count what it wrote.
    const prompt = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0)
    const sent = prompt + (usage.output_tokens || 0)
    await update($, agents, list =>
      list.map((a): AgentRun =>
        a.agentId !== agentId
          ? a
          : {
              ...a,
              model,
              effort: typeof e.effort === 'string' ? e.effort : a.effort,
              status: 'running',
              endedAt: undefined,
              contextTokens: prompt,
              contextMax: windowOf(model),
              tokens: a.tokens + sent,
              costUsd: a.costUsd + runCost(model, usage, true),
              steps: a.steps + 1,
            },
      ),
    )
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) {
      if (!agentsOn) return r
      const agentId = e.agentId
      const at = await $.clock.now()
      const u = e.usage
      await update($, agents, list =>
        list.map((a): AgentRun => {
          if (a.agentId !== agentId) return a
          const ended: AgentRun = { ...a, status: e.reason === 'answer' ? 'done' : 'failed', endedAt: at }
          // A run whose steps went unseen still gets the turn's own sum.
          if (a.steps > 0 || !u) return ended
          return {
            ...ended,
            model: u.model || a.model,
            tokens: u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
            costUsd: runCost(u.model || a.model, u, false),
          }
        }),
      )
      await update($, paneNow, () => at)
      return r
    }
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    await measure($, lastAt, e.usage?.model ?? null)
    return r
  })

  if (agentsOn) {
    // The agents pane, savvy-progress's live panel: every subagent of the session.
    on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
      const ui = $.ui.resolve(e)
      const { Box, Text, Button } = ui
      const list = await read($, agents)
      const p = await read($, panel)
      const at = Math.max(await read($, paneNow), ...list.map(a => a.startedAt), 0)
      const running = list.filter(a => a.status === 'running').reverse()
      const finished = list.filter(a => a.status !== 'running').reverse()
      const t = totals(list, at)
      const summary = `≈${fmtCost(t.cost)}, ${fmtTokens(t.tokens)} tokens, ${fmtTime(t.time)}`

      const toggleCompact = (
        <Button key="compact" label={p.isCompact ? 'Expand' : 'Collapse'} plain
          onPress={() => update($, panel, prev => ({ ...prev, isCompact: !prev.isCompact }))} />
      )
      const toggleDone = (
        <Button key="done" label={`${p.isDoneCollapsed ? '▸' : '▾'} Finished · ${finished.length}`} plain
          onPress={() => update($, panel, prev => ({ ...prev, isDoneCollapsed: !prev.isDoneCollapsed }))} />
      )

      if (e.surface === 'desktop' && 'Svg' in ui) {
        const { Svg } = ui
        const W = Math.max(240, Math.min(900, (e.props.bodyColumns || 40) * 8 - 8))
        if (p.isCompact) {
          return (
            <Box flexDirection="column" gap={1}>
              <Svg source={compactSvg(W, list, t)} alt={`${list.length} agents, ${summary}`} width={W} height={COMPACT_H} />
              {toggleCompact}
            </Box>
          )
        }
        const shownDone = p.isDoneCollapsed ? 0 : finished.length
        const lines = 1 + (list.length === 0 ? 1 : 0) + (running.length > 0 ? 1 : 0) + (finished.length > 0 ? 1 : 0)
        const gridH = HEADER_H + lines * LINE_H + (running.length + shownDone) * AGENT_ROW_H
        return (
          <Box flexDirection="column">
            {/* The grid sizes the pane; the content is laid over it. */}
            {gridTiles(gridH).map((tileH, i) => (
              <Svg key={`grid-${i}`} source={gridSvg(W, tileH)} alt="dotted grid" width={W} height={tileH} />
            ))}
            <Box flexDirection="column" position="absolute" top={0} left={0} right={0}>
              <Svg source={headerSvg(W, t)} alt={summary} width={W} height={HEADER_H} />
              {toggleCompact}
              {list.length === 0 && <Text dimColor>No subagents yet.</Text>}
              {running.length > 0 && <Text key="h-run" dimColor>{`Running · ${running.length}`}</Text>}
              {running.map(a => (
                <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, running`} width={W} height={AGENT_ROW_H} />
              ))}
              {finished.length > 0 && toggleDone}
              {!p.isDoneCollapsed && finished.map(a => (
                <Svg key={a.id} source={agentSvg(W, a, at)} alt={`${a.description}: ${modelName(a.model)}, finished`} width={W} height={AGENT_ROW_H} />
              ))}
            </Box>
          </Box>
        )
      }

      // Terminal: the same content in text rows.
      const cols = Math.max(24, e.props.bodyColumns || 40)
      const barW = Math.max(6, Math.min(20, cols - 34))
      const row = (a: AgentRun) => {
        const tier = tierOfType(a.type)
        const color = colorOf(tier)
        const ctx = ctxOf(a)
        return (
          <Box key={a.id} flexDirection="column" marginBottom={1}>
            <Box flexDirection="row" gap={1}>
              <Text color={color}>▣</Text>
              <Text bold wrap="truncate-end">{a.description || a.type}</Text>
              <Text color={a.status === 'failed' ? 'red' : a.status === 'done' ? 'green' : color}>{STATUS_GLYPH[a.status]}</Text>
            </Box>
            <Text dimColor wrap="truncate-end">
              {'  '}{tier === 'other' ? a.type : tier} · {runModel(a)}{a.round > 1 ? ` · round ${a.round}` : ''}
            </Text>
            <Text wrap="truncate-end">
              {'  '}
              {a.status === 'done' ? <Text color={color}>{ctxBar(100, barW)}</Text> : <Text dimColor>{ctxBar(ctx, barW)}</Text>}
              <Text dimColor>{` ctx ${ctx}% · ${fmtTokens(a.contextTokens)} ≈${fmtCost(a.costUsd)} ${fmtTime(elapsed(a, at))}`}</Text>
            </Text>
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>{`≈${fmtCost(t.cost)} · ${fmtTokens(t.tokens)} tokens · ${fmtTime(t.time)}`}</Text>
            {toggleCompact}
          </Box>
          {p.isCompact ? (
            <Text wrap="truncate-end">
              {[...running, ...finished].map(a => (
                <Text key={a.id} color={colorOf(tierOfType(a.type))}>{`${STATUS_GLYPH[a.status]} `}</Text>
              ))}
            </Text>
          ) : (
            <Box flexDirection="column" marginTop={1}>
              {list.length === 0 && <Text dimColor>No subagents yet.</Text>}
              {running.length > 0 && <Text dimColor>{`Running · ${running.length}`}</Text>}
              {running.map(row)}
              {finished.length > 0 && toggleDone}
              {!p.isDoneCollapsed && finished.map(row)}
            </Box>
          )}
        </Box>
      )
    })
  }

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
    // Ask the surface, not the table: the terminal's table still lists Svg.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const facts = await read($, cache)
    const ctxWin = contextWindow(facts)
    const list = ctxWin ? clean([...(await read($, windows)), ctxWin]) : await read($, windows)
    const now = await $.clock.now()
    const view = viewOf(facts, now)
    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100

    // The ⇄ button: desktop only, like the fold button, so the terminal always shows usage.
    const hasSwap = Svg !== null && agentsOn
    const shown: ViewMode = hasSwap ? await read($, viewMode) : 'usage'
    const swapTo = async (to: ViewMode) => {
      await update($, viewMode, () => to)
      await $.store.set(MODE_KEY, to)
    }
    const swapButton = (to: ViewMode, words: boolean, gapAfter: boolean) => (
      <Box key="swap" flexShrink={0} marginRight={gapAfter ? 1 : 0}>
        <Button key="ribbon-swap" label={words ? (to === 'agents' ? '⇄ Agents' : '⇄ Usage') : '⇄'} onPress={() => swapTo(to)} />
      </Box>
    )

    if (Svg && shown === 'agents') {
      const c = crewWithWorkflows(await read($, agents), await readBoardWorkflows($))
      const count = `×${c.total}`
      const room = columns * DRAWN_COLUMN_PX
      const words = room >= 520
      const others = DRAWN_PX.pad + (words ? DRAWN_PX.wordSwap : DRAWN_PX.swap) + count.length * DRAWN_PX.char + 2 * DRAWN_PX.gap
      const W = Math.max(180, Math.min(1000, Math.floor((room - others) / SAFETY)))
      return (
        <Box flexDirection="row" paddingX={1} alignItems="center">
          <Box key="crew-row" flexShrink={0}>
            <Svg source={crewRowSvg(c, W)} alt={`${c.title}: ${crewLabel(c)}, ${crewPercent(c)}`} width={W} height={ROW_H} />
          </Box>
          <Box key="sp-end" flexGrow={1} />
          <Box key="crew-count" flexShrink={0} marginRight={1}>
            <Button key="ribbon-agents" label={count} plain onPress={() => void togglePane($)} />
          </Box>
          {swapButton('usage', words, false)}
        </Box>
      )
    }

    if (list.length === 0 && !view) {
      return (
        <Box paddingX={1}>
          <Text color={T_MUTED}>USAGE · waiting for the first reply</Text>
        </Box>
      )
    }

    const drawn = Svg !== null
    const { tier, spare } = tierOf(columns, list, view, drawn, now, hasSwap)
    // Half the room left over goes to the bars, so the row fills the band instead
    // of leaving wide gaps; the other half stays as spacing between the groups.
    const barW = tier.bar > 0 && drawn && list.length > 0
      ? Math.min(BAR_MAX, Math.max(tier.bar, Math.floor(tier.bar + spare / 2 / list.length)))
      : tier.bar

    const win = (w: Window, i: number) => {
      const left = leftOf(w)
      const col = COLORS[w.kind] ?? TEXT
      const reset = tier.resets ? fmtShort(w.resetsAt, now) : ''
      const pct = `${left}%`
      const pctText = tier.words ? `${pct} left` : pct
      let bar = null
      if (tier.bar > 0) {
        if (Svg) {
          bar = [<Svg key="bar" source={barSvg(left, col, barW)} alt={`${pct} left`} width={barW} height={BAR_H} />]
        } else {
          const d = dots(left, TERM_CELLS)
          bar = [<Text key="on" color={T_COLORS[w.kind] ?? T_TEXT}>{d.on}</Text>, <Text key="off" color={T_EMPTY}>{d.off}</Text>]
        }
      }
      return (
        <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={2} alignItems="center">
          <Text color={T_MUTED} bold>{`${NAMES[w.kind] ?? w.kind} `}</Text>
          {bar}
          {left < LOW_AT
            ? [<Text key="sp"> </Text>, <Text key="pct" backgroundColor={HUE.warm} color={TEXT} bold>{` ${pctText} `}</Text>]
            : <Text color={T_COLORS[w.kind] ?? T_TEXT} bold>{` ${pctText}`}</Text>}
          {reset ? <Text color={T_MUTED}>{` ${reset}`}</Text> : null}
        </Box>
      )
    }

    // The room left over is shared between the groups, so they sit evenly across
    // the band instead of bunching up on the left with a gap before the button.
    // On desktop a small dot sits in the middle of each gap between groups.
    const between = (k: number): RenderChildren[] =>
      Svg
        ? [
            <Box key={`sp-a-${k}`} flexGrow={1} />,
            <Box key={`sep-${k}`} flexShrink={0} marginRight={1}>
              <Text color={T_MUTED}>•</Text>
            </Box>,
            <Box key={`sp-b-${k}`} flexGrow={1} />,
          ]
        : [<Box key={`sp-${k}`} flexGrow={1} />]
    const spread = (groups: RenderChildren[], end?: RenderChildren): RenderChildren[] => [
      ...groups.filter(Boolean).flatMap((el, i) => (i === 0 ? [el] : [...between(i), el])),
      ...(end ? [<Box key="sp-end" flexGrow={1} />, end] : []),
    ]

    const usage = list.length > 0
      ? list.map(win)
      : [<Box key="wait" flexShrink={0} marginRight={2}><Text color={T_MUTED}>waiting for the first reply</Text></Box>]

    // Before the first reply there is no cache to show, and nothing to fold.
    if (!view) {
      return (
        <Box flexDirection="row" paddingX={1} alignItems="center">
          {spread(usage, hasSwap ? swapButton('agents', tier.words === true, false) : undefined)}
        </Box>
      )
    }

    const mode = view.mode
    const cold = mode === 'cold'
    const hue = HUE[mode]
    const stored = await read($, fold)
    // Folding needs the card, and the card is a drawing: the terminal stays folded.
    const open = Svg !== null && (stored && stored.mode === mode ? stored.open : cold)
    const toggle = () =>
      update($, fold, f => ({ mode, open: !(f && f.mode === mode ? f.open : mode === 'cold') }))

    // On desktop the chip is always the rounded drawing: a text background can't be rounded.
    const chip = Svg
      ? (() => {
          const c = chipSvg(mode)
          return <Svg key="chip" source={c.source} alt={WORD[mode]} width={c.w} height={c.h} />
        })()
      : <Text key="chip" backgroundColor={hue} color={INK} bold>{` ${WORD[mode]} `}</Text>
    const tail = tailOf(view, tier)
    const mine = mineModel(view)
    const price = cold && mine ? usd(costOf(mine, mode, view.tokens)) : ''
    const tailEl = !tail ? null
      : cold && price
        ? [
            tail.trim() !== price ? <Text key="idle" color={T_HUE[mode]} bold>{tail.slice(0, tail.length - price.length)}</Text> : <Text key="sp"> </Text>,
            <Text key="price" color={T_TEXT} bold>{price}</Text>,
          ]
        : <Text key="tail" color={T_HUE[mode]} bold>{tail}</Text>

    const cacheEl = (
      <Box key="cache" flexDirection="row" flexShrink={0} marginRight={2} alignItems="center">
        {Svg && tier.robo
          ? [<Svg key="robo" source={roboSvg(mode)} alt={cold ? 'Robo, frozen' : 'Robo, bobbing'} width={ROBO_SIZE} height={ROBO_SIZE} isInteractive />, <Text key="gap"> </Text>]
          : null}
        {chip}
        {tailEl}
      </Box>
    )

    // ⇄ sits just before the fold button, which still closes the row.
    const button = Svg ? (
      <Box key="end" flexDirection="row" flexShrink={0} alignItems="center">
        {hasSwap ? swapButton('agents', tier.words === true, true) : null}
        <Box key="fold" flexShrink={0}>
          <Button key="cache-fold" label={tier.words ? (open ? 'Hide ▴' : 'Show ▾') : open ? '▴' : '▾'} onPress={toggle} />
        </Box>
      </Box>
    ) : null

    const row = (
      <Box key="row" flexDirection="row" paddingX={1} alignItems="center">
        {spread([...usage, cacheEl], button)}
      </Box>
    )

    let card = null
    if (open && Svg) {
      // The card is drawn at the band's real width: desktop columns are ~8.65 px.
      const W = Math.floor(columns * DRAWN_COLUMN_PX)
      const cardKind = W >= 1000 ? 'wide' : W >= 620 ? 'stacked' : 'tight'
      const c = cardSvg(view, cardKind, W)
      card = (
        <Box key="card" flexDirection="row">
          <Svg source={c.source} alt={c.alt} width={c.w} height={c.h} isInteractive={cardKind !== 'tight'} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {row}
        {card}
      </Box>
    )
  })
}
