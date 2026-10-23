import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteRequest, ModelCompleteResult, Register, RenderChildren, RenderSurface } from 'claude-code'

import type { Owner, Spent, Task } from '../types'
import { HANDLE_CELLS } from './task-list'
import { activeOf, displayRows, moveTask, ownedBy, ownerOf, planDrop, progress, setArchived, shownStatus } from './tree'
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
const lastAnswer = atom({ plugin: 'session-glance', key: 'lastAnswer' } as const, '')
/** Done-when criteria the person ticked by hand, lowercased; the model cannot untick them. */
const ticked = atom({ plugin: 'session-glance', key: 'ticked' } as const, [] as string[])
const spent = atom({ plugin: 'session-glance', key: 'spent' } as const, { calls: 0, input: 0, output: 0 } as Spent)
/** The session id whose saved pane was loaded; another id means /resume, /clear or a restart moved on. */
const restoredFor = atom({ plugin: 'session-glance', key: 'restoredFor' } as const, '')
/** The title the session is known by: the first status title, or a suggestion the person used. */
const titleAnchor = atom({ plugin: 'session-glance', key: 'titleAnchor' } as const, '')
const titleSuggestion = atom({ plugin: 'session-glance', key: 'titleSuggestion' } as const, '')
/** A title the person chose, set as the session title at their next prompt (the only time the host takes one). */
const pendingTitle = atom({ plugin: 'session-glance', key: 'pendingTitle' } as const, '')
/** Suggestions the person dismissed, lowercased, so the same one is not offered again. */
const dismissedTitles = atom({ plugin: 'session-glance', key: 'dismissedTitles' } as const, [] as string[])
const isMineOpen = atom({ plugin: 'session-glance', key: 'isMineOpen' } as const, true)
const mineAddCount = atom({ plugin: 'session-glance', key: 'mineAddCount' } as const, 0)
/** The next thing the person must do, as the status model reads the last exchange; offered in the You card. */
const moveSuggestion = atom({ plugin: 'session-glance', key: 'moveSuggestion' } as const, '')
const dismissedMoves = atom({ plugin: 'session-glance', key: 'dismissedMoves' } as const, [] as string[])
/** Whether text is selected on screen now, polled: the API raises no event when a selection changes. */
const hasSelection = atom({ plugin: 'session-glance', key: 'hasSelection' } as const, false)
/** The cards whose Archived fold is open. */
const openArchives = atom({ plugin: 'session-glance', key: 'openArchives' } as const, [] as Owner[])
const isSettingsOpen = atom({ plugin: 'session-glance', key: 'isSettingsOpen' } as const, false)
/** How often the selection is checked for the band's buttons. */
const SELECTION_POLL_MS = 400

/** The person's settings (`userConfig`), set by `register` on every load; a change in the config menu reloads it. */
const settings = { model: 'haiku', isAutoSummary: true, isTaskCheck: true, isTitleSuggest: true }

/** Calls the model and adds what the call cost to the session's count, answered or not. */
async function complete($: EngineInterface, request: Omit<ModelCompleteRequest, 'model'>): Promise<ModelCompleteResult> {
  const reply = await $.model.complete({ ...request, model: settings.model })
  const usage = 'usage' in reply ? reply.usage : undefined
  if (usage !== undefined) {
    await update($, spent, total => ({
      calls: total.calls + 1,
      input: total.input + usage.input_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
      output: total.output + usage.output_tokens,
    }))
  }

  return reply
}

/** Token counts as the footer shows them: 950, 1.2k, 18k. */
export function formatTokens(count: number): string {
  return count < 1000 ? `${count}` : count < 10_000 ? `${(count / 1000).toFixed(1)}k` : `${Math.round(count / 1000)}k`
}

/** One saved pane per session in `$.store`, plus the ids newest last, so the oldest can be dropped. */
const SNAPSHOT_PREFIX = 'session:'
const SNAPSHOT_INDEX = 'sessions'
const KEEP_SESSIONS = 30

export type Snapshot = {
  summary: string
  title: string
  tasks: Task[]
  folded: string[]
  ticked: string[]
  spent: Spent
  titleAnchor: string
  titleSuggestion: string
  dismissedTitles: string[]
  moveSuggestion: string
  dismissedMoves: string[]
}

/** Saves what the pane shows under this session's id, so /resume and a restart bring it back. */
async function save($: EngineInterface): Promise<void> {
  try {
    const id = await $.session.id()
    // Only the session whose pane is loaded writes; right after /clear the old one's state is still here.
    if (id !== (await read($, restoredFor))) {
      return
    }
    const snapshot: Snapshot = {
      summary: await read($, summary),
      title: await read($, title),
      tasks: await read($, tasks),
      folded: await read($, folded),
      ticked: await read($, ticked),
      spent: await read($, spent),
      titleAnchor: await read($, titleAnchor),
      titleSuggestion: await read($, titleSuggestion),
      dismissedTitles: await read($, dismissedTitles),
      moveSuggestion: await read($, moveSuggestion),
      dismissedMoves: await read($, dismissedMoves),
    }
    await $.store.set(`${SNAPSHOT_PREFIX}${id}`, snapshot)
    const ids = [...(((await $.store.get(SNAPSHOT_INDEX)) as string[] | undefined) ?? []).filter(one => one !== id), id]
    for (const old of ids.slice(0, -KEEP_SESSIONS)) {
      await $.store.delete(`${SNAPSHOT_PREFIX}${old}`)
    }
    await $.store.set(SNAPSHOT_INDEX, ids.slice(-KEEP_SESSIONS))
  } catch {
    // The pane still works; this session just will not come back after a restart.
  }
}

