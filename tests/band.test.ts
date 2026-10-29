import { expect, mock, test } from 'claude-code/testing'

const WINDOWS = [
  { kind: 'five_hour', percentUsed: 58, resetsAt: '2099-01-01T00:00:00Z' },
  { kind: 'seven_day', percentUsed: 12.5 },
]

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 4,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 4 },
  view: {},
} as const

test('the band shows percent left for each window once a reading lands', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'ribbon',
      surface,
      component: 'AbovePrompt',
      props: PROPS,
    })
    expect(await band.find({ text: '42% left' })).toBeDefined()
    expect(await band.find({ text: '87.5% left' })).toBeDefined()
    // 7D (87.5% left) draws before 5H (42% left)
    const all = JSON.stringify(await band.find({ type: 'Box' }))
    expect(all.indexOf('7D')).toBeLessThan(all.indexOf('5H'))
    await band.unmount()
  }
})

test('in a narrow band each window stacks, with percent left and reset time on their own lines', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({
    plugin: 'ribbon',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: { ...PROPS, bodyColumns: 36 },
  })
  expect(await band.find({ text: '42% left' })).toBeDefined()
  expect(await band.find({ text: 'resets 2h 0m' })).toBeDefined()
  await band.unmount()
})

test('usage: used shows the spent share of each window and fills the bar with it', { options: { usage: 'used' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'ribbon', surface, component: 'AbovePrompt', props: PROPS })
    expect(await band.find({ text: '58% used' })).toBeDefined()
    expect(await band.find({ text: '12.5% used' })).toBeDefined()
    expect(await band.find({ text: '42% left' })).toBeUndefined()
    // 5H is 58% used: 6 of 10 dots on
    expect(await band.find({ text: '●●●●●●' })).toBeDefined()
    await band.unmount()
  }
})

test('textSize sets the band text on drawing surfaces', { options: { textSize: 'body' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const sizes = new Set((await band.findAll({ type: 'Text' })).map(t => t.props.size))
  expect([...sizes]).toEqual(['body'])
  await band.unmount()
})

test('first: 5h draws the 5-hour window before the 7-day one', { options: { first: '5h' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'ribbon', surface, component: 'AbovePrompt', props: PROPS })
    const all = JSON.stringify(await band.find({ type: 'Box' }))
    expect(all.indexOf('5H')).toBeLessThan(all.indexOf('7D'))
    await band.unmount()
  }
})

test('colors: level paints each window by the share used, like a traffic-light status line', { options: { colors: 'level' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const texts = await band.findAll({ type: 'Text' })
  const colorOf = (figure: string) => texts.find(t => JSON.stringify(t.children).includes(figure))?.props.color
  // 5H is 58% used: yellow; 7D is 12.5% used: green
  expect(colorOf('42% left')).toBe('#ffd700')
  expect(colorOf('87.5% left')).toBe('#5fff00')
  await band.unmount()
})

test('dots: even draws ten bullets of one size, the unused ones grey', { options: { dots: 'even' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const texts = await band.findAll({ type: 'Text' })
  const text = (t: { children?: unknown }) => (t.children as unknown[] | undefined)?.join('') ?? ''
  // 5H has 42% left: 4 used-colour bullets, then 6 grey ones; no large or small dots
  expect(texts.some(t => text(t) === '••••')).toBe(true)
  const off = texts.find(t => text(t) === '••••••')
  expect(off?.props.color).toBe('#6b6966')
  expect(texts.some(t => /^[●·]+$/.test(text(t)))).toBe(false)
  await band.unmount()
})

test('a new session shows the last known windows until its first reply, not "waiting"', async ($, on) => {
  mock.store(on, {
    lastWindows: [
      { kind: 'seven_day', percentUsed: 12.5, resetsAt: '2099-01-05T00:00:00Z' },
      { kind: 'five_hour', percentUsed: 58, resetsAt: '2099-01-01T00:00:00Z' },
      // already reset: dropped, its figure is stale
      { kind: 'spend_limit', percentUsed: 90, resetsAt: '2098-12-31T00:00:00Z' },
    ],
  })
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: 'waiting for the first reply' })).toBeUndefined()
  expect(await band.find({ text: '42% left' })).toBeDefined()
  expect(await band.find({ text: '87.5% left' })).toBeDefined()
  expect(await band.find({ text: 'SPEND' })).toBeUndefined()
  await band.unmount()
})

test('dots: solid draws ten large dots, the unused ones grey', { options: { dots: 'solid' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const texts = await band.findAll({ type: 'Text' })
  const text = (t: { children?: unknown }) => (t.children as unknown[] | undefined)?.join('') ?? ''
  // 5H has 42% left: 4 coloured dots, then 6 grey ones of the same size
  expect(texts.some(t => text(t) === '●●●●')).toBe(true)
  expect(texts.find(t => text(t) === '●●●●●●')?.props.color).toBe('#6b6966')
  expect(texts.some(t => /^[·•]+$/.test(text(t)))).toBe(false)
  await band.unmount()
})

test('context: CTX comes first, before the windows', { options: { context: 'shown', usage: 'used' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, tokens: 28000, percent: 14 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 160 } })
  expect(await band.find({ text: '14% used' })).toBeDefined()
  const all = JSON.stringify(await band.find({ type: 'Box' }))
  expect(all.indexOf('CTX')).toBeLessThan(all.indexOf('7D'))
  await band.unmount()
})

test('context stays off by default', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, tokens: 28000, percent: 14 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ text: 'CTX' })).toBeUndefined()
  await band.unmount()
})

test('words: hidden drops left/used and resets, in both layouts', { options: { words: 'hidden' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  for (const bodyColumns of [100, 60]) {
    const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns } })
    const all = JSON.stringify(await band.find({ type: 'Box' }))
    expect(all).toContain('42%')
    expect(all).toContain('2h 0m')
    expect(all).not.toContain('left')
    expect(all).not.toContain('resets')
    await band.unmount()
  }
})

test('cells: 5 draws five dots a bar, one per 20%', { options: { cells: '5' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const texts = await band.findAll({ type: 'Text' })
  const text = (t: { children?: unknown }) => (t.children as unknown[] | undefined)?.join('') ?? ''
  // 5H 42% left: 2 of 5 on; 7D 87.5% left: 4 of 5 on (4.375 rounds down)
  expect(texts.some(t => text(t) === '●●')).toBe(true)
  expect(texts.some(t => text(t) === '·'.repeat(3))).toBe(true)
  expect(texts.some(t => text(t) === '●●●●')).toBe(true)
  expect(texts.some(t => /^[●·]{6,}$/.test(text(t)))).toBe(false)
  await band.unmount()
})

test('theme: app drops the dark surface and draws in the theme colours', { options: { theme: 'app', colors: 'level' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const boxes = await band.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.backgroundColor !== undefined)).toBe(false)
  const texts = await band.findAll({ type: 'Text' })
  const colorOf = (figure: string) => texts.find(t => JSON.stringify(t.children).includes(figure))?.props.color
  expect(colorOf('USAGE')).toBe('text')
  expect(colorOf('42% left')).toBe('warning')
  expect(colorOf('87.5% left')).toBe('success')
  await band.unmount()
})

test('theme: fixed keeps the dark surface by default', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const boxes = await band.findAll({ type: 'Box' })
  expect(boxes.some(b => b.props.backgroundColor === '#24221c')).toBe(true)
  await band.unmount()
})
