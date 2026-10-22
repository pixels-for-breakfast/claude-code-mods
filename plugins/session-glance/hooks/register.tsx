import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren } from 'claude-code'

import type { Task } from '../types'
import { HANDLE_CELLS } from './task-list'
import { displayRows, planDrop, progress, shownStatus } from './tree'
import type { Row, ShownStatus } from './tree'

const PANE = 'session-glance'
const summary = atom({ plugin: 'session-glance', key: 'summary' } as const, '')
const lastPrompt = atom({ plugin: 'session-glance', key: 'lastPrompt' } as const, '')
const isSummarizing = atom({ plugin: 'session-glance', key: 'isSummarizing' } as const, false)
const tasks = atom({ plugin: 'session-glance', key: 'tasks' } as const, [] as Task[])
const title = atom({ plugin: 'session-glance', key: 'title' } as const, '')
const isSummaryOpen = atom({ plugin: 'session-glance', key: 'isSummaryOpen' } as const, true)
const isTasksOpen = atom({ plugin: 'session-glance', key: 'isTasksOpen' } as const, true)
const isPaneOpen = atom({ plugin: 'session-glance', key: 'isPaneOpen' } as const, false)
const isManaging = atom({ plugin: 'session-glance', key: 'isManaging' } as const, false)
const isValidating = atom({ plugin: 'session-glance', key: 'isValidating' } as const, false)
const addCount = atom({ plugin: 'session-glance', key: 'addCount' } as const, 0)
const selectedId = atom({ plugin: 'session-glance', key: 'selectedId' } as const, '')
const draft = atom({ plugin: 'session-glance', key: 'draft' } as const, [] as Task[])
const draftBaseIds = atom({ plugin: 'session-glance', key: 'draftBaseIds' } as const, [] as string[])
const subtaskCount = atom({ plugin: 'session-glance', key: 'subtaskCount' } as const, 0)
const folded = atom({ plugin: 'session-glance', key: 'folded' } as const, [] as string[])

/** The status fields, each label in a theme colour for what it means, so the card reads at a glance in light and dark. */
const FIELDS = [
  { key: 'goal', label: 'Goal', color: 'suggestion' },
  { key: 'done_when', label: 'Done when', color: 'permission' },
  { key: 'done', label: 'Done', color: 'success' },
  { key: 'next', label: 'Next', color: 'warning' },
] as const
const GLYPH = { in_progress: '◐', partial: '◒', pending: '○', completed: '●' } as const

/** Rounded-square checkboxes in the desktop sidebar's grey; in progress and partly done in the accent. */
const ICON: Record<ShownStatus, string> = {
  partial:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="#d97757" stroke-width="1.4"/><path d="M5.2 8h5.6" stroke="#d97757" stroke-width="1.8" stroke-linecap="round"/></svg>',
  pending:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="#8a8a8a" stroke-width="1.4"/></svg>',
  in_progress:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3" fill="none" stroke="#d97757" stroke-width="1.4"/><rect x="5.5" y="5.5" width="5" height="5" rx="1.2" fill="#d97757"/></svg>',
  completed:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="3" fill="#6f6f6f"/><path d="M5 8.2l2 2 4-4.4" fill="none" stroke="#f4f4f4" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
}

/** Fold chevrons for a main task with subtasks. */
const FOLD = {
  open: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4.5 6.5l3.5 3.5 3.5-3.5" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  closed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6.5 4.5l3.5 3.5-3.5 3.5" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
} as const

/** A trash bin in the sidebar's grey: drawn as a picture, pressed through the Button laid over it. */
const TRASH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#8a8a8a" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.2h11M6.2 4.2V2.8h3.6v1.4M4 4.2l.7 9h6.6l.7-9M6.7 6.6v4.6M9.3 6.6v4.6"/></svg>'

