import { expect, mock, test } from 'claude-code/testing'

import { infoIcon } from '../hooks/icons'
import { summaryPrompt } from '../hooks/prompts'
import { HISTORY_SIZE, appendHistory, compactNote, driftNote, formatCriteria, handoffMarkdown, parseCriteria, selectionTask, suggestionFrom, yourMoveFrom } from '../hooks/status'
import { activeOf, applyPlan, describeChanges, moveTask, newTodos, openTodos, setArchived } from '../hooks/tree'

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
      '## Agent tasks',
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
  on('model.complete', async (_$, e) => (models.push(`${e.model}:${e.effort}`), { value: REPLY }))
  on('turn.complete', async () => ({ text: '' }))
  await $.turn.complete({ answer: 'Tests pass.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await $.turn.complete({ answer: 'Docs too.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: '2 calls · 3.2k tokens' })).toBeDefined()
  await pane.press({ key: 'toggle-settings' })
  expect(await pane.find({ type: 'Text', text: /160 tokens out so far/ })).toBeDefined()
  await pane.unmount()
  expect(models).toEqual(['haiku:low', 'haiku:low'])
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

test('suggestionFrom offers only a real change of title', () => {
  expect(suggestionFrom('none', 'Build the pane', [])).toBe('')
  expect(suggestionFrom('build the pane', 'Build the pane', [])).toBe('')
  expect(suggestionFrom('"Fix the deploy"', 'Build the pane', [])).toBe('Fix the deploy')
  expect(suggestionFrom('Fix the deploy', 'Build the pane', ['fix the deploy'])).toBe('')
  expect(summaryPrompt('', 'hi', 'hello')).not.toContain('RETITLE')
  expect(summaryPrompt('', 'hi', 'hello', [], 'Build the pane')).toContain('the title "Build the pane"')
})

const turn = (answer: string, id: string) => ({ answer, durationMs: 1, isAborted: false, turnId: id, reason: 'answer' as const })
const reply = (retitle: string) => ({
  value: {
    isAnswered: true as const,
    text: `TITLE: Build the pane\nGOAL: Build it\nDONE_WHEN: [ ] Pane shows\nDONE: x\nNEXT: y\nDRIFT: none\nRETITLE: ${retitle}`,
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  },
})

test('a title suggestion can be used once at the next prompt, or dismissed for good', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('turn.complete', async () => ({ text: '' }))
  on('classic.UserPromptSubmit', async () => ({}))
  const prompts: string[] = []
  on('model.complete', async (_$, e) => {
    prompts.push(typeof e.prompt === 'string' ? e.prompt : '')

    return reply(prompts.length === 1 ? 'none' : 'Fix the deploy pipeline')
  })

  await $.turn.complete(turn('Started on the pane.', 't1'))
  expect(prompts[0]).not.toContain('RETITLE')
  await $.turn.complete(turn('Now the deploy broke.', 't2'))
  expect(prompts[1]).toContain('the title "Build the pane"')
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'Fix the deploy pipeline' })).toBeDefined()

  await pane.press({ key: 'dismiss-title' })
  expect(await pane.find({ type: 'Text', text: 'Fix the deploy pipeline' })).toBeUndefined()
  await $.turn.complete(turn('Still the deploy.', 't3'))
  expect(await pane.find({ type: 'Text', text: 'Fix the deploy pipeline' })).toBeUndefined()
  await pane.unmount()
  expect((await $.classic.UserPromptSubmit({ prompt: 'next' } as never)).sessionTitle).toBeUndefined()
})

test('using a suggestion renames the session once, with renaming itself off', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('turn.complete', async () => ({ text: '' }))
  on('classic.UserPromptSubmit', async () => ({}))
  let calls = 0
  on('model.complete', async () => reply(++calls === 1 ? 'none' : 'Fix the deploy pipeline'))
  await $.turn.complete(turn('Started on the pane.', 't1'))
  await $.turn.complete(turn('Now the deploy broke.', 't2'))
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  await pane.press({ key: 'use-title' })
  expect(await pane.find({ type: 'Text', text: /Renames the session to "Fix the deploy pipeline"/ })).toBeDefined()
  await pane.unmount()
  expect((await $.classic.UserPromptSubmit({ prompt: 'next' } as never)).sessionTitle).toBe('Fix the deploy pipeline')
  expect((await $.classic.UserPromptSubmit({ prompt: 'again' } as never)).sessionTitle).toBeUndefined()
})