/** Loads this session's saved pane once per session id: /resume and a restart bring it back, /clear starts empty. */
async function restore($: EngineInterface): Promise<void> {
  try {
    const id = await $.session.id()
    const previous = await read($, restoredFor)
    if (previous === id) {
      return
    }
    const saved = (await $.store.get(`${SNAPSHOT_PREFIX}${id}`)) as Partial<Snapshot> | undefined
    // A first load with nothing saved keeps what is here (an install or upgrade mid-session).
    if (saved !== undefined || previous !== '') {
      await update($, summary, () => saved?.summary ?? '')
      await update($, title, () => saved?.title ?? '')
      await update($, tasks, () => saved?.tasks ?? [])
      await update($, folded, () => saved?.folded ?? [])
      await update($, ticked, () => saved?.ticked ?? [])
      await update($, spent, () => saved?.spent ?? { calls: 0, input: 0, output: 0 })
      await update($, titleAnchor, () => saved?.titleAnchor ?? '')
      await update($, titleSuggestion, () => saved?.titleSuggestion ?? '')
      await update($, dismissedTitles, () => saved?.dismissedTitles ?? [])
      await update($, moveSuggestion, () => saved?.moveSuggestion ?? '')
      await update($, dismissedMoves, () => saved?.dismissedMoves ?? [])
      await update($, pendingTitle, () => '')
      await update($, lastAnswer, () => '')
    }
    await update($, restoredFor, () => id)
  } catch {
    // Nothing saved could be read: the pane starts from what it holds.
  }
}

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

/** An archive box in the sidebar's grey, beside the bin in Edit mode. */
const ARCHIVE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#8a8a8a" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="3" rx="0.8"/><path d="M3.2 6v6.5h9.6V6M6.5 8.8h3"/></svg>'

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
  { id: 'demo-8', subject: 'Write the README', status: 'pending', owner: 'user' },
  { id: 'demo-8a', subject: 'Explain the /glance command', status: 'pending', parentId: 'demo-8', owner: 'user' },
  { id: 'demo-8b', subject: 'Add screenshots', status: 'pending', parentId: 'demo-8', owner: 'user' },
]

/**
 * The demo's status card and title, in the shape Haiku writes them. With DEMO_TASKS it shows every
 * state the pane draws: pending, in progress, done, a partly done main task, a main task done by its
 * subtasks, and a folded one (DEMO_FOLDED).
 */
const DEMO_TITLE = 'Session glance demo'
const DEMO_SUMMARY = [
  'GOAL: Glanceable status and checklist beside the session',
  'DONE_WHEN: [x] Every task state shows; [ ] Subtasks fold and unfold; [ ] Dragging reorders the list',
  'DONE: Seeded a demo of everything the pane can show',
  'NEXT: Click a task, then try Edit mode and drag one',
].join('\n')
const DEMO_FOLDED = ['demo-8']

/** Splits the model's reply into the session title and the summary lines below it. */
export function splitReply(reply: string): { title: string; summary: string } {
  const match = reply.trim().match(/^TITLE:\s*(.+)\n?([\s\S]*)$/)

  return match ? { title: (match[1] ?? '').trim().slice(0, 80), summary: (match[2] ?? '').trim() } : { title: '', summary: reply.trim() }
}

/** Reads `Label: value` lines (any case) into goal / done_when / done / next / drift; prose without labels comes back whole as `goal`. */
export function parseSummary(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*[-*]?\s*(goal|done[\s_-]*when|done|next|drift|retitle|your[\s_-]*move)\s*:\s*(.+)$/i)
    if (match?.[1] && match[2]) {
      fields[match[1].toLowerCase().replace(/[\s-]+/g, '_')] = match[2].trim()
    }
  }

  return Object.keys(fields).length === 0 && text.trim() !== '' ? { goal: text.trim() } : fields
}

export type Criterion = { text: string; isMet: boolean; isTicked: boolean }

/**
 * Splits DONE_WHEN into criteria: `[x] met; [ ] open`. A criterion the person ticked stays met
 * whatever the model says. A line without markers is one open criterion, as older summaries wrote it.
 */
export function parseCriteria(doneWhen: string | undefined, tickedKeys: readonly string[]): Criterion[] {
  if (doneWhen === undefined || doneWhen.trim() === '') {
    return []
  }

  return doneWhen
    .split(';')
    .map(part => part.trim().match(/^(?:\[([ xX])\]\s*)?(.+)$/))
    .flatMap(match => {
      const text = match?.[2]?.trim() ?? ''
      const isTicked = tickedKeys.includes(text.toLowerCase())

      return text === '' ? [] : [{ text, isMet: isTicked || match?.[1]?.toLowerCase() === 'x', isTicked }]
    })
}

/** DONE_WHEN written back from criteria, for the next summary prompt. */
export function formatCriteria(criteria: readonly Criterion[]): string {
  return criteria.map(criterion => `[${criterion.isMet ? 'x' : ' '}] ${criterion.text}`).join('; ')
}