const DEMO_TASKS: Task[] = [
  { id: 'demo-1', subject: 'Sketch the pane layout', status: 'completed' },
  { id: 'demo-2', subject: 'Write the summary prompt', status: 'completed' },
  { id: 'demo-3', subject: 'Add the toggle above the prompt', status: 'in_progress' },
  { id: 'demo-3a', subject: 'Draw the button', status: 'completed', parentId: 'demo-3' },
  { id: 'demo-3b', subject: 'Wire the hotkey', status: 'pending', parentId: 'demo-3' },
  { id: 'demo-4', subject: 'Seed fake tasks for a demo', status: 'pending' },
  { id: 'demo-5', subject: 'Try it in a fresh session', status: 'pending' },
  { id: 'demo-6', subject: 'Polish the terminal spacing', status: 'in_progress' },
  { id: 'demo-7', subject: 'Ship the drag-and-drop editor', status: 'pending' },
  { id: 'demo-7a', subject: 'Draw the drop line', status: 'completed', parentId: 'demo-7' },
  { id: 'demo-7b', subject: 'Nest by dragging sideways', status: 'completed', parentId: 'demo-7' },
  { id: 'demo-8', subject: 'Write the README', status: 'pending' },
  { id: 'demo-8a', subject: 'Explain the /glance command', status: 'pending', parentId: 'demo-8' },
  { id: 'demo-8b', subject: 'Add screenshots', status: 'pending', parentId: 'demo-8' },
]

/**
 * The demo's status card and title, in the shape Haiku writes them. With DEMO_TASKS it shows every
 * state the pane draws: pending, in progress, done, a partly done main task, a main task done by its
 * subtasks, and a folded one (DEMO_FOLDED).
 */
const DEMO_TITLE = 'Session glance demo'
const DEMO_SUMMARY = [
  'GOAL: Glanceable status and checklist beside the session',
  'DONE_WHEN: Every task state, subtasks and folding show correctly',
  'DONE: Seeded a demo of everything the pane can show',
  'NEXT: Click a task, then try Edit mode and drag one',
].join('\n')
const DEMO_FOLDED = ['demo-8']

/** Splits the model's reply into the session title and the summary lines below it. */
export function splitReply(reply: string): { title: string; summary: string } {
  const match = reply.trim().match(/^TITLE:\s*(.+)\n?([\s\S]*)$/)

  return match ? { title: (match[1] ?? '').trim().slice(0, 80), summary: (match[2] ?? '').trim() } : { title: '', summary: reply.trim() }
}

/** Reads `Label: value` lines (any case) into goal / done_when / done / next; prose without labels comes back whole as `goal`. */
export function parseSummary(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*[-*]?\s*(goal|done[\s_-]*when|done|next)\s*:\s*(.+)$/i)
    if (match?.[1] && match[2]) {
      fields[match[1].toLowerCase().replace(/[\s-]+/g, '_')] = match[2].trim()
    }
  }

  return Object.keys(fields).length === 0 && text.trim() !== '' ? { goal: text.trim() } : fields
}

/** Builds the rolling-summary prompt: the previous status is folded together with the latest exchange. */
export function summaryPrompt(previous: string, prompt: string, answer: string): string {
  return [
    'You keep a glanceable status of a coding session. Reply with exactly these five lines and nothing else:',
    'TITLE: <session title, max 6 words>',
    'GOAL: <what the user is after, max 12 words>',
    'DONE_WHEN: <checkable criteria that mean the goal is reached, max 15 words>',
    'DONE: <what was just finished, max 12 words>',
    'NEXT: <the next step or open question, max 12 words>',
    'Terse fragments, no full sentences, no markdown, no repetition between lines.',
    `<previous_status>${previous ? FIELDS.map(field => `${field.key.toUpperCase()}: ${parseSummary(previous)[field.key] ?? ''}`).join('\n') : '(none yet)'}</previous_status>`,
    `<latest_user_message>${prompt.slice(0, 4000)}</latest_user_message>`,
    `<latest_assistant_reply>${answer.slice(0, 8000)}</latest_assistant_reply>`,
  ].join('\n')
}

/** Desktop chevrons in the sidebar's grey, drawn beside the header label as the app's own cards do. */
const CHEVRON = {
  open: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4.5 6.5l3.5 3.5 3.5-3.5" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  closed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6.5 4.5l3.5 3.5-3.5 3.5" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
} as const

type Verdict = { verdict: 'ok' | 'unclear' | 'duplicate'; subject: string; question: string; options: string[]; duplicateOf: string }

/** Reads Haiku's JSON verdict on a task; anything unreadable is treated as "fine as typed". */
export function parseVerdict(reply: string, typed: string): Verdict {
  const fallback: Verdict = { verdict: 'ok', subject: typed, question: '', options: [], duplicateOf: '' }
  const json = reply.match(/\{[\s\S]*\}/)?.[0]
  if (json === undefined) {
    return fallback
  }
  try {
    const raw = JSON.parse(json) as Partial<Verdict>
    const verdict = raw.verdict === 'unclear' || raw.verdict === 'duplicate' ? raw.verdict : 'ok'
    const options = Array.isArray(raw.options) ? raw.options.filter(o => typeof o === 'string' && o.trim() !== '').slice(0, 3) : []

    return {
      verdict: verdict === 'unclear' && options.length === 0 ? 'ok' : verdict,
      subject: typeof raw.subject === 'string' && raw.subject.trim() !== '' ? raw.subject.trim() : typed,
      question: typeof raw.question === 'string' ? raw.question.trim() : '',
      options,
      duplicateOf: typeof raw.duplicateOf === 'string' ? raw.duplicateOf.trim() : '',
    }
  } catch {
    return fallback
  }
}

