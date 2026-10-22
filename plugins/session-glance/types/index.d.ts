export type TaskStatus = 'pending' | 'in_progress' | 'completed'
/** A task; `parentId` makes it a subtask of that main task (one level deep). */
export type Task = { id: string; subject: string; status: TaskStatus; parentId?: string }
/** What the mod's own model calls cost this session, summed from each call's usage. */
export type Spent = { calls: number; input: number; output: number }

declare module 'claude-code' {
  interface PluginState {
    'session-glance': {
      summary: string
      lastPrompt: string
      lastAnswer: string
      isSummarizing: boolean
      tasks: Task[]
      title: string
      isSummaryOpen: boolean
      isTasksOpen: boolean
      isPaneOpen: boolean
      isManaging: boolean
      isValidating: boolean
      addCount: number
      selectedId: string
      draft: Task[]
      draftBaseIds: string[]
      subtaskCount: number
      folded: string[]
      ticked: string[]
      spent: Spent
      restoredFor: string
      titleAnchor: string
      titleSuggestion: string
      pendingTitle: string
      dismissedTitles: string[]
    }
  }
}
