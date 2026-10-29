import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
} as const
const WARM_IDLE = 18 * 60 // 18 minutes: warm, cold in 42m
const COLD_IDLE = (3 * 24 + 9) * 3600 // 3d 9h: cold

test('a warm cache shows Robo, the WARM chip and the minutes left, folded', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  // Drawings keep no key in the kit, so they are found by what they say.
  const alts = (await band.findAll({ type: 'Svg' })).map(s => s.props.alt)
  expect(alts).toEqual(['Robo, bobbing', 'WARM'])
  expect(await band.find({ text: ' 42m left' })).toBeDefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Show')

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeDefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Hide')
  await band.unmount()
})

test('a cold cache opens the card with the re-cache price, and Hide folds it to one row', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const card = await band.find({ key: 'card' })
  expect(card).toBeDefined()
  expect(JSON.stringify(card)).toContain('Cache cold. Idle 3d 9h. Next message re-caches 770k tokens.')
  // The page's width: 80 columns is a 1020 px band.
  expect(JSON.stringify(card)).toContain('width=\\"1020\\"')

  await band.press({ key: 'cache-fold' })
  expect(await band.find({ key: 'card' })).toBeUndefined()
  expect(await band.find({ text: ' 3d 9h' })).toBeDefined()
  // Opus 5.5: 770k tokens at the 1-hour write price, 2 x $4 per million.
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  await band.unmount()
})

test('squeezed, the folded cache stacks as a third block, then takes its own row', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const half = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 53 } })
  expect(await half.find({ key: 'block' })).toBeDefined()
  expect(await half.find({ text: '42m left' })).toBeDefined()
  expect(await half.find({ text: '$0.15' })).toBeDefined()
  await half.unmount()

  const narrow = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 33 } })
  expect(await narrow.find({ key: 'cache' })).toBeDefined()
  await narrow.press({ key: 'cache-fold' })
  // Narrow's card is the compact one: 38 columns is a 456 px band.
  expect(JSON.stringify(await narrow.find({ key: 'card' }))).toContain('width=\\"456\\"')
  await narrow.unmount()
})

test('the terminal draws the cache as text, with no drawings and no fold button', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: ' COLD ' })).toBeDefined()
  expect(await band.find({ text: '$6.16' })).toBeDefined()
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ key: 'cache-fold' })).toBeUndefined()
  expect(await band.find({ key: 'card' })).toBeUndefined()
  await band.unmount()
})

test('a cleared session drops the cache until the next reply', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })
  await $.classic.SessionStart({ source: 'clear' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.findAll({ type: 'Svg' })).toEqual([])
  expect(await band.find({ text: ' 99% left' })).toBeDefined()
  await band.unmount()
})

test('drawing surfaces keep the cache on one row in caption text; the terminal stacks it until the row has room', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  // Desktop at 80 columns: one row, the text two steps smaller so the cache and Show fit.
  const desk = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await desk.find({ key: 'inline' })).toBeDefined()
  expect(await desk.find({ text: ' 42m left' })).toBeDefined()
  const sizes = new Set((await desk.findAll({ type: 'Text' })).map(t => t.props.size))
  expect([...sizes]).toEqual(['caption'])
  await desk.unmount()

  // The terminal has one text size: 100 columns fit the two windows, not the cache too.
  const mid = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 100 } })
  expect(await mid.find({ key: 'inline' })).toBeUndefined()
  expect(await mid.find({ key: 'block' })).toBeDefined()
  await mid.unmount()

  const wide = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 120 } })
  expect(await wide.find({ key: 'inline' })).toBeDefined()
  await wide.unmount()
})

test('align: spread spaces the blocks evenly across the row, with no empty spacers', { options: { align: 'spread' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const row = await band.find({ key: 'row' })
  expect(row?.props.justifyContent).toBe('space-between')
  // USAGE rides with the first window; no lone spacer before Show
  expect(await band.find({ key: 'head' })).toBeDefined()
  expect(await band.find({ key: 'grow' })).toBeUndefined()
  await band.unmount()
})

test('label: hidden drops USAGE, and spread still spaces the row', { options: { label: 'hidden', align: 'spread' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'ribbon', surface, component: 'AbovePrompt', props: PROPS })
    expect(await band.find({ text: 'USAGE' })).toBeUndefined()
    expect(await band.find({ key: 'label' })).toBeUndefined()
    await band.unmount()
  }
  // Spread still holds with no label: the row justifies, and there is no USAGE group to make
  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect((await band.find({ key: 'row' }))?.props.justifyContent).toBe('space-between')
  expect(await band.find({ key: 'head' })).toBeUndefined()
  await band.unmount()
})

test('theme: app draws the card with no background, its ink following the light or dark scheme', { options: { theme: 'app' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: COLD_IDLE, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const card = JSON.stringify(await band.find({ key: 'card' }))
  expect(card).not.toContain('#24221c')
  expect(card).toContain('prefers-color-scheme: light')
  expect(card).not.toContain('fill=\\"#e8e2d2\\"')
  await band.unmount()
})

test('valign: center lines up the stacked blocks, the cache and the button on the row', { options: { valign: 'center' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 50000, model: 'claude-opus-5-5' })

  for (const bodyColumns of [120, 60]) {
    const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns } })
    expect((await band.find({ key: 'row' }))?.props.alignItems).toBe('center')
    await band.unmount()
  }
})

test('valign stays at the top for stacked blocks by default', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: WARM_IDLE, context_tokens: 50000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'terminal', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 60 } })
  expect((await band.find({ key: 'row' }))?.props.alignItems).toBe('flex-start')
  await band.unmount()
})
