import { expect, mock, test } from 'claude-code/testing'

import { compactNote, driftNote, formatCriteria, handoffMarkdown, parseCriteria } from '../hooks/register'

const PANE = { title: 'Session', isFocused: false, bodyColumns: 40, placement: 'dock' } as const

test('the pane comes back after a resume, and /clear starts it empty', async ($, on) => {
  mock.store(on)
  let sessionId = 's1'
  on('session.id', async () => ({ value: sessionId }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'hi' } as never)
  await $.command.run({ command: 'glance', args: 'demo' } as never)

  // /clear: a new id with nothing saved empties the pane.
  sessionId = 's2'
  await $.prompt.submit({ text: 'fresh start' } as never)
  const cleared = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await cleared.find({ type: 'Text', text: 'No tasks yet.' })).toBeDefined()
  await cleared.unmount()

  // /resume back to the first session: its tasks, title and folds return.
  sessionId = 's1'
  await $.prompt.submit({ text: 'back again' } as never)
  const resumed = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await resumed.find({ type: 'Text', text: 'Add the toggle above the prompt' })).toBeDefined()
  expect(await resumed.find({ type: 'Text', text: 'Add screenshots' })).toBeUndefined()
  await resumed.unmount()
})

test('a compaction is told to keep the goal and its done-when', () => {
  expect(compactNote('GOAL: Ship it\nDONE_WHEN: [ ] tests pass\nNEXT: Push')).toBe("Keep the session's goal in the summary, word for word. Goal: Ship it. Done when: [ ] tests pass.")
  expect(compactNote('')).toBe('')
})

test('parseCriteria reads met and open criteria, and a hand tick stays met', () => {
  expect(parseCriteria('[x] Tests pass; [ ] Docs updated', [])).toEqual([
    { text: 'Tests pass', isMet: true, isTicked: false },
    { text: 'Docs updated', isMet: false, isTicked: false },
  ])
  expect(parseCriteria('[ ] Docs updated', ['docs updated'])[0]?.isMet).toBe(true)
  // An older single line without markers is one open criterion.
  expect(parseCriteria('Pane shows status and tasks live', [])).toEqual([{ text: 'Pane shows status and tasks live', isMet: false, isTicked: false }])
  expect(formatCriteria(parseCriteria('[ ] A; [x] B', ['a']))).toBe('[x] A; [x] B')
  expect(driftNote('none')).toBe('')
  expect(driftNote('Refactored CSS instead')).toBe('Refactored CSS instead')
})