/** Builds the validation prompt for a task the person typed. */
export function validationPrompt(typed: string, goal: string, existing: readonly Task[]): string {
  return [
    'A user is adding a task to the checklist of a coding session. Judge the typed text and reply with one JSON object:',
    '{"verdict":"ok"|"unclear"|"duplicate","subject":"<clean imperative task, max 10 words>","question":"<one short question>","options":["<2-3 concrete candidate tasks>"],"duplicateOf":"<existing task>"}',
    '- ok: the task is concrete enough to act on; "subject" is its tidied wording (keep the meaning, fix typos).',
    '- unclear: only when you cannot write a concrete task without guessing; ask the question and give options that each resolve it.',
    '- duplicate: it means the same as an open existing task; name it in "duplicateOf".',
    `<session_goal>${goal || '(unknown)'}</session_goal>`,
    `<existing_tasks>${existing.map(task => `- [${task.status}] ${task.subject}`).join('\n') || '(none)'}</existing_tasks>`,
    `<typed_task>${typed.slice(0, 500)}</typed_task>`,
  ].join('\n')
}

/** Puts a list in the order of `ids`; tasks the ids do not name keep their place at the end. */
export function reorder(list: readonly Task[], ids: readonly string[]): Task[] {
  const named = ids.map(id => list.find(task => task.id === id)).filter((task): task is Task => task !== undefined)

  return [...named, ...list.filter(task => !ids.includes(task.id))]
}

/** Commits an edit draft: tasks that arrived while editing (from Claude, or added) are kept after it. */
export function mergeDraft(current: readonly Task[], edited: readonly Task[], baseIds: readonly string[]): Task[] {
  return [...edited, ...current.filter(task => !baseIds.includes(task.id))]
}

/** Describes what an edit changed, for the model; empty when nothing did. */
export function describeChanges(before: readonly Task[], after: readonly Task[]): string {
  const removed = before.filter(task => !after.some(one => one.id === task.id)).map(task => `"${task.subject}"`)
  const added = after
    .filter(task => !before.some(one => one.id === task.id))
    .map(task => {
      const parent = after.find(one => one.id === task.parentId)

      return parent ? `"${task.subject}" as a subtask of "${parent.subject}"` : `"${task.subject}"`
    })
  const renamed = after.flatMap(task => {
    const old = before.find(one => one.id === task.id)

    return old && old.subject !== task.subject ? [`"${old.subject}" to "${task.subject}"`] : []
  })
  const kept = before.filter(task => after.some(one => one.id === task.id)).map(task => task.id)
  const isReordered = kept.join() !== after.filter(task => kept.includes(task.id)).map(task => task.id).join()
  const parts = [
    added.length > 0 ? `added ${added.join(', ')}` : '',
    removed.length > 0 ? `removed ${removed.join(', ')} (do not work on them unless asked)` : '',
    renamed.length > 0 ? `renamed ${renamed.join(', ')}` : '',
    isReordered ? `reordered the checklist to: ${after.map(task => `"${task.subject}"`).join(', ')}` : '',
  ].filter(part => part !== '')

  return parts.length === 0 ? '' : `The user edited the session checklist: ${parts.join('; ')}.`
}

/** Tells the model about a change the person made in the pane; it reads this on its next turn. */
async function tellModel($: EngineInterface, change: string): Promise<void> {
  await $.session.append({
    message: { type: 'user', content: [{ type: 'text', text: `<session-glance>${change} Treat that as a fact from now on.</session-glance>` }] },
  })
}

/** Asks the app's question dialog; a dismissed dialog counts as cancel. */
async function ask($: EngineInterface, question: string, options: string[]): Promise<string | undefined> {
  try {
    const answer = await $.ui.ask(question, { header: 'Task', options })

    return answer === 'Cancel' ? undefined : answer
  } catch {
    return undefined
  }
}

