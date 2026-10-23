import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteRequest, ModelCompleteResult, Register, RenderSurface, ToolCallResult } from 'claude-code'

import type { HistoryEntry, Owner, Spent, Task } from '../types'
import { DEMO_FOLDED, DEMO_HISTORY, DEMO_SUGGESTION, DEMO_SUMMARY, DEMO_TASKS, DEMO_TITLE } from './demo'
import { drawBand, drawPane } from './pane'
import type { BandView, PaneView } from './pane'
import { parseVerdict, splitReply, summaryPrompt, validationPrompt } from './prompts'
import { MODELS, SWITCHES, isSwitchOn, modelOf } from './settings'
import type { Criterion } from './status'
import { appendHistory, compactNote, driftNote, handoffMarkdown, parseCriteria, parseSummary, selectionTask, suggestionFrom, yourMoveFrom } from './status'
import { activeOf, applyPlan, describeChanges, mergeDraft, moveTask, newTodos, openTodos, ownedBy, ownerOf, planDrop, progress, replaceList, setArchived, shownStatus } from './tree'
import type { PlanCall } from './tree'

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
/** The card in Edit mode; the other one stays as it is meanwhile. */
const editingOwner = atom({ plugin: 'session-glance', key: 'editingOwner' } as const, 'agent' as Owner)
/** Whether the full Edit-mode help shows below the nesting line; the info mark toggles it. */
const isHelpOpen = atom({ plugin: 'session-glance', key: 'isHelpOpen' } as const, false)
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
/** Open to-dos from the last session in this project, offered once when a new session starts. */
const carryOffer = atom({ plugin: 'session-glance', key: 'carryOffer' } as const, [] as Task[])
/** What the person is waiting to do after the last turn, shown in the band until their next prompt. */
const yourMove = atom({ plugin: 'session-glance', key: 'yourMove' } as const, '')
/** What each earlier turn did, oldest first: the Status card's history. */
const history = atom({ plugin: 'session-glance', key: 'history' } as const, [] as HistoryEntry[])
const isHistoryOpen = atom({ plugin: 'session-glance', key: 'isHistoryOpen' } as const, false)
/** The desktop app's task-list tool: in its sessions the agent plans with it instead of TaskCreate or TodoWrite. */
const PLAN_TOOL = 'mcp__ccd_turn__update_plan'

/** How often the session id and the selection are checked: neither change raises an event. */
const POLL_MS = 400

/** The person's settings (`userConfig`), set by `register` on every load; a change in the config menu reloads it. */
const settings = { model: 'haiku', isAutoSummary: true, isTaskCheck: true, isTitleSuggest: true }

/**
 * Calls the model and adds what the call cost to the session's count, answered or not.
 * Low effort: both calls fill in a short form, and the models think by default, which is billed as output.
 */
