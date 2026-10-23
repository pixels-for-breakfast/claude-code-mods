import { expect, test } from 'claude-code/testing'

const PANE = {
  title: 'Session',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock',
} as const

test('the pane shows the summary and a checklist of tasks', async ($, on) => {
  on('tool.call', async (_$, e, next) => {
    if (e.tool === 'AskUserQuestion') {
      return next(e)
    }
    if (e.tool === 'TaskCreate') {
      return { result: { task: { id: e.subject === 'Write tests' ? '2' : '1', subject: e.subject } } }
    }

    return { result: { success: true, taskId: '1', updatedFields: ['status'] } }
  })
  on('model.complete', async () => ({
    value: {
      isAnswered: true,
      text: 'TITLE: Building session glance\nGOAL: Glanceable session status\nDONE_WHEN: Pane shows status and tasks live\nDONE: Toggle band added\nNEXT: Try it live',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  on('turn.complete', async () => ({ text: '' }))
  on('classic.UserPromptSubmit', async () => ({}))
  const asked: string[] = []
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    asked.push(e.questions[0]?.question ?? '')

    return { result: { questions: e.questions, answers: { [e.questions[0]?.question ?? '']: 'Mark as done' } } as never }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('ui.close', async () => ({ value: undefined }))

  await $.tool.call({ tool: 'TaskCreate', subject: 'Build pane', description: 'x' })
  await $.tool.call({ tool: 'TaskCreate', subject: 'Write tests', description: 'y' })
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
  await $.turn.complete({ answer: 'Done with the pane.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-glance', surface, component: 'Pane', requestId: 'session-glance', props: PANE as never })
    expect(await ui.find({ type: 'Text', text: /Toggle band added/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Build pane/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Write tests/ })).toBeDefined()
    await ui.press({ key: 'toggle-tasks' })
    expect(await ui.find({ type: 'Text', text: /Write tests/ })).toBeUndefined()
    await ui.press({ key: 'toggle-tasks' })
    await ui.unmount()
  }

  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const demo = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await demo.find({ type: 'Text', text: /Add the toggle above the prompt/ })).toBeDefined()
  expect(await demo.find({ type: 'Text', text: /Session pane with drag-and-drop editing/ })).toBeDefined()
  await demo.press({ key: 'task-demo-4' })
  await demo.unmount()
  expect(asked).toEqual(['What should happen to "Seed fake tasks for a demo"?'])
  const band2 = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80 } as never })
  expect(await band2.find({ type: 'Text', text: /6\/9 tasks  ·  2 for you/ })).toBeDefined()
  await band2.unmount()

  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const band = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80 } as never })
  // The demo prefills the status and title too, replacing what the turn above wrote.
  expect(await band.find({ type: 'Text', text: /Session glance demo\s+·\s+5\/9 tasks\s+·\s+2 for you/ })).toBeDefined()
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  for (const label of ['Goal', 'Done when', 'Done', 'Next']) {
    expect(await pane.find({ type: 'Text', text: label })).toBeDefined()
  }
  expect(await pane.find({ type: 'Text', text: 'Every task state shows' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Goal reached/ })).toBeUndefined()
  // Folded: "Write the README" shows its 0/2 count, not its subtasks.
  expect(await pane.find({ type: 'Text', text: '0/2' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Add screenshots' })).toBeUndefined()
  await pane.unmount()
  await band.press({ key: 'toggle-pane' })
  expect(await band.find({ type: 'Text', text: /Show status/ })).toBeDefined()
  await band.press({ key: 'toggle-pane' })
  expect(await band.find({ type: 'Text', text: /Hide status/ })).toBeDefined()
  await band.unmount()

  // Off by default: the session keeps the app's own title.
  const answered = await $.classic.UserPromptSubmit({ prompt: 'next' } as never)
  expect(answered.sessionTitle).toBeUndefined()
})

test('with renameSession on, the status title becomes the session title', { options: { renameSession: true } }, async ($, on) => {
  on('classic.UserPromptSubmit', async () => ({}))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const answered = await $.classic.UserPromptSubmit({ prompt: 'next' } as never)
  expect(answered.sessionTitle).toBe('Session glance demo')
})

test('/glance rename sets the renameSession option through the config', async ($, on) => {
  const set: unknown[] = []
  on('config.set', async (_$, e) => {
    set.push([e.key, e.value])

    return { value: e.value }
  })
  await $.command.run({ command: 'glance', args: 'rename on' } as never)
  await $.command.run({ command: 'glance', args: 'rename off' } as never)
  await $.command.run({ command: 'glance', args: 'rename' } as never)
  expect(set).toEqual([
    ['session-glance.renameSession', true],
    ['session-glance.renameSession', false],
    ['session-glance.renameSession', true],
  ])
})