test('with renaming on, no title is suggested', { options: { renameSession: true } }, async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('turn.complete', async () => ({ text: '' }))
  const prompts: string[] = []
  on('model.complete', async (_$, e) => (prompts.push(typeof e.prompt === 'string' ? e.prompt : ''), reply('none')))
  await $.turn.complete(turn('One.', 't1'))
  await $.turn.complete(turn('Two.', 't2'))
  expect(prompts.some(prompt => prompt.includes('RETITLE'))).toBe(false)
})

test('moveTask hands a main task with its subtasks to the other card, and a subtask alone', () => {
  const list = [
    { id: 'a', subject: 'Push', status: 'pending' as const },
    { id: 'a1', subject: 'Tag', status: 'pending' as const, parentId: 'a' },
    { id: 'b', subject: 'Review', status: 'pending' as const, owner: 'user' as const },
  ]
  expect(moveTask(list, 'a').map(task => [task.id, task.owner])).toEqual([
    ['a', 'user'],
    ['a1', 'user'],
    ['b', 'user'],
  ])
  const subtask = moveTask(list, 'a1').find(task => task.id === 'a1')
  expect(subtask).toEqual({ id: 'a1', subject: 'Tag', status: 'pending', owner: 'user' })
  expect(describeChanges(list, moveTask(list, 'b'))).toBe('The user edited the session checklist: handed "Review" to you.')
  expect(handoffMarkdown('', '', list, [])).toContain('## Your to-dos\n\n- [ ] Review')
})

test('a to-do of your own goes in your card, and the agent hears of it as a note', { options: { checkTasks: false } }, async ($, on) => {
  mock.store(on)
  const session = mock.session(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'Nothing for you yet.' })).toBeDefined()
  await pane.input({ key: 'add-task-mine-0', text: 'Push develop' })
  expect(await pane.find({ type: 'Text', text: 'Push develop' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Nothing for you yet.' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'No tasks yet.' })).toBeDefined()
  await pane.unmount()
  expect(JSON.stringify(session.appended())).toContain('It is theirs to do, not yours')
})

test('the status model suggests your next step; Add puts it in your card, Dismiss for good', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('turn.complete', async () => ({ text: '' }))
  let move = 'Push the branch'
  on('model.complete', async () => ({
    value: {
      isAnswered: true as const,
      text: `TITLE: Ship\nGOAL: Ship it\nDONE_WHEN: [ ] Pushed\nDONE: Committed\nNEXT: Push\nDRIFT: none\nYOUR_MOVE: ${move}`,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  await $.turn.complete(turn('Committed.', 't1'))
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'Your next step?' })).toBeDefined()
  await pane.press({ key: 'add-move' })
  expect(await pane.find({ type: 'Text', text: 'Your next step?' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'Push the branch' })).toBeDefined()
  // Already in your card: not offered again.
  await $.turn.complete(turn('Still waiting.', 't2'))
  expect(await pane.find({ type: 'Text', text: 'Your next step?' })).toBeUndefined()

  move = 'Review the PR'
  await $.turn.complete(turn('PR open.', 't3'))
  await pane.press({ key: 'dismiss-move' })
  await $.turn.complete(turn('Still open.', 't4'))
  expect(await pane.find({ type: 'Text', text: 'Review the PR' })).toBeUndefined()
  await pane.unmount()
})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 80 }