async function complete($: EngineInterface, request: Omit<ModelCompleteRequest, 'model'>): Promise<ModelCompleteResult> {
  const reply = await $.model.complete({ ...request, model: settings.model, effort: 'low' })
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

/** One saved pane per session in `$.store`, plus the ids newest last, so the oldest can be dropped. */
const SNAPSHOT_PREFIX = 'session:'
const SNAPSHOT_INDEX = 'sessions'
const KEEP_SESSIONS = 30

export type Snapshot = {
  /** The project the session ran in, so a new session there can offer what was left open. */
  root: string
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
  history: HistoryEntry[]
}

/** A pane with nothing in it: what /clear and /glance purge leave, and the base a saved pane is read over. */
const EMPTY_SNAPSHOT: Snapshot = {
  root: '',
  summary: '',
  title: '',
  tasks: [],
  folded: [],
  ticked: [],
  spent: { calls: 0, input: 0, output: 0 },
  titleAnchor: '',
  titleSuggestion: '',
  dismissedTitles: [],
  moveSuggestion: '',
  dismissedMoves: [],
  history: [],
}

/** The session's project; empty where the host cannot say, which matches no other session. */
async function projectRoot($: EngineInterface): Promise<string> {
  try {
    return await $.session.root()
  } catch {
    return ''
  }
}

async function readSnapshot($: EngineInterface): Promise<Snapshot> {
  return {
    root: await projectRoot($),
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
    history: await read($, history),
  }
}

/** Puts a saved (or empty) pane in place; what the person was in the middle of goes with it. */
async function applySnapshot($: EngineInterface, snapshot: Snapshot): Promise<void> {
  await update($, summary, () => snapshot.summary)
  await update($, title, () => snapshot.title)
  await update($, tasks, () => snapshot.tasks)
  await update($, folded, () => snapshot.folded)
  await update($, ticked, () => snapshot.ticked)
  await update($, spent, () => snapshot.spent)
  await update($, titleAnchor, () => snapshot.titleAnchor)
  await update($, titleSuggestion, () => snapshot.titleSuggestion)
  await update($, dismissedTitles, () => snapshot.dismissedTitles)
  await update($, moveSuggestion, () => snapshot.moveSuggestion)
  await update($, dismissedMoves, () => snapshot.dismissedMoves)
  await update($, history, () => snapshot.history)
  await update($, pendingTitle, () => '')
  await update($, draft, () => [])
  await update($, selectedId, () => '')
  await update($, isManaging, () => false)
}

/** Whether a pane holds nothing a later session would want back. */
function isEmptyPane(snapshot: Snapshot): boolean {
  return snapshot.summary === '' && snapshot.tasks.length === 0 && snapshot.history.length === 0 && snapshot.spent.calls === 0
}

/** Saves what the pane shows under this session's id, so /resume and a restart bring it back. */
async function save($: EngineInterface): Promise<void> {
  try {
    const id = await $.session.id()
    // Only the session whose pane is loaded writes; right after /clear the old one's state is still here.
    if (id !== (await read($, restoredFor))) {
      return
    }
    const snapshot = await readSnapshot($)
    // A resumed session starts under a passing id of its own; an empty pane is not worth a slot under it.
    if (isEmptyPane(snapshot) && (await $.store.get(`${SNAPSHOT_PREFIX}${id}`)) === undefined) {
      return
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

/** The open to-dos of the newest other session saved in this project; none when there is no such session. */
async function lastOpenTodos($: EngineInterface, currentId: string): Promise<Task[]> {
  const root = await projectRoot($)
  const ids = ((await $.store.get(SNAPSHOT_INDEX)) as string[] | undefined) ?? []
  for (const id of [...ids].reverse()) {
    const saved = (await $.store.get(`${SNAPSHOT_PREFIX}${id}`)) as Partial<Snapshot> | undefined
    if (root !== '' && id !== currentId && saved?.root === root) {
      return openTodos(saved.tasks ?? [])
    }
  }

  return []
}

/** Takes the offered to-dos into this session's card and tells the agent; the old session keeps its own copy. */
async function bringTodos($: EngineInterface): Promise<void> {
  const offered = newTodos(await read($, carryOffer), await read($, tasks))
  await update($, carryOffer, () => [])
  if (offered.length === 0) {
    return
  }
  await update($, tasks, list => [...list, ...newTodos(offered, list)])
  const subjects = offered.filter(task => task.parentId === undefined).map(task => `"${task.subject}"`)
  await tellModel($, `The user brought their open to-dos from the last session in this project: ${subjects.join(', ')}. They are theirs to do, not yours.`)
  await save($)
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
      // Read over the empty pane, so a pane saved by an older version gets the fields it lacks.
      await applySnapshot($, { ...EMPTY_SNAPSHOT, ...saved })
      await update($, lastAnswer, () => '')
    }
    // A session with nothing saved is new: offer what the last one in this project left open.
    await update($, carryOffer, () => [])
    if (saved === undefined) {
      const left = await lastOpenTodos($, id)
      await update($, carryOffer, () => left)
    }
    await update($, restoredFor, () => id)
  } catch {
    // Nothing saved could be read: the pane starts from what it holds.
  }
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

async function startEditing($: EngineInterface, owner: Owner = 'agent'): Promise<void> {
  const current = await read($, tasks)
  await update($, draft, () => current)
  await update($, draftBaseIds, () => current.map(task => task.id))
  await update($, selectedId, () => '')
  await update($, editingOwner, () => owner)
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
    const turn = await $.session.turns().catch(() => 0)
    // Where the host cannot count prompts, the entry takes the next number in the history.
    await update($, history, list => appendHistory(list, parseSummary(parts.summary).done, turn > 0 ? turn : list.length + 1))
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
  await applySnapshot($, { ...EMPTY_SNAPSHOT, spent: await read($, spent) })
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


/** A tool call that ran and did not fail: not denied, not an error. */
function hasRun(ran: ToolCallResult): boolean {
  return !('deny' in ran && ran.deny !== undefined) && ran.isError !== true
}

/** Writes one of the mod's settings; the engine then reloads the module with the new options. */
async function setOption($: EngineInterface, key: string, value: boolean | string): Promise<void> {
  const { deny } = await $.config.set({ key: `session-glance.${key}`, value })
  if (deny !== undefined) {
    $.ui.toast(`Could not change the setting: ${deny}`)
  }
}

export const register: Register = (on, options) => {
  settings.model = modelOf(options)
  settings.isAutoSummary = isSwitchOn(options, 'autoSummary')
  settings.isTaskCheck = isSwitchOn(options, 'checkTasks')
  // With renaming on the title already follows the work, so there is nothing to suggest.
  settings.isTitleSuggest = isSwitchOn(options, 'suggestTitle') && !isSwitchOn(options, 'renameSession')

  on('session.start', async ($, e, next) => {
    await restore($)
    // A reload runs session.start again and cancels the old timer with the old module.
    // The id is checked too: a resumed session starts under a passing id and takes its own a moment later.
    $.clock.every(POLL_MS, () => void restore($).then(() => checkSelection($)))
    await $.command.register({ name: 'glance', description: 'Toggle the session pane (`/glance copy` copies it as markdown, `/glance refresh` updates the status, `/glance task|todo` adds the selected text, `/glance purge` clears it, `/glance demo` fills in a demo; settings: `/glance rename|suggest|auto|check on|off`, `/glance model haiku|sonnet`)' })
    void openPane($)

    return next(e)
  })

  on('command.run', { command: 'glance' }, async ($, e) => {
    const [word, value] = e.args.trim().split(/\s+/)
    const setting = SWITCHES.find(one => one.word === word)
    if (setting !== undefined) {
      // The plugin's own way to its settings: `/config` has two entries in the desktop app, and a recalled line picks the wrong one.
      if (value !== undefined && value !== 'on' && value !== 'off') {
        return { text: `Use \`/glance ${setting.word} on\`, \`/glance ${setting.word} off\`, or \`/glance ${setting.word}\` to switch it.` }
      }
      const isOn = value === undefined ? !isSwitchOn(options, setting.key) : value === 'on'
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
      await applySnapshot($, {
        ...(await readSnapshot($)),
        tasks: DEMO_TASKS,
        summary: DEMO_SUMMARY,
        title: DEMO_TITLE,
        folded: DEMO_FOLDED,
        ticked: [],
        titleAnchor: DEMO_TITLE,
        titleSuggestion: DEMO_SUGGESTION,
        moveSuggestion: 'Push the branch',
        history: DEMO_HISTORY,
      })
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
    await update($, yourMove, () => '')

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
    if (!isSwitchOn(options, 'renameSession')) {
      return result
    }
    const current = await read($, title)

    return current === '' ? result : { ...result, sessionTitle: current }
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    // `tool` narrows the input to a call's own fields; a call that did not run changes nothing.
    if (!hasRun(ran) || !('tool' in e)) {
      return ran
    }
    // The desktop app's own task list stands in for the task tools there; its input is read as data.
    if ((e.tool as string) === PLAN_TOOL) {
      await update($, tasks, list => applyPlan(list, e as unknown as PlanCall)).catch(() => undefined)

      return ran
    }
    // Bookkeeping only: a failure here must never fail the tool call it watched.
    try {
      if (e.tool === 'TaskCreate') {
        const created = ran.result as { task: { id: string; subject: string } }
        await update($, tasks, list => [...list, { id: created.task.id, subject: created.task.subject, status: 'pending' as const }])
      } else if (e.tool === 'TaskUpdate') {
        const { taskId, status, subject } = e
        await update($, tasks, list =>
          status === 'deleted'
            ? list.filter(task => task.id !== taskId)
            : list.map(task => (task.id === taskId ? { ...task, status: status ?? task.status, subject: subject ?? task.subject } : task)),
        )
      } else if (e.tool === 'TodoWrite') {
        // TodoWrite sends the whole list; the person's own tasks stay.
        await update($, tasks, list => replaceList(list, 'todo-', e.todos))
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
    // Without a fresh status only the answer itself can say it ends on a question.
    const move = settings.isAutoSummary ? parseSummary(await read($, summary)).your_move : undefined
    await update($, yourMove, () => yourMoveFrom(e.answer, move))

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
    const data = e.data as { type: 'drop' | 'select'; id: string; slot?: number; dx?: number }
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
    } else {
      await update($, selectedId, current => (current === data.id ? '' : data.id))
    }

    return {}
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }
    const isOpen = await read($, isPaneOpen)
    const list = await read($, tasks)
    const { done, total } = progress(activeOf(ownedBy(list, 'agent')))
    const mineOpen = progress(activeOf(ownedBy(list, 'user')))
    const view: BandView = {
      isTerminal: e.surface === 'terminal',
      isOpen,
      title: await read($, title),
      done,
      total,
      openForYou: mineOpen.total - mineOpen.done,
      isSelected: await read($, hasSelection),
      // Shown only between turns: while the agent works, it is not the person's move.
      yourMove: e.props.isWorking ? '' : await read($, yourMove),
    }

    return drawBand($.ui.resolve(e), view, {
      togglePane: async () => {
        if (isOpen) {
          // Our own close is not echoed back as a `ui.close` event, so record it here.
          await $.ui.close({ id: PANE })
          await update($, isPaneOpen, () => false)
        } else {
          await openPane($)
        }
      },
      addSelection: owner => addFromSelection($, owner),
    })
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const managing = await read($, isManaging)
    const fields = parseSummary(await read($, summary))
    const criteria = parseCriteria(fields.done_when, await read($, ticked))
    const view: PaneView = {
      isTerminal: e.surface === 'terminal',
      fields,
      criteria,
      isReached: criteria.length > 0 && criteria.every(criterion => criterion.isMet),
      drift: driftNote(fields.drift),
      cost: await read($, spent),
      model: settings.model,
      suggestion: await read($, titleSuggestion),
      chosenTitle: await read($, pendingTitle),
      busy: await read($, isSummarizing),
      checking: await read($, isValidating),
      stored: managing ? await read($, draft) : await read($, tasks),
      managing,
      editedCard: await read($, editingOwner),
      helpOpen: await read($, isHelpOpen),
      adds: await read($, addCount),
      mineAdds: await read($, mineAddCount),
      selected: await read($, selectedId),
      subtaskAdds: await read($, subtaskCount),
      foldedIds: await read($, folded),
      showSummary: await read($, isSummaryOpen),
      showTasks: await read($, isTasksOpen),
      showMine: await read($, isMineOpen),
      showSettings: await read($, isSettingsOpen),
      nextMove: await read($, moveSuggestion),
      archiveOwners: await read($, openArchives),
      // A to-do the card already holds (the same one, or a demo's) is not offered again.
      carried: newTodos(await read($, carryOffer), await read($, tasks)),
      history: await read($, history),
      showHistory: await read($, isHistoryOpen),
      settingRows: SWITCHES.map(row => ({ key: row.key, label: row.label, hint: row.hint, isOn: isSwitchOn(options, row.key) })),
    }
    const toggle = (id: string) => (ids: string[]) => (ids.includes(id) ? ids.filter(one => one !== id) : [...ids, id])

    return drawPane($.ui.resolve(e), view, {
      toggleSummary: () => update($, isSummaryOpen, open => !open),
      toggleCard: owner => (owner === 'user' ? update($, isMineOpen, open => !open) : update($, isTasksOpen, open => !open)),
      toggleSettings: () => update($, isSettingsOpen, open => !open),
      toggleFold: id => update($, folded, toggle(id)),
      toggleArchive: owner => update($, openArchives, owners => (owners.includes(owner) ? owners.filter(one => one !== owner) : [...owners, owner])),
      toggleHelp: () => update($, isHelpOpen, open => !open),
      toggleHistory: () => update($, isHistoryOpen, open => !open),
      select: id => update($, selectedId, current => (current === id ? '' : id)),
      changeStatus: task => changeStatus($, task),
      startEditing: owner => startEditing($, owner),
      stopEditing: isSaved => stopEditing($, isSaved),
      rename: (task, value) => renameInDraft($, task, value),
      addSubtask: (task, value) => addSubtaskInDraft($, task, value),
      move: task => moveInDraft($, task),
      archive: task => archiveInDraft($, task),
      remove: task => removeFromDraft($, task),
      restore: task => restoreTask($, task),
      add: (value, owner) => addTask($, value, owner),
      acceptMove: () => acceptMove($),
      bringTodos: () => bringTodos($),
      ignoreTodos: () => update($, carryOffer, () => []),
      dismissMove: () => dismissMove($),
      useTitle: () => useSuggestion($),
      dismissTitle: () => dismissSuggestion($),
      toggleCriterion: criterion => toggleCriterion($, criterion),
      copy: async () => {
        const { isCopied } = await copyHandoff($, e.surface)
        $.ui.toast(isCopied ? 'Copied the session as markdown' : 'No clipboard here: /glance copy prints it')
      },
      setOption: (key, value) => setOption($, key, value),
    })
  })
}
