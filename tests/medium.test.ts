import { expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2098-12-31T22:00:00Z')
const WINDOWS = [
  { kind: 'five_hour', percentUsed: 18, resetsAt: '2099-01-01T01:29:00Z' },
  { kind: 'seven_day', percentUsed: 1 },
]
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 85, scroll: { offset: 0, bodyRows: 12 }, view: {} } as const

test('at a medium width the band stays one short row with the Show button', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1000000 }, rateLimits: WINDOWS } }))
  on('classic.SessionStart', () => ({}))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.classic.SessionStart({ source: 'resume', seconds_since_last_response: 18 * 60, context_tokens: 770000, model: 'claude-opus-5-5' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ key: 'inline' })).toBeDefined()
  expect(await band.find({ key: 'block' })).toBeUndefined()
  expect(await band.find({ text: ' 42m' })).toBeDefined()
  expect(await band.find({ text: ' 99%' })).toBeDefined()
  expect((await band.find({ key: 'cache-fold' }))?.props.label).toBe('Show')
  await band.unmount()
})