test('+ Task and + To-do show next to the toggle only while text is selected', { options: { checkTasks: false } }, async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  let selected: string | undefined
  on('ui.selection', async () => ({ value: selected === undefined ? undefined : { text: selected } }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const band = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  await clock.advance(400)
  expect(await band.find({ type: 'Text', text: /\+ Task/ })).toBeUndefined()

  selected = '  Check   the\nfooter spacing  '
  await clock.advance(400)
  expect(await band.find({ type: 'Text', text: /\+ To-do/ })).toBeDefined()
  await band.press({ key: 'todo-from-selection' })
  expect(await band.find({ type: 'Text', text: /1 for you/ })).toBeDefined()
  await band.press({ key: 'task-from-selection' })
  expect(await band.find({ type: 'Text', text: /0\/1 tasks/ })).toBeDefined()

  selected = undefined
  await clock.advance(400)
  expect(await band.find({ type: 'Text', text: /\+ Task/ })).toBeUndefined()
  await band.unmount()

  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect((await pane.findAll({ type: 'Text', text: 'Check the footer spacing' })).length).toBe(2)
  await pane.unmount()
})

test('/glance task and todo add the selection, and say so when nothing is selected', { options: { checkTasks: false } }, async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  let selected: string | undefined
  on('ui.selection', async () => ({ value: selected === undefined ? undefined : { text: selected } }))
  expect((await $.command.run({ command: 'glance', args: 'todo' } as never)).text).toContain('Select some text first')
  selected = 'Review the diff'
  expect((await $.command.run({ command: 'glance', args: 'todo' } as never)).text).toContain('to your to-dos')
  expect((await $.command.run({ command: 'glance', args: 'task' } as never)).text).toContain('as a task for the agent')
  expect(selectionTask(' a\n\n b ')).toBe('a b')
})

test('setArchived puts a main task away with its subtasks, and brings them back', () => {
  const list = [
    { id: 'a', subject: 'A', status: 'pending' as const },
    { id: 'a1', subject: 'A1', status: 'pending' as const, parentId: 'a' },
    { id: 'b', subject: 'B', status: 'completed' as const },
  ]
  const archived = setArchived(list, 'a', true)
  expect(activeOf(archived).map(task => task.id)).toEqual(['b'])
  expect(setArchived(archived, 'a', false)).toEqual(list)
  expect(describeChanges(list, archived)).toBe('The user edited the session checklist: archived "A" (put away in the pane, not deleted).')
  expect(handoffMarkdown('', '', archived, [])).not.toContain('- [ ] A')
})

test('archive in Edit mode moves a task to the Archived fold, and Restore brings it back', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  await pane.press({ key: 'toggle-manage' })
  await pane.press({ key: 'archive-demo-1' })
  await pane.press({ key: 'save-edit' })
  expect(await pane.find({ type: 'Text', text: 'Sketch the pane layout' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '4/8' })).toBeDefined()
  await pane.press({ key: 'toggle-archived' })
  expect(await pane.find({ type: 'Text', text: 'Sketch the pane layout' })).toBeDefined()
  await pane.press({ key: 'restore-demo-1' })
  expect(await pane.find({ type: 'Text', text: /Archived/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: '5/9' })).toBeDefined()
  await pane.unmount()
})

test('an archived TodoWrite task stays archived when the agent rewrites its list', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('tool.call', { tool: 'TodoWrite' }, async () => ({ result: {} as never }))
  const todos = (status: 'pending' | 'completed') => [
    { content: 'Old step', status: 'completed' as const, activeForm: 'x' },
    { content: 'Next step', status, activeForm: 'y' },
  ]
  await $.tool.call({ tool: 'TodoWrite', todos: todos('pending') } as never)
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  await pane.press({ key: 'toggle-manage' })
  await pane.press({ key: 'archive-todo-0' })
  await pane.press({ key: 'save-edit' })
  await $.tool.call({ tool: 'TodoWrite', todos: todos('completed') } as never)
  expect(await pane.find({ type: 'Text', text: 'Old step' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'Archived (1) ▸' })).toBeDefined()
  await pane.unmount()
})

test('the Settings card switches settings and the model through the config', async ($, on) => {
  const set: unknown[] = []
  on('config.set', async (_$, e) => (set.push([e.key, e.value]), { value: e.value }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'Check tasks you type' })).toBeUndefined()
  await pane.press({ key: 'toggle-settings' })
  await pane.press({ key: 'setting-autoSummary' })
  await pane.press({ key: 'setting-renameSession' })
  await pane.press({ key: 'model-sonnet' })
  await pane.unmount()
  expect(set).toEqual([
    ['session-glance.autoSummary', false],
    ['session-glance.renameSession', true],
    ['session-glance.summaryModel', 'sonnet'],
  ])
})