test('ticking every criterion says the goal is reached, and drift shows a quiet line', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('model.complete', async () => ({
    value: {
      isAnswered: true,
      text: 'TITLE: Ship\nGOAL: Ship it\nDONE_WHEN: [x] Tests pass; [ ] Docs updated\nDONE: Tests\nNEXT: Docs\nDRIFT: Tweaked colours instead',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('turn.complete', async () => ({ text: '' }))
  await $.turn.complete({ answer: 'Tests pass.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'Off goal: Tweaked colours instead' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Goal reached/ })).toBeUndefined()
  await pane.press({ key: 'criterion-Docs updated' })
  expect(await pane.find({ type: 'Text', text: /Goal reached/ })).toBeDefined()
  await pane.unmount()
})

test('handoffMarkdown writes the status, done-when and checklist for a PR description', () => {
  const markdown = handoffMarkdown(
    'Ship it',
    'GOAL: Ship it\nDONE_WHEN: [x] Tests pass; [ ] Docs updated\nDONE: Tests\nNEXT: Docs',
    [
      { id: 'a', subject: 'Write docs', status: 'pending' },
      { id: 'b', subject: 'Run tests', status: 'completed' },
      { id: 'a1', subject: 'README', status: 'completed', parentId: 'a' },
    ],
    [],
  )
  expect(markdown).toBe(
    [
      '# Ship it',
      '**Goal:** Ship it',
      '**Done when:**\n- [x] Tests pass\n- [ ] Docs updated',
      '**Done:** Tests',
      '**Next:** Docs',
      '## Tasks',
      '- [x] Write docs\n  - [x] README\n- [x] Run tests',
    ].join('\n\n'),
  )
})

test('/glance copy puts the handoff on the clipboard, or prints it when there is none', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const copied: string[] = []
  let isAvailable = true
  on('ui.copy', async (_$, e) => {
    copied.push(e.text)

    return { value: isAvailable ? { isCopied: true } : { isCopied: false, reason: 'no-clipboard' } }
  })
  expect((await $.command.run({ command: 'glance', args: 'copy' } as never)).text).toBe('Nothing to copy yet: no status and no tasks.')
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  expect((await $.command.run({ command: 'glance', args: 'copy' } as never)).text).toBe('Copied the session status and checklist as markdown.')
  expect(copied[0]).toContain('# Session glance demo')
  expect(copied[0]).toContain('  - [ ] Add screenshots')
  isAvailable = false
  expect((await $.command.run({ command: 'glance', args: 'copy' } as never)).text).toContain('- [x] Every task state shows')
})

const REPLY = {
  isAnswered: true,
  text: 'TITLE: Ship\nGOAL: Ship it\nDONE_WHEN: [ ] Tests pass\nDONE: Tests\nNEXT: Docs\nDRIFT: none',
  usage: { input_tokens: 1200, output_tokens: 80, cache_creation_input_tokens: 0, cache_read_input_tokens: 300 },
} as const

test('the footer counts the calls and tokens the mod spends', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const models: string[] = []
  on('model.complete', async (_$, e) => (models.push(e.model), { value: REPLY }))
  on('turn.complete', async () => ({ text: '' }))
  await $.turn.complete({ answer: 'Tests pass.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.complete({ answer: 'Docs too.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'glance: 2 calls · 3.2k tokens (160 out) · haiku' })).toBeDefined()
  await pane.unmount()
  expect(models).toEqual(['haiku', 'haiku'])
})

test('with autoSummary off the status waits for /glance refresh, on the chosen model', { options: { autoSummary: false, summaryModel: 'sonnet' } }, async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const models: string[] = []
  on('model.complete', async (_$, e) => (models.push(e.model), { value: REPLY }))
  on('turn.complete', async () => ({ text: '' }))
  expect((await $.command.run({ command: 'glance', args: 'refresh' } as never)).text).toContain('Nothing to update')
  await $.turn.complete({ answer: 'Tests pass.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(models).toEqual([])
  expect((await $.command.run({ command: 'glance', args: 'refresh' } as never)).text).toBe('Updated the status from the last answer.')
  expect(models).toEqual(['sonnet'])
})

test('with checkTasks off a typed task is added as typed, without a model call', { options: { checkTasks: false } }, async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  let calls = 0
  on('model.complete', async () => (calls++, { value: REPLY }))
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  await pane.input({ key: 'add-task-0', text: 'fix teh bug' })
  expect(await pane.find({ type: 'Text', text: 'fix teh bug' })).toBeDefined()
  await pane.unmount()
  expect(calls).toBe(0)
})

test('/glance auto, check and model set their userConfig fields', async ($, on) => {
  const set: unknown[] = []
  on('config.set', async (_$, e) => (set.push([e.key, e.value]), { value: e.value }))
  await $.command.run({ command: 'glance', args: 'auto off' } as never)
  await $.command.run({ command: 'glance', args: 'check' } as never)
  await $.command.run({ command: 'glance', args: 'model sonnet' } as never)
  expect((await $.command.run({ command: 'glance', args: 'model gpt' } as never)).text).toContain('The status uses haiku')
  expect(set).toEqual([
    ['session-glance.autoSummary', false],
    ['session-glance.checkTasks', false],
    ['session-glance.summaryModel', 'sonnet'],
  ])
})
