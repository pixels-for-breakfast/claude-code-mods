import type { Owner, Task, TaskStatus } from '../types'

/** What a row shows: a task's own status, or `partial` for a main task whose subtasks are part done. */
export type ShownStatus = TaskStatus | 'partial'
/** One drawn row; a main task carries its subtask count, so a folded one can still say how far along it is. */
export type Row = { task: Task; depth: 0 | 1; shown: ShownStatus; children: number; childrenDone: number }

const ORDER = { in_progress: 0, pending: 1, completed: 2 } as const

/** A main task's state follows its subtasks: all done is done, some done or started is partial. */
export function shownStatus(task: Task, all: readonly Task[]): ShownStatus {
  const children = all.filter(one => one.parentId === task.id)
  if (children.length === 0) {
    return task.status
  }
  if (children.every(child => child.status === 'completed')) {
    return 'completed'
  }

  return children.some(child => child.status !== 'pending') ? 'partial' : task.status
}

/**
 * The rows the pane draws: main tasks by status (open and partial first, done last),
 * each followed by its subtasks by status, keeping the stored order within a status.
 * The subtasks of a main task in `folded` are left out.
 */
export function displayRows(all: readonly Task[], folded: readonly string[] = []): Row[] {
  const rank = (task: Task): number => {
    const shown = shownStatus(task, all)

    return ORDER[shown === 'partial' ? 'in_progress' : shown]
  }
  const byStatus = (list: Task[]): Task[] => list.map((task, i) => ({ task, i })).sort((a, b) => rank(a.task) - rank(b.task) || a.i - b.i).map(one => one.task)
  const ids = new Set(all.map(task => task.id))
  const mains = byStatus(all.filter(task => task.parentId === undefined || !ids.has(task.parentId)))

  return mains.flatMap(main => {
    const children = byStatus(all.filter(task => task.parentId === main.id))
    const row: Row = {
      task: main,
      depth: 0,
      shown: shownStatus(main, all),
      children: children.length,
      childrenDone: children.filter(child => child.status === 'completed').length,
    }

    return [
      row,
      ...(folded.includes(main.id) ? [] : children.map(child => ({ task: child, depth: 1 as const, shown: child.status, children: 0, childrenDone: 0 }))),
    ]
  })
}

/** Done and total over what is actually worked: subtasks, and main tasks without any. */
export function progress(all: readonly Task[]): { done: number; total: number } {
  const leaves = all.filter(task => !all.some(one => one.parentId === task.id))

  return { done: leaves.filter(task => task.status === 'completed').length, total: leaves.length }
}

/** Cells of sideways drag that make a task a subtask (right) or a main task again (left). */
export const INDENT_CELLS = 3

/** Where a drop would land: the list after it, and where to draw the line in the rows as they are now. */
export type DropPlan = { list: Task[]; lineBeforeId: string | null; depth: 0 | 1 }

/**
 * Plans dropping `dragId` at `slot`, the gap above display row `slot` (`rows.length` is
 * below the last), dragged `dx` cells sideways. Right by INDENT_CELLS nests it under the
 * main task above the gap; left un-nests it; a main task with subtasks stays a main task.
 * The line comes from the list after the drop, so it shows where the task really lands
 * once rows sort by status.
 */
export function planDrop(all: readonly Task[], dragId: string, slot: number, dx: number, folded: readonly string[] = []): DropPlan {
  const rows = displayRows(all, folded)
  const dragged = rows.find(row => row.task.id === dragId)
  if (dragged === undefined) {
    return { list: [...all], lineBeforeId: null, depth: 0 }
  }
  const isInBlock = (row: Row): boolean => row.task.id === dragId || row.task.parentId === dragId
  const rest = rows.filter(row => !isInBlock(row))
  let gap = rows.slice(0, Math.max(0, Math.min(rows.length, slot))).filter(row => !isInBlock(row)).length
  const hasChildren = all.some(task => task.parentId === dragId)
  let depth: 0 | 1 = hasChildren ? 0 : dx >= INDENT_CELLS ? 1 : dx <= -INDENT_CELLS ? 0 : dragged.depth
  const above = rest[gap - 1]
  const parent = depth === 1 && above ? (above.depth === 0 ? above.task : all.find(task => task.id === above.task.parentId)) : undefined
  if (parent === undefined) {
    depth = 0
  }
  // A main task never lands inside another task's subtasks: it moves past them.
  while (depth === 0 && rest[gap]?.depth === 1) {
    gap += 1
  }

  const moving: Task = { ...dragged.task, parentId: depth === 1 ? parent?.id : undefined }
  const list = all.filter(task => task.id !== dragId)
  const prev = rest[gap - 1]
  let at = 0
  if (depth === 1 && parent) {
    const isSibling = prev !== undefined && prev.task.parentId === parent.id
    const firstChild = list.findIndex(task => task.parentId === parent.id)
    at = isSibling ? list.indexOf(prev.task) + 1 : firstChild >= 0 ? firstChild : list.indexOf(parent) + 1
  } else {
    // Rows sort by status, so anchor to the neighbour of the same status: before the main task below
    // the gap, or after the one above it. An anchor of another status would land the task elsewhere.
    const mainOf = (row: Row | undefined): Task | undefined =>
      row === undefined ? undefined : row.depth === 0 ? row.task : list.find(task => task.id === row.task.parentId)
    const rank = (task: Task): string => {
      const shown = shownStatus(task, all)

      return shown === 'partial' ? 'in_progress' : shown
    }
    const below = mainOf(rest[gap])
    const above = mainOf(prev)
    const own = rank(dragged.task)
    if (below && rank(below) === own) {
      at = list.indexOf(below)
    } else if (above) {
      at = list.indexOf(above) + 1
    } else if (below) {
      at = list.indexOf(below)
    }
  }
  list.splice(at, 0, moving)

  // The line goes above whatever follows the moved task (its own subtasks skipped) once the list is re-sorted.
  const after = displayRows(list, folded)
  const landed = after.findIndex(row => row.task.id === dragId)
  const next = after.slice(landed + 1).find(row => !isInBlock(row))

  return { list, lineBeforeId: next ? next.task.id : null, depth }
}