test('Edit mode opens in one card; the other keeps its tasks and hides its Edit button', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  await pane.press({ key: 'toggle-manage-mine' })
  expect(await pane.find({ type: 'Button', key: 'remove-demo-8' })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'remove-demo-1' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'task-demo-1' })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'toggle-manage' })).toBeUndefined()
  await pane.press({ key: 'cancel-edit-mine' })
  expect(await pane.find({ type: 'Button', key: 'toggle-manage' })).toBeDefined()
  await pane.unmount()
})

test('Edit mode keeps one line about nesting; a click on the info mark shows the rest', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  for (const surface of ['desktop', 'terminal'] as const) {
    const pane = await $.ui.mount({ plugin: 'session-glance', surface, component: 'Pane', requestId: 'session-glance', props: PANE as never })
    await pane.press({ key: 'toggle-manage' })
    expect(await pane.find({ type: 'Text', text: 'Drag ⠿ right to nest a task under the one above' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Nothing changes until Save/ })).toBeUndefined()
    await pane.press({ key: 'edit-help' })
    expect(await pane.find({ type: 'Text', text: /Nothing changes until Save/ })).toBeDefined()
    await pane.press({ key: 'edit-help' })
    await pane.press({ key: 'cancel-edit' })
    await pane.unmount()
  }
  expect(infoIcon(true)).toContain('#d97757')
})

