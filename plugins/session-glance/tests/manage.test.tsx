import { expect, test } from 'claude-code/testing'

import { parseVerdict } from '../hooks/prompts'
import { describeChanges, displayRows, mergeDraft, planDrop, progress, reorder } from '../hooks/tree'

const PANE = { title: 'Session', isFocused: false, bodyColumns: 40, placement: 'dock' } as const
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

test('parseVerdict falls back to the typed text on anything unreadable', () => {
  expect(parseVerdict('not json', 'fix it').verdict).toBe('ok')
  expect(parseVerdict('not json', 'fix it').subject).toBe('fix it')
  expect(parseVerdict('{"verdict":"unclear","subject":"x","options":[]}', 'x').verdict).toBe('ok')
  expect(parseVerdict('```json\n{"verdict":"unclear","question":"Which?","options":["A","B"]}\n```', 'x').options).toEqual(['A', 'B'])
})

const LIST = [
  { id: 'a', subject: 'A', status: 'pending' as const },
  { id: 'b', subject: 'B', status: 'pending' as const },
  { id: 'c', subject: 'C', status: 'pending' as const },
  { id: 'd', subject: 'D', status: 'completed' as const },
]

test('planDrop reorders and says where the line goes', () => {
  const ids = (list: readonly { id: string }[]) => list.map(task => task.id)
  expect(ids(planDrop(LIST, 'c', 0, 0).list)).toEqual(['c', 'a', 'b', 'd'])
  expect(planDrop(LIST, 'c', 0, 0).lineBeforeId).toBe('a')
  expect(ids(planDrop(LIST, 'a', 3, 0).list)).toEqual(['b', 'c', 'a', 'd'])
  expect(planDrop(LIST, 'a', 3, 0).lineBeforeId).toBe('d')
  // A done task dropped among pending ones sorts back to the end, and the line says so.
  expect(planDrop(LIST, 'd', 0, 0).lineBeforeId).toBeNull()
})

test('planDrop lands where aimed when the task above the gap has another status', () => {
  // Stored with the in-progress task last, but it sorts to the top: rows are a, b, c.
  const mixed = [
    { id: 'b', subject: 'B', status: 'pending' as const },
    { id: 'c', subject: 'C', status: 'pending' as const },
    { id: 'a', subject: 'A', status: 'in_progress' as const },
  ]
  const plan = planDrop(mixed, 'c', 1, 0)
  expect(displayRows(plan.list).map(row => row.task.id)).toEqual(['a', 'c', 'b'])
  expect(plan.lineBeforeId).toBe('b')
})

test('planDrop nests by dragging right and un-nests by dragging left', () => {
  const nested = planDrop(LIST, 'b', 1, 3)
  expect(nested.depth).toBe(1)
  expect(nested.list.find(task => task.id === 'b')?.parentId).toBe('a')
  expect(nested.lineBeforeId).toBe('c')

  const tree = [
    { id: 'm', subject: 'Main', status: 'pending' as const },
    { id: 'm1', subject: 'Sub 1', status: 'pending' as const, parentId: 'm' },
    { id: 'n', subject: 'Next', status: 'pending' as const },
  ]
  const unNested = planDrop(tree, 'm1', 2, -3)
  expect(unNested.depth).toBe(0)
  expect(unNested.list.find(task => task.id === 'm1')?.parentId).toBeUndefined()
  expect(displayRows(unNested.list).map(row => row.task.id)).toEqual(['m', 'm1', 'n'])
  // A main task with subtasks cannot become a subtask itself.
  expect(planDrop(tree, 'm', 3, 3).depth).toBe(0)
})

test('a main task shows partial while its subtasks are part done, and moves with them', () => {
  const tree = [
    { id: 'm', subject: 'Main', status: 'pending' as const },
    { id: 'm1', subject: 'Sub 1', status: 'completed' as const, parentId: 'm' },
    { id: 'm2', subject: 'Sub 2', status: 'pending' as const, parentId: 'm' },
    { id: 'n', subject: 'Next', status: 'pending' as const },
  ]
  const rows = displayRows(tree)
  expect(rows[0]?.shown).toBe('partial')
  expect(rows.map(row => row.task.id)).toEqual(['m', 'm2', 'm1', 'n'])
  expect(progress(tree)).toEqual({ done: 1, total: 3 })
  expect(displayRows(tree.map(task => ({ ...task, status: 'completed' as const })))[0]?.shown).toBe('completed')
})

