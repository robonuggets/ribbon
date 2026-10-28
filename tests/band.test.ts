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
    // Roomy: each figure says "left".
    expect(await band.find({ text: ' 42% left' })).toBeDefined()
    expect(await band.find({ text: ' 87.5% left' })).toBeDefined()
    expect(await band.find({ text: ' 2h' })).toBeDefined()
    // 7D (87.5% left) draws before 5H (42% left)
    const all = JSON.stringify(await band.find({ type: 'Box' }))
    expect(all.indexOf('7D')).toBeLessThan(all.indexOf('5H'))
    await band.unmount()
  }
})

test('on desktop each window draws a stepped bar of what is left, stretched into the free room', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const bars = await band.findAll({ type: 'Svg' })
  expect(bars.map(s => s.props.alt)).toEqual(['87.5% left', '42% left'])
  // 100 columns leaves plenty over, so both bars reach their cap.
  expect(bars.map(s => s.props.width)).toEqual([180, 180])
  // A dot sits between the two windows.
  expect(await band.find({ text: '•' })).toBeDefined()
  await band.unmount()
})

test('in a narrow band the row goes compact and drops the reset times instead of wrapping', async ($, on) => {
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
    props: { ...PROPS, bodyColumns: 30 },
  })
  expect(await band.find({ text: ' 42%' })).toBeDefined()
  expect(await band.find({ text: ' 2h' })).toBeUndefined()
  await band.unmount()
})
