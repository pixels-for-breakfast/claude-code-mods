import { expect, mock, test } from 'claude-code/testing'

import { compactNote, driftNote, formatCriteria, parseCriteria } from '../hooks/register'

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