/** A RETITLE line worth offering: not "none", not the title the session already has, not one the person dismissed. */
export function suggestionFrom(retitle: string | undefined, anchor: string, dismissed: readonly string[]): string {
  const suggestion = driftNote(retitle).replace(/^["']|["']$/g, '').slice(0, 80)

  return suggestion === '' || suggestion.toLowerCase() === anchor.toLowerCase() || dismissed.includes(suggestion.toLowerCase()) ? '' : suggestion
}

/** The drift line to show, or empty when the turn served the goal. */
export function driftNote(drift: string | undefined): string {
  return drift === undefined || /^(none|no|n\/a|-)?\.?$/i.test(drift.trim()) ? '' : drift.trim()
}

/**
 * The session as markdown to paste into a PR, a standup or the next session: title, status,
 * done-when as checkboxes and the whole checklist (folded subtasks too) in the pane's order.
 */
export function handoffMarkdown(sessionTitle: string, text: string, all: readonly Task[], tickedKeys: readonly string[]): string {
  const fields = parseSummary(text)
  const criteria = parseCriteria(fields.done_when, tickedKeys)
  const status = [
    fields.goal ? `**Goal:** ${fields.goal}` : '',
    criteria.length > 0 ? ['**Done when:**', ...criteria.map(criterion => `- [${criterion.isMet ? 'x' : ' '}] ${criterion.text}`)].join('\n') : '',
    fields.done ? `**Done:** ${fields.done}` : '',
    fields.next ? `**Next:** ${fields.next}` : '',
  ].filter(part => part !== '')
  const section = (heading: string, owner: Owner): string[] => {
    const lines = displayRows(activeOf(ownedBy(all, owner))).map(row => `${row.depth === 1 ? '  ' : ''}- [${row.shown === 'completed' ? 'x' : ' '}] ${row.task.subject}`)

    return lines.length > 0 ? [heading, lines.join('\n')] : []
  }

  return [`# ${sessionTitle || 'Session'}`, ...status, ...section('## Agent tasks', 'agent'), ...section('## Your to-dos', 'user')].join('\n\n')
}

/** What a compaction is told to keep: the goal and its done-when, word for word; empty with neither. */
export function compactNote(text: string): string {
  const fields = parseSummary(text)
  const lines = [fields.goal ? `Goal: ${fields.goal}` : '', fields.done_when ? `Done when: ${fields.done_when}` : ''].filter(line => line !== '')

  return lines.length === 0 ? '' : `Keep the session's goal in the summary, word for word. ${lines.join('. ')}.`
}

/** Builds the rolling-summary prompt: the previous status is folded together with the latest exchange. */
export function summaryPrompt(previous: string, prompt: string, answer: string, tickedKeys: readonly string[] = [], titleToCheck = ''): string {
  const fields = parseSummary(previous)
  const doneWhen = formatCriteria(parseCriteria(fields.done_when, tickedKeys))

  return [
    `You keep a glanceable status of a coding session. Reply with exactly these ${titleToCheck === '' ? 'seven' : 'eight'} lines and nothing else:`,
    'TITLE: <session title, max 6 words>',
    'GOAL: <what the user is after, max 12 words>',
    'DONE_WHEN: <1-4 checkable criteria that mean the goal is reached, max 8 words each, separated by "; ", each starting [x] when met, else [ ]>',
    'DONE: <what was just finished, max 12 words>',
    'NEXT: <the next step or open question, max 12 words>',
    'DRIFT: <when the latest exchange did not serve GOAL, what happened instead, max 10 words; else none>',
    "YOUR_MOVE: <when the next step is the user's own (push, review, answer a question, decide, test by hand), that step as a short imperative, max 8 words; else none>",
    ...(titleToCheck === ''
      ? []
      : [
          `RETITLE: <only when the session's work as a whole has moved away from what the title "${titleToCheck}" describes (a detour of one exchange is not enough): a title that fits it now, max 6 words; else none>`,
        ]),
    'Keep criteria that still apply word for word; a criterion marked [x] in the previous status stays [x]. A new goal gets new criteria.',
    'Terse fragments, no full sentences, no markdown, no repetition between lines.',
    `<previous_status>${previous ? FIELDS.map(field => `${field.key.toUpperCase()}: ${(field.key === 'done_when' ? doneWhen : fields[field.key]) ?? ''}`).join('\n') : '(none yet)'}</previous_status>`,
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
  const moved = after.flatMap(task => {
    const old = before.find(one => one.id === task.id)

    return old && ownerOf(old) !== ownerOf(task) && task.parentId === undefined
      ? [ownerOf(task) === 'user' ? `moved "${task.subject}" to their own to-dos (theirs to do now, not yours)` : `handed "${task.subject}" to you`]
      : []
  })
  const archived = after
    .filter(task => task.archived === true && before.some(one => one.id === task.id && one.archived !== true))
    .filter(task => !after.some(one => one.id === task.parentId && one.archived === true))
    .map(task => `"${task.subject}"`)
  const kept = before.filter(task => after.some(one => one.id === task.id)).map(task => task.id)
  const isReordered = kept.join() !== after.filter(task => kept.includes(task.id)).map(task => task.id).join()
  const parts = [
    added.length > 0 ? `added ${added.join(', ')}` : '',
    removed.length > 0 ? `removed ${removed.join(', ')} (do not work on them unless asked)` : '',
    renamed.length > 0 ? `renamed ${renamed.join(', ')}` : '',
    ...moved,
    archived.length > 0 ? `archived ${archived.join(', ')} (put away in the pane, not deleted)` : '',
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
  if (!settings.isTaskCheck) {
    return typed
  }
  await update($, isValidating, () => true)
  try {
    const reply = await complete($, {
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

async function addTask($: EngineInterface, typed: string, owner: Owner = 'agent'): Promise<void> {
  if (typed.trim() === '') {
    return
  }
  // One update per atom: the engine lists what a module writes from the atom named at each call.
  if (owner === 'user') {
    await update($, mineAddCount, n => n + 1)
  } else {
    await update($, addCount, n => n + 1)
  }
  const subject = await validateTask($, typed.trim(), ownedBy(await read($, tasks), owner))
  if (subject === undefined) {
    return
  }
  await addOwnTask($, subject, owner)
}

/** Adds a checked task to a card; the agent hears of a to-do of the person's own as a note, not as work. */
async function addOwnTask($: EngineInterface, subject: string, owner: Owner): Promise<void> {
  const task: Task = { id: `user-${crypto.randomUUID().slice(0, 8)}`, subject, status: 'pending', ...(owner === 'user' ? { owner } : {}) }
  await update($, tasks, list => [...list, task])
  await tellModel(
    $,
    owner === 'user'
      ? `The user noted a to-do of their own: "${subject}". It is theirs to do, not yours; bring it up when it becomes relevant.`
      : `The user added the task "${subject}" to the session checklist.`,
  )
  await save($)
}

/** The selection as a task text: whitespace folded, cut to what the task check reads. */
export function selectionTask(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
}

/** Redraws the band only when text gets selected or the selection goes away. */
async function checkSelection($: EngineInterface): Promise<void> {
  try {
    const isSelected = selectionTask((await $.ui.selection())?.text) !== ''
    if (isSelected !== (await read($, hasSelection))) {
      await update($, hasSelection, () => isSelected)
    }
  } catch {
    // A surface that cannot say: the buttons stay hidden.
  }
}

/** Adds the current selection as a task for the agent or a to-do of the person's own; false with nothing selected. */
async function addFromSelection($: EngineInterface, owner: Owner): Promise<boolean> {
  const text = selectionTask((await $.ui.selection())?.text)
  if (text === '') {
    return false
  }
  await addTask($, text, owner)

  return true
}

/** Takes the suggested next step into the You card. */
async function acceptMove($: EngineInterface): Promise<void> {
  const subject = await read($, moveSuggestion)
  if (subject === '') {
    return
  }
  await update($, moveSuggestion, () => '')
  await addOwnTask($, subject, 'user')
}

async function dismissMove($: EngineInterface): Promise<void> {
  const subject = await read($, moveSuggestion)
  await update($, dismissedMoves, list => [...list, subject.toLowerCase()].slice(-20))
  await update($, moveSuggestion, () => '')
  await save($)
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

/** Puts a task (and its subtasks) away in the edit draft; saved or dropped with the draft. */
async function archiveInDraft($: EngineInterface, task: Task): Promise<void> {
  await update($, draft, list => setArchived(list, task.id, true))
  await update($, selectedId, current => (current === task.id ? '' : current))
}

/** Brings an archived task (and its subtasks) back into its card. */
async function restoreTask($: EngineInterface, task: Task): Promise<void> {
  await update($, tasks, list => setArchived(list, task.id, false))
  await tellModel($, `The user restored the archived task "${task.subject}" to the session pane.`)
  await save($)
}

/** Hands a task (and its subtasks) to the other card in the edit draft. */
async function moveInDraft($: EngineInterface, task: Task): Promise<void> {
  await update($, draft, list => moveTask(list, task.id))
  await update($, selectedId, () => '')
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
    await save($)
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
  const sync =
    task.id.startsWith('demo-') || task.id.startsWith('user-') || ownerOf(task) === 'user' ? '' : ` If it is in your task list (id ${task.id}), update it to match.`
  const carried = isCarried ? `, and with it its ${children.length} subtasks` : ''
  const which = ownerOf(task) === 'user' ? 'their own to-do' : 'the task'
  await tellModel($, `The user marked ${which} "${task.subject}" as ${STATUS_WORDS[choice.status]}${carried} in the session pane.${sync}`)
  await save($)
}

/** Type and spacing: two steps up the API's five sizes (caption, footnote, body, heading, title), for reading at a glance. */
const TYPE = { text: 'heading', label: 'body', head: 'title', icon: 24, padX: 'xl', padY: 'lg' } as const

/** Folds the latest exchange into the status; false when there was nothing to fold or the model gave no reply. */
async function summarize($: EngineInterface): Promise<boolean> {
  const answer = await read($, lastAnswer)
  if (answer === '') {
    return false
  }
  await update($, isSummarizing, () => true)
  const anchor = await read($, titleAnchor)
  const dismissedTodo = await read($, dismissedMoves)
  try {
    const reply = await complete($, {
      system: 'Answer only with the labelled lines asked for (TITLE, GOAL, DONE_WHEN, DONE, NEXT, DRIFT, YOUR_MOVE, and RETITLE when asked). No other labels, no extra lines.',
      prompt: summaryPrompt(await read($, summary), await read($, lastPrompt), answer, await read($, ticked), settings.isTitleSuggest ? anchor : ''),
      maxTokens: 300,
    })
    if (!reply.isAnswered) {
      return false
    }
    const parts = splitReply(reply.text)
    await update($, summary, () => parts.summary)
    if (parts.title !== '') {
      await update($, title, () => parts.title)
    }
    if (anchor === '' && parts.title !== '') {
      await update($, titleAnchor, () => parts.title)
    }
    const suggestion = settings.isTitleSuggest ? suggestionFrom(parseSummary(parts.summary).retitle, anchor, await read($, dismissedTitles)) : ''
    if (suggestion !== '' && suggestion !== (await read($, titleSuggestion))) {
      await update($, titleSuggestion, () => suggestion)
      $.ui.toast(`Title suggestion: ${suggestion}`)
    }
    const mine = ownedBy(await read($, tasks), 'user').filter(task => task.status !== 'completed').map(task => task.subject.toLowerCase())
    await update($, moveSuggestion, () => suggestionFrom(parseSummary(parts.summary).your_move, '', [...(dismissedTodo ?? []), ...mine]))

    return true
  } finally {
    await update($, isSummarizing, () => false)
    await save($)
  }
}

/** Takes the suggested title: it becomes the session title at the next prompt and the title later suggestions are measured against. */
async function useSuggestion($: EngineInterface): Promise<void> {
  const suggestion = await read($, titleSuggestion)
  if (suggestion === '') {
    return
  }
  await update($, pendingTitle, () => suggestion)
  await update($, titleAnchor, () => suggestion)
  await update($, titleSuggestion, () => '')
  await save($)
}

async function dismissSuggestion($: EngineInterface): Promise<void> {
  const suggestion = await read($, titleSuggestion)
  await update($, dismissedTitles, list => [...list, suggestion.toLowerCase()].slice(-20))
  await update($, titleSuggestion, () => '')
  await save($)
}

/** Puts the handoff on a surface's clipboard; the result says whether it took, with the markdown either way. */
async function copyHandoff($: EngineInterface, surface?: RenderSurface): Promise<{ isCopied: boolean; markdown: string; hasStatus: boolean }> {
  const text = await read($, summary)
  const markdown = handoffMarkdown(await read($, title), text, await read($, tasks), await read($, ticked))
  const copied = await $.ui.copy(surface === undefined ? { text: markdown } : { text: markdown, surface })

  return { isCopied: copied.isCopied, markdown, hasStatus: text.trim() !== '' }
}

/** Ticks or unticks a done-when criterion by hand and tells the model; a hand tick outlasts the model's own view. */
async function toggleCriterion($: EngineInterface, criterion: Criterion): Promise<void> {
  const key = criterion.text.toLowerCase()
  await update($, ticked, keys => (criterion.isTicked ? keys.filter(one => one !== key) : [...keys, key]))
  await tellModel(
    $,
    criterion.isTicked
      ? `The user unticked the done-when criterion "${criterion.text}"; judge it again from the work.`
      : `The user ticked the done-when criterion "${criterion.text}" as met.`,
  )
  await save($)
}

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
  await update($, ticked, () => [])
  await update($, titleAnchor, () => '')
  await update($, titleSuggestion, () => '')
  await update($, dismissedTitles, () => [])
  await update($, moveSuggestion, () => '')
  await update($, dismissedMoves, () => [])
  await update($, draft, () => [])
  await update($, selectedId, () => '')
  await update($, isManaging, () => false)
  if (hadTasks) {
    await tellModel($, 'The user cleared the session checklist; its tasks no longer apply unless they bring them up again.')
  }
  await save($)

  return true
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Session' })
  await update($, isPaneOpen, () => true)
}

/** `/glance <word> on|off` and the userConfig field each one sets. */
const SWITCHES = {
  rename: { key: 'renameSession', on: 'The status title will now rename this session at your next prompt.', off: 'Sessions keep their own title now.' },
  auto: { key: 'autoSummary', on: 'The status updates after every answer again.', off: 'The status only changes on /glance refresh now.' },
  check: { key: 'checkTasks', on: 'Typed tasks are checked again.', off: 'Typed tasks are added as typed now.' },
  suggest: {
    key: 'suggestTitle',
    on: 'A new title is suggested when the work moves away from the session title (while renaming is off).',
    off: 'No more title suggestions.',
  },
} as const
const MODELS = ['haiku', 'sonnet'] as const

/** Writes one of the mod's settings; the engine then reloads the module with the new options. */
async function setOption($: EngineInterface, key: string, value: boolean | string): Promise<void> {
  const { deny } = await $.config.set({ key: `session-glance.${key}`, value })
  if (deny !== undefined) {
    $.ui.toast(`Could not change the setting: ${deny}`)
  }
}

export const register: Register = (on, options) => {
  settings.model = MODELS.find(one => one === options.summaryModel) ?? 'haiku'
  settings.isAutoSummary = options.autoSummary !== false
  settings.isTaskCheck = options.checkTasks !== false
  // With renaming on the title already follows the work, so there is nothing to suggest.
  settings.isTitleSuggest = options.suggestTitle !== false && options.renameSession !== true

  on('session.start', async ($, e, next) => {
    await restore($)
    // A reload runs session.start again and cancels the old timer with the old module.
    $.clock.every(SELECTION_POLL_MS, () => void checkSelection($))
    await $.command.register({ name: 'glance', description: 'Toggle the session pane (`/glance copy` copies it as markdown, `/glance refresh` updates the status, `/glance task|todo` adds the selected text, `/glance purge` clears it, `/glance demo` fills in a demo; settings: `/glance rename|suggest|auto|check on|off`, `/glance model haiku|sonnet`)' })
    void openPane($)

    return next(e)
  })

  on('command.run', { command: 'glance' }, async ($, e) => {
    const [word, value] = e.args.trim().split(/\s+/)
    if (word !== undefined && word in SWITCHES) {
      // The plugin's own way to its settings: `/config` has two entries in the desktop app, and a recalled line picks the wrong one.
      const setting = SWITCHES[word as keyof typeof SWITCHES]
      if (value !== undefined && value !== 'on' && value !== 'off') {
        return { text: `Use \`/glance ${word} on\`, \`/glance ${word} off\`, or \`/glance ${word}\` to switch it.` }
      }
      const isOn = value === undefined ? !(word === 'rename' ? options.renameSession === true : options[setting.key] !== false) : value === 'on'
      const { deny } = await $.config.set({ key: `session-glance.${setting.key}`, value: isOn })
      if (deny !== undefined) {
        return { text: `Could not change the setting: ${deny}` }
      }

      return { text: isOn ? setting.on : setting.off }
    }
    if (word === 'model') {
      const model = MODELS.find(one => one === value)
      if (model === undefined) {
        return { text: `The status uses ${settings.model}. Use \`/glance model haiku\` or \`/glance model sonnet\` to change it.` }
      }
      const { deny } = await $.config.set({ key: 'session-glance.summaryModel', value: model })
      if (deny !== undefined) {
        return { text: `Could not change the setting: ${deny}` }
      }

      return { text: `The status and task checks use ${model} from now on.` }
    }
    if (word === 'task' || word === 'todo') {
      const owner: Owner = word === 'todo' ? 'user' : 'agent'
      const isAdded = await addFromSelection($, owner)

      return {
        text: isAdded
          ? `Added the selection ${owner === 'user' ? 'to your to-dos' : 'as a task for the agent'}, unless you cancelled the check.`
          : 'Select some text first, then run it again (the selection is read from the screen).',
      }
    }
    if (e.args.trim() === 'refresh') {
      return { text: (await summarize($)) ? 'Updated the status from the last answer.' : 'Nothing to update: no answer yet, or the model gave no reply.' }
    }
    if (e.args.trim() === 'copy') {
      if ((await read($, summary)).trim() === '' && (await read($, tasks)).length === 0) {
        return { text: 'Nothing to copy yet: no status and no tasks.' }
      }
      const { isCopied, markdown, hasStatus } = await copyHandoff($)
      if (!isCopied) {
        return { text: `No clipboard to reach here; copy it from below.\n\n${markdown}` }
      }

      return { text: hasStatus ? 'Copied the session status and checklist as markdown.' : 'Copied the checklist as markdown; there is no status yet.' }
    }
    if (e.args.trim() === 'purge') {
      return { text: (await purge($)) ? 'Cleared the status, title and every task.' : 'Nothing was cleared.' }
    }
    if (e.args.trim() === 'demo') {
      await update($, tasks, () => DEMO_TASKS)
      await update($, summary, () => DEMO_SUMMARY)
      await update($, title, () => DEMO_TITLE)
      await update($, folded, () => DEMO_FOLDED)
      await update($, ticked, () => [])
      await update($, titleAnchor, () => DEMO_TITLE)
      await update($, moveSuggestion, () => 'Push the branch')
      await save($)
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
    // An in-process /resume or /clear starts no session.start, so the id is checked here too.
    await restore($)
    await update($, lastPrompt, () => e.text)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Off by default: a session list full of titles you did not write is hard to find your way in.
  // The host only takes a new session title at a prompt, so it trails the summary by one turn.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const chosen = await read($, pendingTitle)
    if (chosen !== '') {
      await update($, pendingTitle, () => '')

      return { ...result, sessionTitle: chosen }
    }
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
        // Ids follow the list's order, so an archived one is recognised by its subject.
        await update($, tasks, list => {
          const archivedSubjects = list.filter(task => task.id.startsWith('todo-') && task.archived === true).map(task => task.subject)

          return [
            ...list.filter(task => !task.id.startsWith('todo-')),
            ...e.todos.map((todo, i) => ({
              id: `todo-${i}`,
              subject: todo.content,
              status: todo.status,
              ...(archivedSubjects.includes(todo.content) ? { archived: true } : {}),
            })),
          ]
        })
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
    // Kept for /glance refresh; the prompt only reads the first 8000 characters.
    await update($, lastAnswer, () => e.answer.slice(0, 8000))
    if (settings.isAutoSummary) {
      await summarize($)
    } else {
      await save($)
    }

    return done
  })

  on('session.end', async ($, e, next) => {
    await save($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // The pane keeps its own state through a compaction; this keeps the goal in the agent's summary too.
  on('session.compact', async ($, e, next) => {
    const keep = compactNote(await read($, summary))
    if (e.agentId !== undefined || keep === '') {
      return next(e)
    }

    return next({ ...e, instructions: e.instructions ? `${e.instructions}\n\n${keep}` : keep })
  }).catch(($, e, next) => next(e))

  on('ui.message', async ($, e, next) => {
    if (e.element !== 'edit-overlay' && e.element !== 'edit-overlay-mine') {
      return next(e)
    }
    const owner: Owner = e.element === 'edit-overlay-mine' ? 'user' : 'agent'
    const data = e.data as { type: 'drop' | 'select' | 'remove' | 'archive' | 'fold'; id: string; slot?: number; dx?: number }
    const task = (await read($, draft)).find(one => one.id === data.id)
    if (task === undefined) {
      return {}
    }
    if (data.type === 'drop') {
      const foldedIds = await read($, folded)
      // Each card has its own layer and rows, so the drop is planned within that card's tasks.
      // The layer only knows the card's visible rows; its archived tasks are kept after them.
      await update($, draft, list => [
        ...planDrop(activeOf(ownedBy(list, owner)), data.id, data.slot ?? 0, data.dx ?? 0, foldedIds).list,
        ...ownedBy(list, owner).filter(one => one.archived === true),
        ...list.filter(one => ownerOf(one) !== owner),
      ])
    } else if (data.type === 'select') {
      await update($, selectedId, current => (current === data.id ? '' : data.id))
    } else if (data.type === 'remove') {
      await removeFromDraft($, task)
    } else if (data.type === 'archive') {
      await archiveInDraft($, task)
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
    const { done, total } = progress(activeOf(ownedBy(list, 'agent')))
    const mineOpen = progress(activeOf(ownedBy(list, 'user')))
    const openForYou = mineOpen.total - mineOpen.done
    const current = await read($, title)
    const isSelected = await read($, hasSelection)
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
        {isSelected && (
          <Button key="task-from-selection" plain onPress={() => addFromSelection($, 'agent')}>
            <Text size="footnote" color="claude">
              + Task
            </Text>
          </Button>
        )}
        {isSelected && (
          <Button key="todo-from-selection" plain onPress={() => addFromSelection($, 'user')}>
            <Text size="footnote" color="claude">
              + To-do
            </Text>
          </Button>
        )}
        <Text size="footnote" color="inactive" wrap="truncate-end">
          {current || 'No status yet'}
          {total > 0 ? `  ·  ${done}/${total} tasks` : ''}
          {openForYou > 0 ? `  ·  ${openForYou} for you` : ''}
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
    const criteria = parseCriteria(fields.done_when, await read($, ticked))
    const isReached = criteria.length > 0 && criteria.every(criterion => criterion.isMet)
    const drift = driftNote(fields.drift)
    const cost = await read($, spent)
    const suggestion = await read($, titleSuggestion)
    const chosenTitle = await read($, pendingTitle)
    const busy = await read($, isSummarizing)
    const stored = managing ? await read($, draft) : await read($, tasks)
    const showSummary = await read($, isSummaryOpen)
    const showTasks = await read($, isTasksOpen)
    const showMine = await read($, isMineOpen)
    const mineAdds = await read($, mineAddCount)
    const nextMove = await read($, moveSuggestion)
    const archiveOwners = await read($, openArchives)
    const showSettings = await read($, isSettingsOpen)
    const settingRows = [
      { key: 'renameSession', label: 'Rename the session', hint: 'The status title becomes the session title', isOn: options.renameSession === true },
      { key: 'suggestTitle', label: 'Suggest a new title', hint: 'When the work moves on; only while renaming is off', isOn: options.suggestTitle !== false },
      { key: 'autoSummary', label: 'Update after every answer', hint: 'Off: only on /glance refresh', isOn: settings.isAutoSummary },
      { key: 'checkTasks', label: 'Check tasks you type', hint: 'Tidy the wording, ask when unclear', isOn: settings.isTaskCheck },
    ]
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
    const taskRow = (row: Row, isEditing: boolean, isFirst: boolean) => {
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
          marginTop={!isEditing && row.depth === 0 && !isFirst ? airy : 0}
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
          {isEditing && iconButton(`archive-${row.task.id}`, ARCHIVE, 'Archive', '▤', () => archiveInDraft($, row.task))}
          {isEditing && iconButton(`remove-${row.task.id}`, TRASH, 'Remove', '✕', () => removeFromDraft($, row.task))}
        </Box>
      )
    }

    /** One task card: the agent's tasks, or the person's own to-dos. Edit mode covers both cards at once. */
    const taskCard = (owner: Owner) => {
      const isMine = owner === 'user'
      // The agent's card keeps the keys it had before the split.
      const suffix = isMine ? '-mine' : ''
      const list = activeOf(ownedBy(stored, owner))
      // Shown once in the fold: a subtask archived with its main task goes with it.
      const archivedTasks = ownedBy(stored, owner).filter(
        task => task.archived === true && !stored.some(one => one.id === task.parentId && one.archived === true),
      )
      const isArchiveOpen = archiveOwners.includes(owner)
      const rows = displayRows(list, foldedIds)
      const { done, total } = progress(list)
      const isOpen = isMine ? showMine : showTasks
      // The Edit-mode hint is said once: in the agent's card, or in yours when the agent has none.
      const hasHint = !isMine || activeOf(ownedBy(stored, 'agent')).length === 0

      return (
        <Box flexDirection="column" gap="sm" borderStyle="round" borderColor="subtle" paddingX={type.padX} paddingY={type.padY}>
          {header(
            `toggle-tasks${suffix}`,
            isMine ? 'Your to-dos' : 'Agent tasks',
            isOpen,
            <Box gap="sm" alignItems="center">
              {checking || total === 0 || done < total ? (
                note(checking ? 'checking…' : total > 0 ? `${done}/${total}` : '')
              ) : (
                <Text size={type.text} color="success">
                  {`${done}/${total}`}
                </Text>
              )}
              {isOpen && !managing && (
                <Button key={`toggle-manage${suffix}`} plain onPress={() => startEditing($)}>
                  <Text size={type.text} color="subtle">
                    Edit
                  </Text>
                </Button>
              )}
              {isOpen && managing && (
                <Button key={`cancel-edit${suffix}`} plain onPress={() => stopEditing($, false)}>
                  <Text size={type.text} color="subtle">
                    Cancel
                  </Text>
                </Button>
              )}
              {isOpen && managing && (
                <Button key={`save-edit${suffix}`} plain onPress={() => stopEditing($, true)}>
                  <Text size={type.text} color="claude" weight="medium">
                    Save
                  </Text>
                </Button>
              )}
            </Box>,
            () => (isMine ? update($, isMineOpen, open => !open) : update($, isTasksOpen, open => !open)),
          )}
          {isOpen && isMine && nextMove !== '' && !managing && (
            <Box flexDirection="column" gap="xs" marginBottom={airy}>
              <Text size={type.label} color="suggestion">
                Your next step?
              </Text>
              <Text size={type.text}>{nextMove}</Text>
              <Box gap="md" alignItems="center">
                <Button key="add-move" plain onPress={() => acceptMove($)}>
                  <Text size={type.text} color="claude" weight="medium">
                    Add
                  </Text>
                </Button>
                <Button key="dismiss-move" plain onPress={() => dismissMove($)}>
                  <Text size={type.text} color="subtle">
                    Dismiss
                  </Text>
                </Button>
              </Box>
            </Box>
          )}
          {isOpen && rows.length === 0 && note(isMine ? 'Nothing for you yet.' : 'No tasks yet.')}
          {isOpen && managing && Client && rows.length > 0 && (
            // The rows below hold the icons; the layer on top draws handles and the drop line and takes the clicks.
            <Box flexDirection="column" position="relative" minWidth={0}>
              {rows.map((row, i) => taskRow(row, true, i === 0))}
              {isTerminal && <Box height={1} />}
              <Box position="absolute" top={0} left={0} right={0} bottom={0}>
                <Client
                  key={`edit-overlay${suffix}`}
                  module="./task-list.tsx"
                  props={{ tasks: list, folded: foldedIds, rowHeight, hasGapRows: isTerminal }}
                  width="100%"
                  height={Math.ceil(rows.length * rowHeight) + (isTerminal ? 1 : 0)}
                />
              </Box>
            </Box>
          )}
          {isOpen &&
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
                  <Box marginTop="xs">
                    <Button key={`move-${row.task.id}`} plain onPress={() => moveInDraft($, row.task)}>
                      <Text size={type.text} color="subtle">
                        {isMine ? 'Hand to the agent' : 'Move to your to-dos'}
                      </Text>
                    </Button>
                  </Box>
                </Box>
              ))}
          {isOpen && managing && hasHint && !selected && rows.length > 0 && (
            <Box marginTop={airy}>
              {note('Drag ⠿ to reorder, sideways to nest or un-nest · click a task to rename, add subtasks or move it to the other card · archive or remove at the right · nothing changes until Save')}
            </Box>
          )}
          {isOpen && (!managing || !Client) && rows.map((row, i) => taskRow(row, false, i === 0))}
          {isOpen && !managing && archivedTasks.length > 0 && (
            <Box flexDirection="column" gap="xs" marginTop={airy}>
              <Button
                key={`toggle-archived${suffix}`}
                plain
                onPress={() => update($, openArchives, owners => (owners.includes(owner) ? owners.filter(one => one !== owner) : [...owners, owner]))}
              >
                <Text size={type.text} color="inactive">
                  {`Archived (${archivedTasks.length}) ${isArchiveOpen ? '▾' : '▸'}`}
                </Text>
              </Button>
              {isArchiveOpen &&
                archivedTasks.map(task => (
                  <Box key={`archived-${task.id}`} alignItems="center" gap="sm" minWidth={0}>
                    <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                      <Text size={type.text} color="inactive" wrap="truncate-end">
                        {task.subject}
                      </Text>
                    </Box>
                    <Button key={`restore-${task.id}`} plain onPress={() => restoreTask($, task)}>
                      <Text size={type.text} color="subtle">
                        Restore
                      </Text>
                    </Button>
                  </Box>
                ))}
            </Box>
          )}
          {isOpen && Input && (
            <Box marginTop={isTerminal ? 1 : 'sm'}>
              <Input
                key={`add-task${suffix}-${isMine ? mineAdds : adds}`}
                placeholder={isMine ? 'Add a to-do for yourself…' : 'Add a task for the agent…'}
                submitLabel="Add"
                onSubmit={value => addTask($, value, owner)}
              />
            </Box>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap="lg" padding={isTerminal ? 0 : 'md'}>
        <Box flexDirection="column" gap="sm" borderStyle="round" borderColor="subtle" paddingX={type.padX} paddingY={type.padY}>
          {header(
            'toggle-summary',
            'Status',
            showSummary,
            <Box gap="sm" alignItems="center">
              {note(busy ? 'updating…' : '')}
              {(hasSummary || stored.length > 0) && !managing && (
                <Button
                  key="copy-handoff"
                  plain
                  onPress={async () => {
                    const { isCopied } = await copyHandoff($, e.surface)
                    $.ui.toast(isCopied ? 'Copied the session as markdown' : 'No clipboard here: /glance copy prints it')
                  }}
                >
                  <Text size={type.text} color="subtle">
                    Copy
                  </Text>
                </Button>
              )}
            </Box>,
            () => update($, isSummaryOpen, open => !open),
          )}
          {suggestion !== '' && (
            <Box flexDirection="column" gap="xs" marginBottom={airy}>
              <Text size={type.label} color="suggestion">
                Title suggestion
              </Text>
              <Text size={type.text}>{suggestion}</Text>
              <Box gap="md" alignItems="center">
                <Button key="use-title" plain onPress={() => useSuggestion($)}>
                  <Text size={type.text} color="claude" weight="medium">
                    Use
                  </Text>
                </Button>
                <Button key="dismiss-title" plain onPress={() => dismissSuggestion($)}>
                  <Text size={type.text} color="subtle">
                    Dismiss
                  </Text>
                </Button>
              </Box>
            </Box>
          )}
          {chosenTitle !== '' && note(`Renames the session to "${chosenTitle}" at your next prompt.`)}
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
                {field.key === 'done_when' ? (
                  <Box flexDirection="column">
                    {criteria.map(criterion => (
                      <Box key={`criterion-row-${criterion.text}`} alignItems="center" gap="sm" minWidth={0}>
                        {Svg ? (
                          <Svg source={criterion.isMet ? ICON.completed : ICON.pending} alt={criterion.isMet ? 'met' : 'open'} width={type.icon} height={type.icon} />
                        ) : (
                          <Text color="inactive">{criterion.isMet ? GLYPH.completed : GLYPH.pending}</Text>
                        )}
                        <Box flexGrow={1} flexShrink={1} minWidth={0}>
                          <Button key={`criterion-${criterion.text}`} plain onPress={() => toggleCriterion($, criterion)}>
                            <Text size={type.text} color={criterion.isMet ? 'inactive' : undefined}>
                              {criterion.text}
                            </Text>
                          </Button>
                        </Box>
                      </Box>
                    ))}
                    {isReached && (
                      <Text size={type.text} color="success">
                        Goal reached: wrap up, or set a new goal.
                      </Text>
                    )}
                  </Box>
                ) : (
                  <Text size={type.text}>{fields[field.key]}</Text>
                )}
              </Box>
            ))}
          {showSummary && drift !== '' && <Text size={type.text} color="inactive">{`Off goal: ${drift}`}</Text>}
        </Box>

        {taskCard('agent')}
        {taskCard('user')}
        <Box flexDirection="column" gap="sm" borderStyle="round" borderColor="subtle" paddingX={type.padX} paddingY={type.padY}>
          {header('toggle-settings', 'Settings', showSettings, null, () => update($, isSettingsOpen, open => !open))}
          {showSettings &&
            settingRows.map(row => (
              <Box key={`setting-row-${row.key}`} justifyContent="space-between" alignItems="center" gap="md" minWidth={0}>
                <Box flexDirection="column" flexShrink={1} minWidth={0}>
                  <Text size={type.text}>{row.label}</Text>
                  <Text size={type.label} color="inactive">
                    {row.hint}
                  </Text>
                </Box>
                <Button key={`setting-${row.key}`} plain onPress={() => setOption($, row.key, !row.isOn)}>
                  <Text size={type.text} color={row.isOn ? 'claude' : 'subtle'} weight={row.isOn ? 'medium' : undefined}>
                    {row.isOn ? 'On' : 'Off'}
                  </Text>
                </Button>
              </Box>
            ))}
          {showSettings && (
            <Box justifyContent="space-between" alignItems="center" gap="md" minWidth={0}>
              <Box flexDirection="column" flexShrink={1} minWidth={0}>
                <Text size={type.text}>Model</Text>
                <Text size={type.label} color="inactive">
                  For the status and the task check
                </Text>
              </Box>
              <Box gap="md" alignItems="center">
                {MODELS.map(model => (
                  <Button key={`model-${model}`} plain onPress={() => setOption($, 'summaryModel', model)}>
                    <Text size={type.text} color={settings.model === model ? 'claude' : 'subtle'} weight={settings.model === model ? 'medium' : undefined}>
                      {model === 'haiku' ? 'Haiku' : 'Sonnet'}
                    </Text>
                  </Button>
                ))}
              </Box>
            </Box>
          )}
        </Box>
        {cost.calls > 0 && (
          <Text size="footnote" color="inactive">
            {`glance: ${cost.calls} ${cost.calls === 1 ? 'call' : 'calls'} · ${formatTokens(cost.input + cost.output)} tokens (${formatTokens(cost.output)} out) · ${settings.model}`}
          </Text>
        )}
      </Box>
    )
  })
}