/** Has Haiku tidy the typed task and asks the person when it is unclear or a duplicate; undefined means cancelled. */
async function validateTask($: EngineInterface, typed: string, others: readonly Task[]): Promise<string | undefined> {
  await update($, isValidating, () => true)
  try {
    const reply = await $.model.complete({
      model: 'haiku',
      system: 'Reply with one JSON object only, no prose, no code fence.',
      prompt: validationPrompt(typed, parseSummary(await read($, summary)).goal ?? '', others),
      maxTokens: 300,
    })
    const verdict = parseVerdict(reply.isAnswered ? reply.text : '', typed)
    await update($, isValidating, () => false)
    if (verdict.verdict === 'unclear') {
      return ask($, verdict.question || `What exactly should "${typed}" do?`, [...verdict.options, 'Cancel'])
    }
    if (verdict.verdict === 'duplicate') {
      const answer = await ask($, `This looks like "${verdict.duplicateOf}". Add it anyway?`, ['Add anyway', 'Cancel'])

      return answer === undefined ? undefined : verdict.subject
    }

    return verdict.subject
  } finally {
    await update($, isValidating, () => false)
  }
}

async function addTask($: EngineInterface, typed: string): Promise<void> {
  if (typed.trim() === '') {
    return
  }
  await update($, addCount, n => n + 1)
  const subject = await validateTask($, typed.trim(), await read($, tasks))
  if (subject === undefined) {
    return
  }
  await update($, tasks, list => [...list, { id: `user-${crypto.randomUUID().slice(0, 8)}`, subject, status: 'pending' as const }])
  await tellModel($, `The user added the task "${subject}" to the session checklist.`)
}

/** Renames a task in the edit draft, after Haiku's check; saved or dropped with the draft. */
async function renameInDraft($: EngineInterface, task: Task, typed: string): Promise<void> {
  if (typed.trim() === '' || typed.trim() === task.subject) {
    return
  }
  const subject = await validateTask($, typed.trim(), (await read($, draft)).filter(one => one.id !== task.id))
  if (subject === undefined) {
    return
  }
  await update($, draft, list => list.map(one => (one.id === task.id ? { ...one, subject } : one)))
  await update($, selectedId, () => '')
}

/** Adds a subtask under a main task in the edit draft, after Haiku's check. */
async function addSubtaskInDraft($: EngineInterface, parent: Task, typed: string): Promise<void> {
  if (typed.trim() === '') {
    return
  }
  await update($, subtaskCount, n => n + 1)
  const subject = await validateTask($, typed.trim(), await read($, draft))
  if (subject === undefined) {
    return
  }
  const child: Task = { id: `user-${crypto.randomUUID().slice(0, 8)}`, subject, status: 'pending', parentId: parent.id }
  await update($, draft, list => [...list, child])
}

/** Removes a task from the edit draft; a main task takes its subtasks with it. */
async function removeFromDraft($: EngineInterface, task: Task): Promise<void> {
  await update($, draft, list => list.filter(one => one.id !== task.id && one.parentId !== task.id))
  await update($, selectedId, current => (current === task.id ? '' : current))
}

async function startEditing($: EngineInterface): Promise<void> {
  const current = await read($, tasks)
  await update($, draft, () => current)
  await update($, draftBaseIds, () => current.map(task => task.id))
  await update($, selectedId, () => '')
  await update($, isManaging, () => true)
}

async function stopEditing($: EngineInterface, isSaved: boolean): Promise<void> {
  if (isSaved) {
    const before = await read($, tasks)
    const baseIds = await read($, draftBaseIds)
    const edited = await read($, draft)
    const original = before.filter(task => baseIds.includes(task.id))
    await update($, tasks, current => mergeDraft(current, edited, baseIds))
    const change = describeChanges(original, edited)
    if (change !== '') {
      await tellModel($, change)
    }
  }
  await update($, isManaging, () => false)
  await update($, selectedId, () => '')
  await update($, draft, () => [])
}

const STATUS_CHOICES = {
  pending: [
    { label: 'Mark as done', status: 'completed' },
    { label: 'Start', status: 'in_progress' },
  ],
  in_progress: [
    { label: 'Mark as done', status: 'completed' },
    { label: 'Back to pending', status: 'pending' },
  ],
  completed: [{ label: 'Reopen', status: 'pending' }],
} as const
const STATUS_WORDS = { pending: 'pending', in_progress: 'in progress', completed: 'completed' } as const

