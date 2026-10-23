export type TaskStatus = 'pending' | 'in_progress' | 'completed'
/** Whose task it is: the agent's (from its task tools, or added for it) or the person's own to-do. */
export type Owner = 'agent' | 'user'
/** A task; `parentId` makes it a subtask of that main task (one level deep). No `owner` means the agent's; `archived` puts it away. */
export type Task = { id: string; subject: string; status: TaskStatus; parentId?: string; owner?: Owner; archived?: boolean }
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
      isMineOpen: boolean
      mineAddCount: number
      moveSuggestion: string
      dismissedMoves: string[]
      hasSelection: boolean
      openArchives: Owner[]
      isSettingsOpen: boolean
      editingOwner: Owner
      isHelpOpen: boolean
      carryOffer: Task[]
      yourMove: string
    }
  }
}
