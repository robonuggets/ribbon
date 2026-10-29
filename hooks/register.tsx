import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CacheFacts, Fold, Meta, Window } from '../types'
import {
  BG, CHIP_SMALL, EMPTY, HUE, INK, MUTED, ORANGE, ROBO_SMALL, TEXT, TTL_MIN, TTL_MS, WORD, YELLOW,
  WIDE_AT, WIDE_CACHE_AT, WIDE_FOOTNOTE_AT, bandPx, cardSvg, chipSvg, costOf, familyOf, fmtIdle, kindOf, mineModel, roboSvg, usd,
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

const windows = atom({ plugin: 'ribbon', key: 'windows' } as const, [] as Window[])
const meta = atom({ plugin: 'ribbon', key: 'meta' } as const, { ctx: null } as Meta)
const cache = atom({ plugin: 'ribbon', key: 'cache' } as const, null as CacheFacts | null)
const fold = atom({ plugin: 'ribbon', key: 'fold' } as const, null as Fold | null)

const NAMES: Record<string, string> = { seven_day: '7D', five_hour: '5H', spend_limit: 'SPEND', context: 'CTX' }
const ORDER: Record<string, number> = { seven_day: 0, five_hour: 1 }
const ORDER_5H_FIRST: Record<string, number> = { five_hour: 0, seven_day: 1 }

/**
 * The band's colours. fixed is its own warm dark card; app has no surface of its own and takes
 * the person's theme colours by key, so it reads on a light theme as on a dark one.
 */
type Ink = {
  bg?: string; text: string; muted: string; empty: string; off: string
  windows: Record<string, string>
  /** colors: level, by the share used: under 50%, from 50%, from 80%. */
  level: [string, string, string]
}
const FIXED: Ink = {
  bg: BG, text: TEXT, muted: MUTED, empty: EMPTY, off: '#6b6966',
  windows: { seven_day: ORANGE, five_hour: YELLOW, context: TEXT },
  // As a traffic-light status line draws it (xterm 82, 220, 203).
  level: ['#5fff00', '#ffd700', '#ff5f5f'],
}
const APP: Ink = {
  text: 'text', muted: 'subtle', empty: 'inactive', off: 'inactive',
  windows: { seven_day: 'claude', five_hour: 'warning', context: 'text' },
  level: ['success', 'warning', 'error'],
}
const levelColor = (used: number, ink: Ink): string => ink.level[used >= 80 ? 2 : used >= 50 ? 1 : 0]

const clean = (list: readonly Window[]): Window[] =>
  list
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
    .sort((a, b) => (ORDER[a.kind] ?? 9) - (ORDER[b.kind] ?? 9))

/** dots: even draws every cell as the same small bullet, solid as the same large dot; unused ones grey. */
type Dots = 'mixed' | 'even' | 'solid'
const GLYPHS: Record<Dots, [string, string]> = { mixed: ['●', '·'], even: ['•', '•'], solid: ['●', '●'] }
const dots = (left: number, cells: number, style: Dots = 'mixed'): { on: string; off: string } => {
  const n = Math.max(0, Math.min(cells, Math.round((left / 100) * cells)))
  const [on, off] = GLYPHS[style]
  return { on: on.repeat(n), off: off.repeat(cells - n) }
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

// The engine learns the rate limits from the first reply of a session, so a new session would
// show "waiting" beside a cache it already knows. The last figures are kept across sessions and
// shown until fresh ones land; a window whose reset has passed is dropped, as its figure is stale.
const LAST = 'lastWindows'
const remember = async ($: EngineInterface, list: Window[]): Promise<void> => {
  if (list.length > 0) await $.store.set(LAST, list)
}
const recall = async ($: EngineInterface): Promise<Window[]> => {
  const v = await $.store.get(LAST)
  if (!Array.isArray(v)) return []
  const now = await $.clock.now()
  return (v as Window[]).filter(w => !w.resetsAt || Date.parse(w.resetsAt) > now)
}

const pull = async ($: EngineInterface): Promise<void> => {
  const u = await $.session.usage()
  const fresh = clean(u.rateLimits)
  await remember($, fresh)
  const list = fresh.length > 0 ? fresh : await recall($)
  await update($, windows, () => list)
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

export const register: Register = (on, options) => {
  // userConfig: which figure the bars show, which window comes first, whether the USAGE label
  // shows, whether the blocks spread across the band, how the windows are coloured, how the dots
  // are drawn, and the band's text size where the surface has sizes.
  const shows: 'left' | 'used' = options.usage === 'used' ? 'used' : 'left'
  const textSize: 'caption' | 'footnote' | 'body' =
    options.textSize === 'footnote' || options.textSize === 'body' ? options.textSize : 'caption'
  const order = options.first === '5h' ? ORDER_5H_FIRST : ORDER
  const spread = options.align === 'spread'
  const showLabel = options.label !== 'hidden'
  const byLevel = options.colors === 'level'
  const dotStyle: Dots = options.dots === 'even' || options.dots === 'solid' ? options.dots : 'mixed'
  // theme: fixed draws the band's own dark card; app follows the person's theme.
  const app = options.theme === 'app'
  const ink = app ? APP : FIXED
  // valign: how blocks of different heights sit on the row (the stacked windows, the cache, the
  // Show button). top keeps them at the top, as before; center and bottom line them up there.
  const valign = options.valign === 'center' ? 'center' : options.valign === 'bottom' ? 'flex-end' : null
  const offColor = dotStyle === 'mixed' ? ink.empty : ink.off
  const showCtx = options.context === 'shown'
  const words = options.words !== 'hidden'
  // cells: 5 steps of 20% instead of 10 of 10%, for a shorter row.
  const fullCells = options.cells === '5' ? 5 : CELLS

  on('session.start', async ($, e, next) => {
    await pull($)
    if (showCtx) {
      const ctx = (await $.session.usage()).context.percent ?? null
      await update($, meta, m => ({ ...m, ctx }))
    }
    $.clock.every(TICK_MS, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const fresh = clean(e.rateLimits)
      await remember($, fresh)
      if (fresh.length > 0) await update($, windows, () => fresh)
    }
    if (showCtx && e.changed.includes('context') && typeof e.context.percent === 'number') {
      const ctx = e.context.percent
      await update($, meta, m => ({ ...m, ctx }))
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
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    // Svg draws on desktop, mobile and VS Code; the terminal gets the text form.
    // Ask the surface, not the table: the terminal's table still lists Svg.
    const Svg = e.surface !== 'terminal' && 'Svg' in ui ? ui.Svg : null
    // Drawing surfaces set the band in the configured text size (caption, the smallest step, by
    // default) so the row and the cache fit where the body size would clip them; the terminal
    // has one size and ignores it.
    const size = Svg ? textSize : undefined
    const list = [...(await read($, windows))].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9))
    const now = await $.clock.now()
    const view = viewOf(await read($, cache), now)
    const m = await read($, meta)
    // Context reads as one more window, first, as a status line puts it; it has no reset.
    const ctxRow: Window[] = showCtx && m.ctx !== null ? [{ kind: 'context', percentUsed: m.ctx }] : []

    if (list.length === 0 && !view) {
      return (
        <Box backgroundColor={ink.bg} paddingX={1}>
          <Text size={size} color={ink.muted}>USAGE · waiting for the first reply</Text>
        </Box>
      )
    }

    const columns = e.props.bodyColumns ?? e.viewport?.columns ?? 100
    const wideAt = view === null ? WIDE_AT
      : !Svg || textSize === 'body' ? WIDE_CACHE_AT
      : textSize === 'footnote' ? WIDE_FOOTNOTE_AT
      : WIDE_AT
    // Each extra block asks for its columns before the band keeps one row.
    // Without the words each window is five columns shorter. Smaller text on a drawing surface
    // takes fewer columns per character, so the extra blocks weigh less there.
    const scale = !Svg ? 1 : textSize === 'caption' ? 0.8 : textSize === 'footnote' ? 0.9 : 1
    const extra = Math.round(scale * (
      (ctxRow.length > 0 ? (words ? 20 : 15) : 0) - (words ? 0 : 10)
    ))
    const kind = kindOf(columns, wideAt + extra)
    const isWide = kind === 'wide'
    const cells = kind === 'tight' ? Math.min(TIGHT_CELLS, fullCells) : fullCells

    const parts = (w: Window) => {
      const left = Math.max(0, Math.round((100 - w.percentUsed) * 10) / 10)
      const used = Math.min(100, Math.max(0, Math.round(w.percentUsed * 10) / 10))
      const shown = shows === 'used' ? used : left
      return {
        left,
        figure: words ? `${shown}% ${shows}` : `${shown}%`,
        col: byLevel ? levelColor(used, ink) : ink.windows[w.kind] ?? ink.text,
        name: NAMES[w.kind] ?? w.kind.toUpperCase(),
        d: dots(shown, cells, dotStyle),
        reset: fmtReset(w.resetsAt, now),
      }
    }

    // Wide: every window on one row. Narrow: each window is a block of three
    // lines (name and dots, percent left, reset time) so nothing wraps or clips.
    const wide = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="row" flexShrink={0} marginRight={3}>
          <Text size={size} color={ink.muted} bold>{p.name} </Text>
          <Text size={size} color={p.col}>{p.d.on}</Text>
          <Text size={size} color={offColor}>{p.d.off}</Text>
          <Text size={size} color={p.col} bold> {p.figure}</Text>
          {p.left < LOW_AT ? <Text size={size} color={ink.text} bold> LOW</Text> : null}
          {p.reset ? <Text size={size} color={ink.muted}> · {p.reset}</Text> : null}
        </Box>
      )
    }

    const stacked = (w: Window, i: number) => {
      const p = parts(w)
      return (
        <Box key={`w-${i}`} flexDirection="column" flexShrink={0} marginRight={3}>
          <Box flexDirection="row">
            <Text size={size} color={ink.muted} bold>{p.name} </Text>
            <Text size={size} color={p.col}>{p.d.on}</Text>
            <Text size={size} color={offColor}>{p.d.off}</Text>
          </Box>
          <Box flexDirection="row">
            <Text size={size} color={p.col} bold>{p.figure}</Text>
            {p.left < LOW_AT ? <Text size={size} color={ink.text} bold> LOW</Text> : null}
          </Box>
          {p.reset ? <Text size={size} color={ink.muted}>{words ? `resets ${p.reset}` : p.reset}</Text> : null}
        </Box>
      )
    }

    const label = showLabel ? (
      <Box key="label" flexShrink={0} marginRight={isWide ? 2 : 3}>
        <Text size={size} color={ink.text} bold>USAGE</Text>
      </Box>
    ) : null
    const draw = isWide ? wide : stacked
    const usage = [
      ...ctxRow.map((w, i) => draw(w, i)),
      ...(list.length > 0
        ? list.map((w, i) => draw(w, i + ctxRow.length))
        : [<Box key="wait" flexShrink={0} marginRight={3}><Text size={size} color={ink.muted}>waiting for the first reply</Text></Box>]),
    ]

    // Before the first reply there is no cache to show: today's band, as it was.
    if (!view) {
      return (
        <Box flexDirection="row" backgroundColor={ink.bg} paddingX={1} {...(valign ? { alignItems: valign } : {})}>
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
          <Svg key="robo" source={roboSvg(mode, ROBO_SMALL)} alt={cold ? 'Robo, frozen' : 'Robo, bobbing'} width={ROBO_SMALL} height={ROBO_SMALL} isInteractive />,
          <Text size={size} key="gap"> </Text>,
          (() => {
            const c = chipSvg(mode, CHIP_SMALL)
            return <Svg key="chip" source={c.source} alt={WORD[mode]} width={c.w} height={c.h} />
          })(),
        ]
      : [<Text size={size} key="chip" backgroundColor={hue} color={INK} bold>{` ${WORD[mode]} `}</Text>]

    const summary = cold
      ? [
          <Text size={size} key="idle" color={hue} bold>{` ${view.idle}`}</Text>,
          mine ? <Text size={size} key="dot" color={ink.muted}> · </Text> : null,
          mine ? <Text size={size} key="cost" color={ink.text} bold>{usd(costOf(mine, mode, view.tokens))}</Text> : null,
        ]
      : [<Text size={size} key="left" color={hue} bold>{` ${Math.max(0, TTL_MIN - view.idleMin)}m left`}</Text>]

    const button = Svg ? (
      <Box key="fold" flexShrink={0} alignItems="flex-start">
        <Button key="cache-fold" label={open ? 'Hide' : 'Show'} onPress={toggle} />
      </Box>
    ) : null
    const grow = <Box key="grow" flexGrow={1} />
    // Packed: the blocks sit at the left and the button at the right. Spread: the row spaces its
    // blocks evenly (justify, no empty spacers), so the band fills its width; USAGE stays next to
    // the first window.
    const justify = spread ? { justifyContent: 'space-between' as const } : {}
    const align = { alignItems: valign ?? 'flex-start' }
    const lay = (blocks: unknown[]) => {
      if (!spread) return [...blocks, grow, button]
      const [lead, first, ...rest] = blocks
      const head = lead
        ? <Box key="head" flexDirection="row" flexShrink={0}>{lead}{first}</Box>
        : first
      return [head, ...rest, button].filter(Boolean)
    }

    let rows
    if (kind === 'wide') {
      rows = (
        <Box key="row" flexDirection="row" paddingX={1} alignItems={valign ?? 'center'} {...justify}>
          {lay([
            label,
            ...usage,
            open ? null : (
              <Box key="inline" flexDirection="row" flexShrink={0} marginRight={2} alignItems="center">
                {badge}
                {summary}
              </Box>
            ),
          ])}
        </Box>
      )
    } else if (kind === 'stacked') {
      // The cache becomes a third stacked block, the same shape as 7D and 5H.
      rows = (
        <Box key="row" flexDirection="row" paddingX={1} {...align} {...justify}>
          {lay([
            label,
            ...usage,
            open ? null : (
              <Box key="block" flexDirection="column" flexShrink={0} marginRight={2}>
                <Box flexDirection="row" alignItems="center">{badge}</Box>
                <Text size={size} color={hue} bold>{cold ? `${view.idle} idle` : `${Math.max(0, TTL_MIN - view.idleMin)}m left`}</Text>
                {mine ? (
                  <Box flexDirection="row">
                    <Text size={size} color={ink.text} bold>{usd(costOf(mine, mode, view.tokens))}</Text>
                    <Text size={size} color={ink.muted}> next</Text>
                  </Box>
                ) : null}
              </Box>
            ),
          ])}
        </Box>
      )
    } else {
      // Narrow: the cache gets its own row under the usage blocks.
      rows = [
        <Box key="row" flexDirection="row" paddingX={1} {...align}>
          {label}
          {usage}
        </Box>,
        <Box key="cache" flexDirection="row" paddingX={1} alignItems="center">
          {badge}
          {summary}
          {grow}
          {button}
        </Box>,
      ]
    }

    let card = null
    if (open && Svg) {
      const c = cardSvg(view, kind, bandPx(columns), app)
      card = (
        <Box key="card" flexDirection="row">
          <Svg source={c.source} alt={c.alt} width={c.w} height={c.h} isInteractive={kind !== 'tight'} />
        </Box>
      )
    }

    return (
      <Box flexDirection="column" backgroundColor={ink.bg}>
        {rows}
        {card}
      </Box>
    )
  })
}