test('a new session offers the open to-dos the last session in this project left', async ($, on) => {
  const old = {
    root: '/work/site',
    tasks: [
      { id: 'user-1', subject: 'Push develop', status: 'pending', owner: 'user' },
      { id: 'user-1a', subject: 'Tag the release', status: 'pending', owner: 'user', parentId: 'user-1' },
      { id: 'user-2', subject: 'Reply to the agency', status: 'completed', owner: 'user' },
      { id: 'user-3', subject: 'Old idea', status: 'pending', owner: 'user', archived: true },
      { id: 't1', subject: 'Agent work', status: 'pending' },
    ],
  }
  const other = { root: '/work/other', tasks: [{ id: 'user-9', subject: 'Elsewhere', status: 'pending', owner: 'user' }] }
  mock.store(on, { sessions: ['s1', 's0'], 'session:s1': old, 'session:s0': other })
  const session = mock.session(on)
  let root = '/work/site'
  on('session.id', async () => ({ value: 's2' }))
  on('session.root', async () => ({ value: root }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))

  await $.prompt.submit({ text: 'hi' } as never)
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: '1 open to-do from your last session here' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Push develop' })).toBeDefined()
  await pane.press({ key: 'bring-todos' })
  expect(await pane.find({ type: 'Text', text: /open to-do from your last session/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'Tag the release' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Reply to the agency' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'Agent work' })).toBeUndefined()
  await pane.unmount()
  expect(newTodos(openTodos(old.tasks as never), [{ id: 'user-7', subject: 'push develop', status: 'pending', owner: 'user' }] as never)).toEqual([])
  expect(JSON.stringify(session.appended())).toContain('brought their open to-dos')
  expect(openTodos(old.tasks as never).map(task => task.id)).toEqual(['user-1', 'user-1a'])
  root = '/work/none'
})

test('no offer in a project without an earlier session, or in a session that was saved before', async ($, on) => {
  mock.store(on, { sessions: ['s1'], 'session:s1': { root: '/work/site', tasks: [{ id: 'user-1', subject: 'Push develop', status: 'pending', owner: 'user' }] } })
  let id = 's2'
  on('session.id', async () => ({ value: id }))
  on('session.root', async () => ({ value: '/work/elsewhere' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  await $.prompt.submit({ text: 'hi' } as never)
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: /from your last session/ })).toBeUndefined()
  id = 's1'
  await $.prompt.submit({ text: 'back' } as never)
  expect(await pane.find({ type: 'Text', text: /from your last session/ })).toBeUndefined()
  await pane.unmount()
})

test('yourMoveFrom takes the status line, else a closing question', () => {
  expect(yourMoveFrom('Done.', 'Push the branch')).toBe('Push the branch')
  expect(yourMoveFrom('All set.\n\nShall I merge it?', 'none')).toBe('answer the question')
  expect(yourMoveFrom('Is it fine? Yes, it is.', undefined)).toBe('')
})

test('the band says it is your move between turns, and drops it at your next prompt', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('turn.complete', async () => ({ text: '' }))
  on('prompt.submit', async (_$, e) => ({ text: e.text }))
  on('model.complete', async () => ({
    value: {
      isAnswered: true as const,
      text: 'TITLE: Ship\nGOAL: Ship it\nDONE_WHEN: [ ] Pushed\nDONE: Committed\nNEXT: Push\nDRIFT: none\nYOUR_MOVE: Push develop',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  await $.turn.complete(turn('Committed; push when ready.', 't1'))
  const idle = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  expect(await idle.find({ type: 'Text', text: '● your move: Push develop' })).toBeDefined()
  await idle.unmount()
  const working = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, isWorking: true } as never })
  expect(await working.find({ type: 'Text', text: /your move/ })).toBeUndefined()
  await working.unmount()
  await $.prompt.submit({ text: 'pushed' } as never)
  const after = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  expect(await after.find({ type: 'Text', text: /your move/ })).toBeUndefined()
  await after.unmount()
})

test('appendHistory keeps one entry per change, newest last, at most HISTORY_SIZE', () => {
  const one = appendHistory([], 'Wrote tests', 1)
  expect(appendHistory(one, 'wrote tests', 2)).toEqual(one)
  expect(appendHistory(one, '', 2)).toEqual(one)
  expect(appendHistory(one, 'Pushed', 2)).toEqual([{ turn: 1, done: 'Wrote tests' }, { turn: 2, done: 'Pushed' }])
  const full = Array.from({ length: HISTORY_SIZE }, (_, i) => ({ turn: i, done: `d${i}` }))
  expect(appendHistory(full, 'new', 99).length).toBe(HISTORY_SIZE)
})

test('the Status card keeps what earlier turns did under Earlier', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('session.turns', async () => ({ value: turns }))
  on('turn.complete', async () => ({ text: '' }))
  let turns = 0
  let done = ''
  on('model.complete', async () => ({
    value: {
      isAnswered: true as const,
      text: `TITLE: Ship\nGOAL: Ship it\nDONE_WHEN: [ ] Pushed\nDONE: ${done}\nNEXT: Push\nDRIFT: none\nYOUR_MOVE: none`,
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }))
  for (const [i, text] of ['Wrote the tests', 'Fixed the parser', 'Committed'].entries()) {
    turns = i + 1
    done = text
    await $.turn.complete(turn(text, `t${i}`))
  }
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'Earlier (2) ▸' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Wrote the tests' })).toBeUndefined()
  await pane.press({ key: 'toggle-history' })
  expect(await pane.find({ type: 'Text', text: 'Wrote the tests' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '#2' })).toBeDefined()
  await pane.unmount()
})

test('a resumed session gets its pane back as soon as its own id arrives, before any prompt', async ($, on) => {
  const saved = { root: '/work/site', title: 'Session glance demo', summary: 'GOAL: Demo', tasks: [{ id: 'demo-1', subject: 'Sketch the pane layout', status: 'completed' }] }
  mock.store(on, { sessions: ['real'], 'session:real': saved })
  const clock = mock.clock(on)
  // The process starts under a passing id; the resumed transcript's id takes over a moment later.
  let id = 'passing'
  on('session.id', async () => ({ value: id }))
  on('session.root', async () => ({ value: '/work/site' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('ui.selection', async () => ({ value: undefined }))

  await $.session.start({ cwd: '/work/site', surface: 'terminal', isInteractive: true })
  await clock.advance(400)
  id = 'real'
  await clock.advance(400)
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'Sketch the pane layout' })).toBeDefined()
  await pane.unmount()
})

test('applyPlan follows the desktop task list: a new list, advance, done and start', () => {
  const plan = applyPlan([], {
    items: [
      { content: 'Read the code', status: 'in_progress' },
      { content: 'Fix it', status: 'pending' },
      { content: 'Test it', status: 'pending' },
    ],
  })
  const statuses = (list: { status: string }[]) => list.map(task => task.status)
  expect(plan.map(task => task.id)).toEqual(['plan-0', 'plan-1', 'plan-2'])
  expect(statuses(applyPlan(plan, { advance: true }))).toEqual(['completed', 'in_progress', 'pending'])
  expect(statuses(applyPlan(plan, { done: [1, 2], start: 3 }))).toEqual(['completed', 'completed', 'in_progress'])
  // A new list replaces the old steps; the person's own tasks stay.
  const mine = { id: 'user-1', subject: 'Push', status: 'pending' as const, owner: 'user' as const }
  expect(applyPlan([...plan, mine], { items: [{ content: 'Only step', status: 'pending' }] }).map(task => task.subject)).toEqual(['Push', 'Only step'])
})

test('update_plan calls in a desktop session fill the Agent tasks card', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('tool.call', async () => ({ result: { text: 'Plan shown (2 steps).' } as never }))
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'Read the code', status: 'in_progress' }, { content: 'Fix it', status: 'pending' }] } as never)
  await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true } as never)
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'Fix it' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '1/2' })).toBeDefined()
  await pane.unmount()
})

