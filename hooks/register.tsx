import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Fold, Keepwarm, Window } from '../types'
import {
  HUE, INK, ORANGE, ROBO_SIZE, TTL_MIN, TTL_MS, WORD, YELLOW,
  bandPx, cardSvg, chipSvg, costOf, familyOf, fmtIdle, kindOf, mineModel, roboSvg, rowKindOf, usd,
} from './cache-art'
import type { CacheView } from './cache-art'

// A band above the prompt in a warm dark look: card surface, cream text,
// dot-matrix bars. Shows how much of each usage window is LEFT, 7-day first, then
// 5-hour; 7D is orange, 5H is yellow; a window under 15% adds a bold LOW.
//
// After the first reply it also shows the prompt cache: WARM (red, Robo bobbing)
// for an hour after the last request, then COLD (blue, Robo frozen) with what the
// next message costs to re-cache. Hide / Show folds the card; warm starts folded,
// cold starts open, and a choice holds until the cache flips. Zero token cost:
// it reads the engine's own figures and draws.

const CELLS = 10
const LOW_AT = 15
const TIGHT_CELLS = 6
/** How often the band redraws, so the countdown and the warm-to-cold flip stay current. */
const TICK_MS = 30_000
/** How often the keepwarm state is read, so a /keepwarm shows up within seconds. */
const KEEPWARM_POLL_MS = 3_000

const windows = atom({ plugin: 'ribbon', key: 'windows' } as const, [] as Window[])
const cache = atom({ plugin: 'ribbon', key: 'cache' } as const, null as CacheFacts | null)
const fold = atom({ plugin: 'ribbon', key: 'fold' } as const, null as Fold | null)
const keepwarm = atom({ plugin: 'ribbon', key: 'keepwarm' } as const, null as Keepwarm | null)

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }
const COLORS: Record<string, string | undefined> = { seven_day: ORANGE, five_hour: YELLOW }

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

const dots = (left: number, cells: number): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  return { on: '●'.repeat(n), off: '·'.repeat(cells - n) }
}

