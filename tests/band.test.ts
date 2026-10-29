import { expect, mock, test } from 'claude-code/testing'

import { keepwarmText } from '../hooks/register'

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

test('with the cache block in the row, the row stacks below 112 columns and draws on one row from 112', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS },
  }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 18 * 60, context_tokens: 300000, model: 'claude-opus-5-5' })

  // 81 columns is the width that clipped the WARM chip and the Show button: it is wide
  // for the card, but too narrow for the row, so each window stacks and the cache is a block.
  const narrow = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 81 } })
  expect((await narrow.find({ key: 'w-0' }))?.props.flexDirection).toBe('column')
  await narrow.unmount()

  const wide = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: { ...PROPS, bodyColumns: 120 } })
  expect((await wide.find({ key: 'w-0' }))?.props.flexDirection).toBe('row')
  expect(await wide.find({ text: ' 42m left' })).toBeDefined()
  await wide.unmount()
})

test('the band sets no background and no hex neutrals, so it takes the app theme', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS },
  }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  const tree = JSON.stringify(await band.find({ type: 'Box' }))
  expect(tree).not.toContain('backgroundColor')
  expect(tree).not.toContain('#24221c')
  await band.unmount()
})

const SESSION = async ($: any, on: any) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 18 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })
}

test('without the cache-tax mod the band has no keepwarm text', async ($, on) => {
  await SESSION($, on)
  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ key: 'kw' })).toBeUndefined()
  await band.unmount()
})

test('the keepwarm text says off, stopped, or the time left', () => {
  expect(keepwarmText({ state: 'off', leftMs: 0 })).toBe('keepwarm off')
  expect(keepwarmText({ state: 'stopped', leftMs: 0 })).toBe('keepwarm stopped')
  expect(keepwarmText({ state: 'on', leftMs: 130 * 60000 })).toBe('keepwarm 2h 10m left')
})
