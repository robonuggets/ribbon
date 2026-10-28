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

const PANE = {
  plugin: 'ribbon',
  surface: 'desktop',
  component: 'Pane',
  requestId: 'ribbon-agents',
  props: { title: 'Agents', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
} as const

test('the agents view is off by default: no ⇄ button', async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS } }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await band.find({ type: 'Button', key: 'ribbon-swap' })).toBeUndefined()
  await band.unmount()
})

test('turned on, ⇄ swaps the row for the agents bar and back', { options: { agentsView: 'on' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS } }))
  on('command.register', () => ({ value: { command: 'agents-info' } }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect((await band.find({ type: 'Button', key: 'ribbon-swap' }))?.props.label).toBe('⇄ Agents')
  await band.press({ key: 'ribbon-swap' })
  const alts = (await band.findAll({ type: 'Svg' })).map(s => s.props.alt)
  expect(alts).toEqual(['Subagents: no subagents yet, 0%'])
  expect((await band.find({ type: 'Button', key: 'ribbon-agents' }))?.props.label).toBe('×0')
  expect((await band.find({ type: 'Button', key: 'ribbon-swap' }))?.props.label).toBe('⇄ Usage')
  await band.press({ key: 'ribbon-swap' })
  expect(await band.find({ type: 'Button', key: 'ribbon-agents' })).toBeUndefined()
  await band.unmount()
})

test('a started subagent shows on the bar and gets a row in the panel', { options: { agentsView: 'on' } }, async ($, on) => {
  mock.store(on)
  mock.clock(on, { now: Date.parse('2098-12-31T22:00:00Z') })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: WINDOWS } }))
  on('command.register', () => ({ value: { command: 'agents-info' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'a1' }))
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

  const band = await $.ui.mount({ plugin: 'ribbon', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  await band.press({ key: 'ribbon-swap' })
  await $.agent.spawn({
    tool_use_id: 't1',
    prompt: 'Read README.md.',
    description: 'Read the README',
    subagentType: 'general-purpose',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  })
  const alts = (await band.findAll({ type: 'Svg' })).map(s => s.props.alt)
  expect(alts).toEqual(['Read the README: agents 0/1, 0%'])
  await band.unmount()

  const pane = await $.ui.mount(PANE)
  const rows = (await pane.findAll({ type: 'Svg' })).map(s => s.props.alt)
  expect(rows).toContain('Read the README: Opus 5.5, running')
  await pane.unmount()
})
