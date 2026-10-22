import { expect, mock, test } from 'claude-code/testing'

import { compactNote } from '../hooks/register'

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