/** Asks what to do with a task, then records the new status and tells the model. */
async function changeStatus($: EngineInterface, task: Task): Promise<void> {
  const all = await read($, tasks)
  const shown = shownStatus(task, all)
  const children = all.filter(one => one.parentId === task.id)
  const choices = STATUS_CHOICES[shown === 'partial' ? 'in_progress' : shown]
  const answer = await ask($, `What should happen to "${task.subject}"?`, [...choices.map(choice => choice.label), 'Cancel'])
  const choice = choices.find(one => one.label === answer)
  if (choice === undefined) {
    return
  }
  // Done or reopened on a main task carries to its subtasks; starting it leaves them be.
  const isCarried = choice.status !== 'in_progress' && children.length > 0
  await update($, tasks, list =>
    list.map(one => (one.id === task.id || (isCarried && one.parentId === task.id) ? { ...one, status: choice.status } : one)),
  )
  const sync = task.id.startsWith('demo-') || task.id.startsWith('user-') ? '' : ` If it is in your task list (id ${task.id}), update it to match.`
  const carried = isCarried ? `, and with it its ${children.length} subtasks` : ''
  await tellModel($, `The user marked the task "${task.subject}" as ${STATUS_WORDS[choice.status]}${carried} in the session pane.${sync}`)
}

/** Type and spacing: two steps up the API's five sizes (caption, footnote, body, heading, title), for reading at a glance. */
const TYPE = { text: 'heading', label: 'body', head: 'title', icon: 24, padX: 'xl', padY: 'lg' } as const