test('Manual mode makes no model calls and hides the Smart settings', { options: { mode: 'manual' } }, async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  let calls = 0
  on('model.complete', async () => (calls++, { value: REPLY }))
  on('turn.complete', async () => ({ text: '' }))
  await $.turn.complete({ answer: 'Tests pass.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  await pane.input({ key: 'add-task-mine-0', text: 'Push develop' })
  expect(await pane.find({ type: 'Text', text: 'Push develop' })).toBeDefined()
  expect(calls).toBe(0)
  await pane.press({ key: 'toggle-settings' })
  expect(await pane.find({ type: 'Button', key: 'mode-manual' })).toBeDefined()
  expect(await pane.find({ type: 'Button', key: 'setting-autoSummary' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'model-haiku' })).toBeUndefined()
  expect(await pane.find({ type: 'Button', key: 'setting-showStatus' })).toBeDefined()
  await pane.unmount()
})

test('a hidden card leaves the pane, and its count leaves the band', { options: { showAgentTasks: false } }, async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'Add the toggle above the prompt' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'Write the README' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Glanceable status/ })).toBeDefined()
  await pane.unmount()
  const band = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  expect(await band.find({ type: 'Text', text: /tasks/ })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /2 for you/ })).toBeDefined()
  await band.unmount()
})

test('the Settings card ends with the mod\'s version, read from its manifest', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  mock.clock(on)
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  const read: string[] = []
  on('fs.read', async (_$, e) => (read.push(e.path), { value: '{ "name": "session-glance", "version": "9.8.7" }' }))
  await $.session.start({ cwd: '/tmp', surface: 'desktop', isInteractive: true })
  expect(read.some(path => path.endsWith('/.claude-plugin/plugin.json'))).toBe(true)
  const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  expect(await pane.find({ type: 'Text', text: 'session-glance 9.8.7' })).toBeUndefined()
  await pane.press({ key: 'toggle-settings' })
  expect(await pane.find({ type: 'Text', text: 'session-glance 9.8.7' })).toBeDefined()
  await pane.unmount()
})

test('a wide pane (docked at the top or bottom) lays the cards and the Settings sections out as columns', async ($, on) => {
  mock.store(on)
  on('session.id', async () => ({ value: 's1' }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  for (const [bodyColumns, direction] of [[158, 'row'], [71, 'column']] as const) {
    const pane = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: { ...PANE, bodyColumns } as never })
    expect((await pane.find({ type: 'Box', key: 'cards' }))?.props.flexDirection).toBe(direction)
    expect(await pane.find({ type: 'Text', text: 'Write the README' })).toBeDefined()
    // The Settings card stays open from the first mount, so it is opened once.
    if ((await pane.find({ type: 'Box', key: 'settings-sections' })) === undefined) {
      await pane.press({ key: 'toggle-settings' })
    }
    expect((await pane.find({ type: 'Box', key: 'settings-sections' }))?.props.flexDirection).toBe(direction)
    await pane.unmount()
  }
})
