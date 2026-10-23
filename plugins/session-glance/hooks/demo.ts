import type { HistoryEntry, Task } from '../types'

/** What `/glance demo` fills the pane with. */

export const DEMO_TASKS: Task[] = [
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
export const DEMO_TITLE = 'Session glance demo'
/** A title the work has moved on to, so the demo shows the Status card's title suggestion too. */
export const DEMO_SUGGESTION = 'Session pane with drag-and-drop editing'
export const DEMO_SUMMARY = [
  'GOAL: Glanceable status and checklist beside the session',
  'DONE_WHEN: [x] Every task state shows; [ ] Subtasks fold and unfold; [ ] Dragging reorders the list',
  'DONE: Seeded a demo of everything the pane can show',
  'NEXT: Click a task, then try Edit mode and drag one',
].join('\n')
export const DEMO_FOLDED = ['demo-8']

/** Oldest first; the newest entry is the Done line of DEMO_SUMMARY, which the Status card shows above Earlier. */
export const DEMO_HISTORY: HistoryEntry[] = [
  { turn: 1, done: 'Sketched the pane layout' },
  { turn: 2, done: 'Wrote the summary prompt' },
  { turn: 3, done: 'Drew the toggle button above the prompt' },
  { turn: 4, done: 'Seeded a demo of everything the pane can show' },
]