const fmtReset = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (Number.isNaN(ms)) return ''
  if (ms <= 0) return 'resetting'
  const mins = Math.round(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ${mins % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
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

/** The keepwarm line, or null where the cache-tax mod is not installed (no `$.cacheTax`) or not answering. */
const peekKeepwarm = async ($: EngineInterface): Promise<boolean> => {
  let next: Keepwarm | null = null
  try {
    const s = await $.cacheTax.status()
    next = { state: s.keepwarm, leftMs: s.leftMs }
  } catch {
    // an absent or failing provider just means no keepwarm line
  }
  const before = await read($, keepwarm)
  const changed = (before ? keepwarmText(before) : null) !== (next ? keepwarmText(next) : null)
  await update($, keepwarm, () => next)
  return changed
}

/** The band's keepwarm text, e.g. `keepwarm 2h 10m left`. */
export const keepwarmText = (k: Keepwarm): string =>
  k.state === 'on' ? `keepwarm ${fmtIdle(k.leftMs)} left` : `keepwarm ${k.state}`

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

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await pull($)
    await peekKeepwarm($)
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    // /keepwarm changes the state between ticks; the status call is in-process, so a short poll redraws only on a change.
    $.clock.every(KEEPWARM_POLL_MS, async () => {
      if (await peekKeepwarm($)) $.ui.invalidate('ui.render')
    })
    return next(e)
  })

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
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const now = await $.clock.now()
      await update($, cache, c => ({ lastAt: now, tokens: c?.tokens ?? 0, window: c?.window ?? 0, model: c?.model ?? null }))
    }
    yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r
    const now = await $.clock.now()
    const c = await read($, cache)
    // turn.step stamps the exact request time; when no step of this turn did, the turn's end is the floor.
    const lastAt = !c || now - c.lastAt > e.durationMs ? now : c.lastAt
    await measure($, lastAt, e.usage?.model ?? null)
    await peekKeepwarm($)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
    // Ask the surface, not the table: the terminal's table still lists Svg.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    const list = await read($, windows)
    const now = await $.clock.now()
    const view = viewOf(await read($, cache), now)
    const kw = await read($, keepwarm)

    if (list.length === 0 && !view) {
      return (
        <Box paddingX={1}>
          <Text dimColor>USAGE · waiting for the first reply</Text>
        </Box>
      )
    }

    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    // The card's layout follows the band's width; the row's also counts the cache block it carries.
    const kind = kindOf(columns)
    const layout = rowKindOf(columns, view !== null)
    const isWide = layout === 'wide'
    const cells = layout === 'tight' ? TIGHT_CELLS : CELLS

    const parts = (w: Window) => {
      const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
      return {
        left,
        col: COLORS[w.kind],
        name: NAMES[w.kind] ?? w.kind.toUpperCase(),
        d: dots(left, cells),
        reset: fmtReset(w.resetsAt, now),
      }
    }

    // Wide: every window on one row. Narrow: each window is a block of three
    // lines (name and dots, percent left, reset time) so nothing wraps or clips.
    const wide = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={3}>
          <Text dimColor bold>{p.name} </Text>
          <Text color={p.col}>{p.d.on}</Text>
          <Text dimColor>{p.d.off}</Text>
          <Text color={p.col} bold> {p.left}% left</Text>
          {p.left < LOW_AT ? <Text bold> LOW</Text> : null}
          {p.reset ? <Text dimColor> · {p.reset}</Text> : null}
        </Box>
      )
    }

    const stacked = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="column" flexShrink={0} marginRight={3}>
          <Box flexDirection="row">
            <Text dimColor bold>{p.name} </Text>
            <Text color={p.col}>{p.d.on}</Text>
            <Text dimColor>{p.d.off}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color={p.col} bold>{p.left}% left</Text>
            {p.left < LOW_AT ? <Text bold> LOW</Text> : null}
          </Box>
          {p.reset ? <Text dimColor>resets {p.reset}</Text> : null}
        </Box>
      )
    }

    const label = (
      <Box key="label" flexShrink={0} marginRight={isWide ? 2 : 3}>
        <Text bold>USAGE</Text>
      </Box>
    )
    const usage = list.length > 0
      ? list.map(isWide ? wide : stacked)
      : [<Box key="wait" flexShrink={0} marginRight={3}><Text dimColor>waiting for the first reply</Text></Box>]

    // Before the first reply there is no cache to show: today's band, as it was.
    if (!view) {
      return (
        <Box flexDirection="row" paddingX={1}>
          {label}
          {usage}
        </Box>
      )
    }

    const mode = view.mode
    const cold = mode === 'cold'
    const hue = HUE[mode]
    const mine = mineModel(view)
    const stored = await read($, fold)
    // Folding needs the card, and the card is a drawing: the terminal stays folded.
    const open = Svg !== null && (stored && stored.mode === mode ? stored.open : cold)
    const toggle = () =>
      update($, fold, f => ({ mode, open: !(f && f.mode === mode ? f.open : mode === 'cold') }))

    const badge = Svg
      ? [
          <Svg key="robo" source={roboSvg(mode)} alt={cold ? 'Robo, frozen' : 'Robo, bobbing'} width={ROBO_SIZE} height={ROBO_SIZE} isInteractive />,
          <Text key="gap"> </Text>,
          (() => {
            const c = chipSvg(mode)
            return <Svg key="chip" source={c.source} alt={WORD[mode]} width={c.w} height={c.h} />
          })(),
        ]
      : [<Text key="chip" backgroundColor={hue} color={INK} bold>{` ${WORD[mode]} `}</Text>]

    const summary = cold
      ? [
          <Text key="idle" color={hue} bold>{` ${view.idle}`}</Text>,
          mine ? <Text key="dot" dimColor> · </Text> : null,
          mine ? <Text key="cost" bold>{usd(costOf(mine, mode, view.tokens))}</Text> : null,
        ]
      : [<Text key="left" color={hue} bold>{` ${Math.max(0, TTL_MIN - view.idleMin)}m left`}</Text>]

    const button = Svg ? (
      <Box key="fold" flexShrink={0} alignItems="flex-start">
        <Button key="cache-fold" label={open ? 'Hide' : 'Show'} onPress={toggle} />
      </Box>
    ) : null
    const grow = <Box key="grow" flexGrow={1} />

    let rows
    if (layout === 'wide') {
      rows = (
        <Box key="row" flexDirection="row" paddingX={1} alignItems="center">
          {label}
          {usage}
          {open ? null : (
            <Box key="inline" flexDirection="row" flexShrink={0} marginRight={2} alignItems="center">
              {badge}
              {summary}
            </Box>
          )}
          {kw ? <Box key="kw" flexShrink={0} marginRight={2}><Text dimColor>{keepwarmText(kw)}</Text></Box> : null}
          {grow}
          {button}
        </Box>
      )
    } else if (layout === 'stacked') {
      // The cache becomes a third stacked block, the same shape as 7D and 5H.
      rows = (
        <Box key="row" flexDirection="row" paddingX={1}>
          {label}
          {usage}
          {open ? null : (
            <Box key="block" flexDirection="column" flexShrink={0} marginRight={2}>
              <Box flexDirection="row" alignItems="center">{badge}</Box>
              <Text color={hue} bold>{cold ? `${view.idle} idle` : `${Math.max(0, TTL_MIN - view.idleMin)}m left`}</Text>
              {mine ? (
                <Box flexDirection="row">
                  <Text bold>{usd(costOf(mine, mode, view.tokens))}</Text>
                  <Text dimColor> next</Text>
                </Box>
              ) : null}
            </Box>
          )}
          {kw ? (
            <Box key="kw" flexDirection="column" flexShrink={0} marginRight={2}>
              <Text dimColor>keepwarm</Text>
              <Text bold>{kw.state === 'on' ? `${fmtIdle(kw.leftMs)} left` : kw.state}</Text>
            </Box>
          ) : null}
          {grow}
          {button}
        </Box>
      )
    } else {
      // Narrow: the cache gets its own row under the usage blocks.
      rows = [
        <Box key="row" flexDirection="row" paddingX={1}>
          {label}
          {usage}
        </Box>,
        <Box key="cache" flexDirection="row" paddingX={1} alignItems="center">
          {badge}
          {summary}
          {kw ? <Text dimColor>{` · ${keepwarmText(kw)}`}</Text> : null}
          {grow}
          {button}
        </Box>,
      ]
    }

    let card = null
    if (open && Svg) {
      const c = cardSvg(view, kind, bandPx(columns))
      card = (
        <Box key="card" flexDirection="row">
          <Svg source={c.source} alt={c.alt} width={c.w} height={c.h} isInteractive={kind !== 'tight'} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {rows}
        {card}
      </Box>
    )
  })
}
