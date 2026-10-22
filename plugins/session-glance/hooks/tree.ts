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