/** Clears everything the pane holds for this session, after the person confirms; true when it did. */
async function purge($: EngineInterface): Promise<boolean> {
  const answer = await ask($, 'Clear the status, the title and every task in the session pane? This cannot be undone.', ['Clear everything', 'Cancel'])
  if (answer !== 'Clear everything') {
    return false
  }
  const hadTasks = (await read($, tasks)).length > 0
  await update($, tasks, () => [])
  await update($, summary, () => '')
  await update($, title, () => '')
  await update($, folded, () => [])
  await update($, draft, () => [])
  await update($, selectedId, () => '')
  await update($, isManaging, () => false)
  if (hadTasks) {
    await tellModel($, 'The user cleared the session checklist; its tasks no longer apply unless they bring them up again.')
  }

  return true
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Session' })
  await update($, isPaneOpen, () => true)
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'glance', description: 'Toggle the session pane (`/glance demo` fills in a demo, `/glance purge` clears it, `/glance rename on|off` sets session renaming)' })
    void openPane($)

    return next(e)
  })

  on('command.run', { command: 'glance' }, async ($, e) => {
    const [word, value] = e.args.trim().split(/\s+/)
    if (word === 'rename') {
      // The plugin's own way to its setting: `/config` has two entries in the desktop app, and a recalled line picks the wrong one.
      const isOn = value === undefined ? options.renameSession !== true : value === 'on'
      if (value !== undefined && value !== 'on' && value !== 'off') {
        return { text: 'Use `/glance rename on`, `/glance rename off`, or `/glance rename` to switch it.' }
      }
      const { deny } = await $.config.set({ key: 'session-glance.renameSession', value: isOn })
      if (deny !== undefined) {
        return { text: `Could not change the setting: ${deny}` }
      }

      return { text: isOn ? 'The status title will now rename this session at your next prompt.' : 'Sessions keep their own title now.' }
    }
    if (e.args.trim() === 'purge') {
      return { text: (await purge($)) ? 'Cleared the status, title and every task.' : 'Nothing was cleared.' }
    }
    if (e.args.trim() === 'demo') {
      await update($, tasks, () => DEMO_TASKS)
      await update($, summary, () => DEMO_SUMMARY)
      await update($, title, () => DEMO_TITLE)
      await update($, folded, () => DEMO_FOLDED)
      await openPane($)

      return { text: `Seeded the demo: a status and ${DEMO_TASKS.length} tasks in every state.` }
    }
    if (await read($, isPaneOpen)) {
      await $.ui.close({ id: PANE })

      return { text: 'Session pane closed.' }
    }
    await openPane($)

    return { text: 'Session pane opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      await update($, isPaneOpen, () => false)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    await update($, lastPrompt, () => e.text)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Off by default: a session list full of titles you did not write is hard to find your way in.
  // The host only takes a new session title at a prompt, so it trails the summary by one turn.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    if (options.renameSession !== true) {
      return result
    }
    const current = await read($, title)

    return current === '' ? result : { ...result, sessionTitle: current }
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if ('deny' in ran && ran.deny !== undefined) {
      return ran
    }
    // Bookkeeping only: a failure here must never fail the tool call it watched.
    try {
      if (e.tool === 'TaskCreate' && !ran.isError) {
        const created = ran.result as { task: { id: string; subject: string } }
        await update($, tasks, list => [...list, { id: created.task.id, subject: created.task.subject, status: 'pending' as const }])
      } else if (e.tool === 'TaskUpdate' && !ran.isError) {
        const { taskId, status, subject } = e
        await update($, tasks, list =>
          status === 'deleted'
            ? list.filter(task => task.id !== taskId)
            : list.map(task => (task.id === taskId ? { ...task, status: status ?? task.status, subject: subject ?? task.subject } : task)),
        )
      } else if (e.tool === 'TodoWrite' && !ran.isError) {
        // TodoWrite sends the whole list; the person's own tasks stay.
        await update($, tasks, list => [
          ...list.filter(task => !task.id.startsWith('todo-')),
          ...e.todos.map((todo, i) => ({ id: `todo-${i}`, subject: todo.content, status: todo.status })),
        ])
      }
    } catch {
      // The pane just misses this task change.
    }

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    // Only the main loop's answered turns move the summary; subagent turns would drown it.
    if (e.agentId !== undefined || e.reason !== 'answer' || e.answer === '') {
      return done
    }
    await update($, isSummarizing, () => true)
    const reply = await $.model.complete({
      model: 'haiku',
      system: 'Answer only with the five labelled lines asked for: TITLE, GOAL, DONE_WHEN, DONE, NEXT. No other labels, no extra lines.',
      prompt: summaryPrompt(await read($, summary), await read($, lastPrompt), e.answer),
      maxTokens: 300,
    })
    if (reply.isAnswered) {
      const parts = splitReply(reply.text)
      await update($, summary, () => parts.summary)
      if (parts.title !== '') {
        await update($, title, () => parts.title)
      }
    }
    await update($, isSummarizing, () => false)

    return done
  })

  on('ui.message', async ($, e, next) => {
    if (e.element !== 'edit-overlay') {
      return next(e)
    }
    const data = e.data as { type: 'drop' | 'select' | 'remove' | 'fold'; id: string; slot?: number; dx?: number }
    const task = (await read($, draft)).find(one => one.id === data.id)
    if (task === undefined) {
      return {}
    }
    if (data.type === 'drop') {
      const foldedIds = await read($, folded)
      await update($, draft, list => planDrop(list, data.id, data.slot ?? 0, data.dx ?? 0, foldedIds).list)
    } else if (data.type === 'select') {
      await update($, selectedId, current => (current === data.id ? '' : data.id))
    } else if (data.type === 'remove') {
      await removeFromDraft($, task)
    } else {
      await update($, folded, ids => (ids.includes(data.id) ? ids.filter(one => one !== data.id) : [...ids, data.id]))
    }

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOpen = await read($, isPaneOpen)
    const list = await read($, tasks)
    const { done, total } = progress(list)
    const current = await read($, title)
    const toggle = async (): Promise<void> => {
      if (isOpen) {
        // Our own close is not echoed back as a `ui.close` event, so record it here.
        await $.ui.close({ id: PANE })
        await update($, isPaneOpen, () => false)
      } else {
        await openPane($)
      }
    }

    return (
      <Box gap="sm" alignItems="center">
        <Button key="toggle-pane" plain dimColor hotkey={e.surface === 'terminal' ? 'g' : undefined} onPress={toggle}>
          <Text size="footnote" color="subtle">
            {isOpen ? '◂ Hide status' : '▸ Show status'}
          </Text>
        </Button>
        <Text size="footnote" color="inactive" wrap="truncate-end">
          {current || 'No status yet'}
          {total > 0 ? `  ·  ${done}/${total} tasks` : ''}
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const Client = 'Client' in table ? table.Client : undefined
    const Input = 'Input' in table ? table.Input : undefined
    const managing = await read($, isManaging)
    const checking = await read($, isValidating)
    const adds = await read($, addCount)
    const selected = await read($, selectedId)
    const subtaskAdds = await read($, subtaskCount)
    const foldedIds = await read($, folded)
    const fields = parseSummary(await read($, summary))
    const busy = await read($, isSummarizing)
    const stored = managing ? await read($, draft) : await read($, tasks)
    const rows = displayRows(stored, foldedIds)
    const showSummary = await read($, isSummaryOpen)
    const showTasks = await read($, isTasksOpen)
    const { done, total } = progress(stored)
    const hasSummary = Object.keys(fields).length > 0
    const isTerminal = e.surface === 'terminal'
    const type = TYPE
    // The terminal lays out whole cells only: two per Edit row, a blank one above the text that the drop line can use.
    // Elsewhere the heading-size rows take three.
    const rowHeight = isTerminal ? 2 : 3
    const { Svg } = e.surface === 'terminal' ? { Svg: undefined } : $.ui.resolve(e)

    // The terminal draws the small spacing steps as no rows at all, so it gets whole blank rows where the desktop's gaps fall.
    const airy = isTerminal ? 1 : 0
    const header = (key: string, label: string, isOpen: boolean, aside: RenderChildren, onPress: () => unknown) => (
      <Box justifyContent="space-between" alignItems="center" marginBottom={airy}>
        <Box alignItems="center" gap="xs">
          <Button key={key} plain onPress={onPress}>
            <Text weight="medium" size={type.head} color="claude">
              {label}
            </Text>
            {!Svg && <Text color="inactive">{isOpen ? ' ▾' : ' ▸'}</Text>}
          </Button>
          {Svg && <Svg source={isOpen ? CHEVRON.open : CHEVRON.closed} alt={isOpen ? 'collapse' : 'expand'} width={14} height={14} />}
        </Box>
        {aside}
      </Box>
    )
    const note = (text: string) => (
      <Text size={type.text} color="inactive">
        {text}
      </Text>
    )
    // A Button holds text only, so an icon that takes a press is a picture with an empty Button laid over it.
    const iconButton = (key: string, source: string, alt: string, glyph: string, onPress: () => unknown) =>
      Svg ? (
        <Box position="relative">
          <Svg source={source} alt={alt} width={type.icon} height={type.icon} />
          <Box position="absolute" top={0} left={0} width="100%" height="100%">
            <Button key={key} plain onPress={onPress}>
              <Text>{'\u2003'}</Text>
            </Button>
          </Box>
        </Box>
      ) : (
        <Button key={key} plain onPress={onPress}>
          <Text color="inactive">{glyph}</Text>
        </Button>
      )
    const toggleFold = (id: string) => update($, folded, ids => (ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id]))

    /** One task row: checkbox, text that shrinks before anything is pushed out, subtask count and fold caret, trash in Edit mode. */
    const taskRow = (row: Row, isEditing: boolean) => {
      const isFolded = foldedIds.includes(row.task.id)
      // The caret sits at the row's end, so rows with and without one keep their checkboxes in line.
      const fold =
        row.children > 0
          ? iconButton(`fold-${row.task.id}`, isFolded ? FOLD.closed : FOLD.open, isFolded ? 'expand' : 'collapse', isFolded ? '▸' : '▾', () => toggleFold(row.task.id))
          : null

      return (
        <Box
          key={`${isEditing ? 'edit' : 'row'}-${row.task.id}`}
          height={isEditing ? rowHeight : undefined}
          alignItems={isEditing && isTerminal ? 'flex-end' : 'center'}
          gap="sm"
          minWidth={0}
          paddingLeft={row.depth === 1 && !isEditing ? 3 : 0}
          // Edit rows keep their fixed pitch: the layer over them maps the pointer by it.
          marginTop={!isEditing && row.depth === 0 && row !== rows[0] ? airy : 0}
        >
          {isEditing && (
            <Box width={HANDLE_CELLS + (row.depth === 1 ? 3 : 0)} flexShrink={0}>
              <Text color="inactive">⠿</Text>
            </Box>
          )}
          {Svg ? (
            <Svg source={ICON[row.shown]} alt={row.shown.replace('_', ' ')} width={type.icon} height={type.icon} />
          ) : (
            <Text color={row.shown === 'in_progress' || row.shown === 'partial' ? 'claude' : 'inactive'}>{GLYPH[row.shown]}</Text>
          )}
          <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Button
              key={`${isEditing ? 'select' : 'task'}-${row.task.id}`}
              plain
              onPress={() => (isEditing ? update($, selectedId, current => (current === row.task.id ? '' : row.task.id)) : changeStatus($, row.task))}
            >
              <Text
                size={type.text}
                color={row.shown === 'completed' ? 'inactive' : undefined}
                strikethrough={!isEditing && row.shown === 'completed'}
                underline={isEditing && row.task.id === selected}
                wrap="truncate-end"
              >
                {row.task.subject}
              </Text>
            </Button>
          </Box>
          {row.children > 0 && note(`${row.childrenDone}/${row.children}`)}
          {fold}
          {isEditing && iconButton(`remove-${row.task.id}`, TRASH, 'Remove', '✕', () => removeFromDraft($, row.task))}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap="lg" padding={isTerminal ? 0 : 'md'}>
        <Box flexDirection="column" gap="sm" borderStyle="round" borderColor="subtle" paddingX={type.padX} paddingY={type.padY}>
          {header('toggle-summary', 'Status', showSummary, note(busy ? 'updating…' : ''), () => update($, isSummaryOpen, open => !open))}
          {showSummary && !hasSummary && (
            <Text size={type.text} color="inactive">
              Appears after the first answer.
            </Text>
          )}
          {showSummary &&
            FIELDS.filter(field => fields[field.key]).map(field => (
              <Box flexDirection="column" marginBottom={airy}>
                <Text size={type.label} color={field.color}>
                  {field.label}
                </Text>
                <Text size={type.text}>{fields[field.key]}</Text>
              </Box>
            ))}
        </Box>

        <Box flexDirection="column" gap="sm" borderStyle="round" borderColor="subtle" paddingX={type.padX} paddingY={type.padY}>
          {header(
            'toggle-tasks',
            'Tasks',
            showTasks,
            <Box gap="sm" alignItems="center">
              {checking || total === 0 || done < total ? (
                note(checking ? 'checking…' : total > 0 ? `${done}/${total}` : '')
              ) : (
                <Text size={type.text} color="success">
                  {`${done}/${total}`}
                </Text>
              )}
              {showTasks && !managing && (
                <Button key="toggle-manage" plain onPress={() => startEditing($)}>
                  <Text size={type.text} color="subtle">
                    Edit
                  </Text>
                </Button>
              )}
              {showTasks && managing && (
                <Button key="cancel-edit" plain onPress={() => stopEditing($, false)}>
                  <Text size={type.text} color="subtle">
                    Cancel
                  </Text>
                </Button>
              )}
              {showTasks && managing && (
                <Button key="save-edit" plain onPress={() => stopEditing($, true)}>
                  <Text size={type.text} color="claude" weight="medium">
                    Save
                  </Text>
                </Button>
              )}
            </Box>,
            () => update($, isTasksOpen, open => !open),
          )}
          {showTasks && rows.length === 0 && note('No tasks yet.')}
          {showTasks && managing && Client && rows.length > 0 && (
            // The rows below hold the icons; the layer on top draws handles and the drop line and takes the clicks.
            <Box flexDirection="column" position="relative" minWidth={0}>
              {rows.map(row => taskRow(row, true))}
              {isTerminal && <Box height={1} />}
              <Box position="absolute" top={0} left={0} right={0} bottom={0}>
                <Client
                  key="edit-overlay"
                  module="./task-list.tsx"
                  props={{ tasks: stored, folded: foldedIds, rowHeight, hasGapRows: isTerminal }}
                  width="100%"
                  height={Math.ceil(rows.length * rowHeight) + (isTerminal ? 1 : 0)}
                />
              </Box>
            </Box>
          )}
          {showTasks &&
            managing &&
            Input &&
            rows
              .filter(row => row.task.id === selected)
              .map(row => (
                <Box flexDirection="column" gap="xs" marginTop="sm" borderStyle="round" borderColor="subtle" paddingX="sm" paddingY="sm">
                  {note('Rename')}
                  <Input key={`rename-${row.task.id}`} value={row.task.subject} submitLabel="Rename" onSubmit={value => renameInDraft($, row.task, value)} />
                  {row.depth === 0 && (
                    <Box flexDirection="column" gap="xs" marginTop="xs">
                      {note('Add a subtask')}
                      <Input
                        key={`subtask-${row.task.id}-${subtaskAdds}`}
                        placeholder="What needs doing…"
                        submitLabel="Add"
                        onSubmit={value => addSubtaskInDraft($, row.task, value)}
                      />
                    </Box>
                  )}
                </Box>
              ))}
          {showTasks && managing && !selected && rows.length > 0 && (
            <Box marginTop={airy}>{note('Drag ⠿ to reorder, sideways to nest or un-nest · click a task to rename or add subtasks · nothing changes until Save')}</Box>
          )}
          {showTasks && (!managing || !Client) && rows.map(row => taskRow(row, false))}
          {showTasks && Input && (
            <Box marginTop={isTerminal ? 1 : 'sm'}>
              <Input key={`add-task-${adds}`} placeholder="Add a task…" submitLabel="Add" onSubmit={value => addTask($, value)} />
            </Box>
          )}
        </Box>
      </Box>
    )
  })
}