test('a saved draft keeps tasks that arrived while editing and describes the edit', () => {
  const edited = reorder(LIST, ['b', 'a', 'd']).map(task => (task.id === 'd' ? { ...task, subject: 'D2' } : task)).filter(task => task.id !== 'c')
  const arrived = { id: 'e', subject: 'E', status: 'pending' as const }
  expect(mergeDraft([...LIST, arrived], edited, ['a', 'b', 'c', 'd']).map(task => task.id)).toEqual(['b', 'a', 'd', 'e'])
  const change = describeChanges(LIST, edited)
  expect(change).toContain('removed "C"')
  expect(change).toContain('renamed "D" to "D2"')
  expect(change).toContain('reordered')
  expect(describeChanges(LIST, LIST)).toBe('')
})

test('an unclear task is clarified by a question before it is added', async ($, on) => {
  const asked: string[] = []
  on('model.complete', async () => ({
    value: {
      isAnswered: true,
      text: '{"verdict":"unclear","subject":"fix it","question":"Fix what?","options":["Fix the toggle label","Fix the caret alignment"]}',
      usage: USAGE,
    },
  }))
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const question = e.questions[0]?.question ?? ''
    asked.push(question)

    return { result: { questions: e.questions, answers: { [question]: 'Fix the caret alignment' } } as never }
  })
  on('ui.open', async () => ({ value: { isPlaced: true } }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'session-glance', surface, component: 'Pane', requestId: 'session-glance', props: PANE as never })
    if (surface === 'terminal') {
      await ui.input({ key: 'add-task-0', text: 'fix it' })
    }
    expect(await ui.find({ type: 'Text', text: 'Fix the caret alignment' })).toBeDefined()
    await ui.unmount()
  }
  expect(asked).toEqual(['Fix what?'])
})

test('Edit mode changes nothing until Save, and Cancel drops the draft', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('model.complete', async () => ({ value: { isAnswered: true, text: '{"verdict":"ok","subject":"Pick five tasks"}', usage: USAGE } }))
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const ui = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  const order = async () => (await ui.findAll({ type: 'Text' })).map(found => found.text).filter(text => text.trim() !== '')

  // Display rows: 0 toggle (partial), 1 wire, 2 draw, 3 polish, 4 seed, 5 try, 6 readme (folded), 7 sketch,
  // 8 write, 9 ship, 10-11 its subtasks. Rows are 3 cells high (the pointer reads a cell's middle):
  // cell 15 is in row 5 ("Try it…"), and cell 11 is nearest the gap above row 4 ("Seed…").
  const drag = async () => {
    await ui.pointer({ type: 'down', x: 0, y: 15, button: 'left', in: 'edit-overlay' })
    await ui.pointer({ type: 'move', x: 0, y: 11, button: 'left', in: 'edit-overlay' })
    await ui.pointer({ type: 'up', x: 0, y: 11, button: 'left', in: 'edit-overlay' })
  }

  await ui.press({ key: 'toggle-manage' })
  await ui.resize({ columns: 40, rows: 36, in: 'edit-overlay' } as never)
  await drag()
  await ui.press({ key: 'remove-demo-1' })
  await ui.press({ key: 'cancel-edit' })
  let rows = await order()
  expect(rows.indexOf('Seed fake tasks for a demo')).toBeLessThan(rows.indexOf('Try it in a fresh session'))
  expect(rows).toContain('Sketch the pane layout')

  await ui.press({ key: 'toggle-manage' })
  await ui.resize({ columns: 40, rows: 36, in: 'edit-overlay' } as never)
  await drag()
  await ui.press({ key: 'remove-demo-1' })
  // A click on a row's text, through the layer, selects it: after the drag and removal "Seed…" is row 5 (cells 15-18).
  await ui.pointer({ type: 'down', x: 10, y: 15, button: 'left', in: 'edit-overlay' })
  await ui.pointer({ type: 'up', x: 10, y: 15, button: 'left', in: 'edit-overlay' })
  await ui.input({ key: 'subtask-demo-4-0', text: 'Pick five tasks' })
  await ui.press({ key: 'save-edit' })
  rows = await order()
  expect(rows.indexOf('Try it in a fresh session')).toBeLessThan(rows.indexOf('Seed fake tasks for a demo'))
  expect(rows).not.toContain('Sketch the pane layout')
  // The subtask follows its main task, after the main task's 0/1 subtask count.
  expect(rows.slice(rows.indexOf('Seed fake tasks for a demo') + 1, rows.indexOf('Seed fake tasks for a demo') + 3)).toEqual(['0/1', 'Pick five tasks'])

  // Rows now: 0 toggle, 1 wire, 2 draw, 3 polish, 4 try, 5 seed, 6 pick, 7 readme, … Drag "Try…" (row 4, cell 12)
  // three cells right onto the gap above "Pick…" (slot 6, cell 17): it becomes a subtask of "Seed…".
  await ui.press({ key: 'toggle-manage' })
  await ui.resize({ columns: 40, rows: 36, in: 'edit-overlay' } as never)
  await ui.pointer({ type: 'down', x: 0, y: 12, button: 'left', in: 'edit-overlay' })
  await ui.pointer({ type: 'move', x: 3, y: 17, button: 'left', in: 'edit-overlay' })
  // The landing line is drawn by the layer itself while the pointer is still down.
  expect(await ui.find({ type: 'Text', text: /^[▔─▁]+$/, in: 'edit-overlay' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 3, y: 17, button: 'left', in: 'edit-overlay' })
  await ui.press({ key: 'save-edit' })
  rows = await order()
  expect(rows[rows.indexOf('Seed fake tasks for a demo') + 1]).toBe('0/2')

  await ui.press({ key: 'fold-demo-4' })
  expect(await order()).not.toContain('Pick five tasks')
  await ui.press({ key: 'fold-demo-4' })
  expect(await order()).toContain('Pick five tasks')
  await ui.unmount()
})