/** Whose a task is; a task saved before owners existed is the agent's. */
export function ownerOf(task: Task): Owner {
  return task.owner ?? 'agent'
}

/** The tasks one card shows, in their stored order. */
export function ownedBy(all: readonly Task[], owner: Owner): Task[] {
  return all.filter(task => ownerOf(task) === owner)
}

/**
 * Hands a task to the other card. A main task takes its subtasks along; a subtask goes
 * on its own and becomes a main task there, since its parent stays behind.
 */
export function moveTask(all: readonly Task[], id: string): Task[] {
  const task = all.find(one => one.id === id)
  if (task === undefined) {
    return [...all]
  }
  const owner: Owner = ownerOf(task) === 'agent' ? 'user' : 'agent'

  return all.map(one => {
    if (one.id === id) {
      const { parentId: _parent, ...rest } = one

      return { ...rest, owner }
    }

    return one.parentId === id ? { ...one, owner } : one
  })
}

/** Tasks that are not archived: what the cards, counts and handoff show. */
export function activeOf(all: readonly Task[]): Task[] {
  return all.filter(task => task.archived !== true)
}

/** Archives a task, or restores it; a main task takes its subtasks along either way. */
export function setArchived(all: readonly Task[], id: string, isArchived: boolean): Task[] {
  return all.map(task => {
    if (task.id !== id && task.parentId !== id) {
      return task
    }
    const { archived: _archived, ...rest } = task

    return isArchived ? { ...rest, archived: true } : rest
  })
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

/** The person's open to-dos worth bringing into a new session: open main to-dos, with their open subtasks. */
export function openTodos(all: readonly Task[]): Task[] {
  const open = activeOf(ownedBy(all, 'user')).filter(task => task.status !== 'completed')
  const mains = open.filter(task => task.parentId === undefined)

  return [...mains, ...open.filter(task => mains.some(main => main.id === task.parentId))]
}

/** The offered to-dos this card does not hold yet (by id or wording), with their subtasks. */
export function newTodos(offered: readonly Task[], list: readonly Task[]): Task[] {
  const isHeld = (task: Task) => list.some(one => one.id === task.id || one.subject.toLowerCase() === task.subject.toLowerCase())
  const mains = offered.filter(task => task.parentId === undefined && !isHeld(task))

  return [...mains, ...offered.filter(task => mains.some(main => main.id === task.parentId))]
}

/** A step of the desktop app's task list (`update_plan`): its text and status. */
export type PlanItem = { content: string; status: TaskStatus }

/** The desktop app's task-list call: a whole new list, or moves on the current one (1-based steps). */
export type PlanCall = { items?: readonly PlanItem[]; advance?: boolean; done?: readonly number[]; start?: number }

/**
 * Replaces the tasks a tool keeps as a whole list (TodoWrite, update_plan), ids `<prefix><index>`.
 * Ids follow the list's order, so an archived one is recognised by its subject.
 */
export function replaceList(list: readonly Task[], prefix: string, items: readonly PlanItem[]): Task[] {
  const archivedSubjects = list.filter(task => task.id.startsWith(prefix) && task.archived === true).map(task => task.subject)

  return [
    ...list.filter(task => !task.id.startsWith(prefix)),
    ...items.map((item, i) => ({
      id: `${prefix}${i}`,
      subject: item.content,
      status: item.status,
      ...(archivedSubjects.includes(item.content) ? { archived: true } : {}),
    })),
  ]
}

/** The task list after an `update_plan` call: a new list replaces the plan, `advance` finishes the step in progress and starts the next. */
export function applyPlan(list: readonly Task[], call: PlanCall): Task[] {
  const prefix = 'plan-'
  if (call.items !== undefined) {
    return replaceList(list, prefix, call.items.filter(item => typeof item?.content === 'string'))
  }
  const steps = list.filter(task => task.id.startsWith(prefix))
  const statusOf = new Map(steps.map(task => [task.id, task.status]))
  const at = (step: number) => `${prefix}${step - 1}`
  if (call.advance === true) {
    const current = steps.findIndex(task => task.status === 'in_progress')
    const next = steps.findIndex((task, i) => i > current && task.status === 'pending')
    if (current >= 0) {
      statusOf.set(steps[current]!.id, 'completed')
    }
    if (next >= 0) {
      statusOf.set(steps[next]!.id, 'in_progress')
    }
  }
  for (const step of call.done ?? []) {
    statusOf.set(at(step), 'completed')
  }
  if (call.start !== undefined) {
    statusOf.set(at(call.start), 'in_progress')
  }

  return list.map(task => (statusOf.has(task.id) ? { ...task, status: statusOf.get(task.id)! } : task))
}