test('marking a main task done carries to its subtasks', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const question = e.questions[0]?.question ?? ''

    return { result: { questions: e.questions, answers: { [question]: 'Mark as done' } } as never }
  })
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const ui = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  await ui.press({ key: 'task-demo-3' })
  expect(await ui.find({ type: 'Text', text: '6/9' })).toBeDefined()
  await ui.unmount()
})

test('Edit mode draws on the terminal, whose cells are whole', async ($, on) => {
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const ui = await $.ui.mount({ plugin: 'session-glance', surface: 'terminal', component: 'Pane', requestId: 'session-glance', props: PANE as never })
  await ui.press({ key: 'toggle-manage' })
  await ui.resize({ columns: 40, rows: 7, in: 'edit-overlay' } as never)
  await ui.pointer({ type: 'down', x: 0, y: 4, button: 'left', in: 'edit-overlay' })
  await ui.pointer({ type: 'move', x: 0, y: 3, button: 'left', in: 'edit-overlay' })
  expect(await ui.find({ type: 'Text', text: /^[▔─▁]+$/, in: 'edit-overlay' })).toBeDefined()
  await ui.pointer({ type: 'up', x: 0, y: 3, button: 'left', in: 'edit-overlay' })
  await ui.unmount()
})

test('/glance purge clears everything after confirming, and Cancel keeps it', async ($, on) => {
  let reply = 'Cancel'
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const question = e.questions[0]?.question ?? ''

    return { result: { questions: e.questions, answers: { [question]: reply } } as never }
  })
  await $.command.run({ command: 'glance', args: 'demo' } as never)
  const ui = await $.ui.mount({ plugin: 'session-glance', surface: 'desktop', component: 'Pane', requestId: 'session-glance', props: PANE as never })

  await $.command.run({ command: 'glance', args: 'purge' } as never)
  expect(await ui.find({ type: 'Text', text: 'Write the README' })).toBeDefined()

  reply = 'Clear everything'
  await $.command.run({ command: 'glance', args: 'purge' } as never)
  expect(await ui.find({ type: 'Text', text: 'Write the README' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'No tasks yet.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Appears after the first answer/ })).toBeDefined()
  await ui.unmount()
})
