/**
 * The settings the mod keeps in `userConfig`: one row each feeds the Settings card, `/glance <word>` and the defaults.
 * `smart` rows only act, and only show, in Smart mode; `card` rows show or hide a card in either mode.
 */
export const SWITCHES = [
  {
    key: 'renameSession',
    group: 'smart',
    word: 'rename',
    label: 'Rename the session',
    hint: 'The status title becomes the session title',
    isOnByDefault: false,
    on: 'The status title will now rename this session at your next prompt.',
    off: 'Sessions keep their own title now.',
  },
  {
    key: 'suggestTitle',
    group: 'smart',
    word: 'suggest',
    label: 'Suggest a new title',
    hint: 'When the work moves on; only while renaming is off',
    isOnByDefault: true,
    on: 'A new title is suggested when the work moves away from the session title (while renaming is off).',
    off: 'No more title suggestions.',
  },
  {
    key: 'autoSummary',
    group: 'smart',
    word: 'auto',
    label: 'Update after every answer',
    hint: 'Off: only on /glance refresh',
    isOnByDefault: true,
    on: 'The status updates after every answer again.',
    off: 'The status only changes on /glance refresh now.',
  },
  {
    key: 'checkTasks',
    group: 'smart',
    word: 'check',
    label: 'Check tasks you type',
    hint: 'Tidy the wording, ask when unclear',
    isOnByDefault: true,
    on: 'Typed tasks are checked again.',
    off: 'Typed tasks are added as typed now.',
  },
  {
    key: 'showStatus',
    group: 'card',
    word: 'show-status',
    label: 'Status card',
    hint: 'Goal, done when, done, next',
    isOnByDefault: true,
    on: 'The Status card is shown again.',
    off: 'The Status card is hidden; turn it on again in Settings.',
  },
  {
    key: 'showAgentTasks',
    group: 'card',
    word: 'show-tasks',
    label: 'Agent tasks card',
    hint: "The agent's own task list",
    isOnByDefault: true,
    on: 'The Agent tasks card is shown again.',
    off: 'The Agent tasks card is hidden; turn it on again in Settings.',
  },
  {
    key: 'showTodos',
    group: 'card',
    word: 'show-todos',
    label: 'Your to-dos card',
    hint: 'What you have to do yourself',
    isOnByDefault: true,
    on: 'The Your to-dos card is shown again.',
    off: 'The Your to-dos card is hidden; turn it on again in Settings.',
  },
] as const

export type SwitchKey = (typeof SWITCHES)[number]['key']

export const MODELS = ['haiku', 'sonnet'] as const

/** Smart has the model write the status and check tasks; Manual makes no model calls and keeps only what you track by hand. */
export const MODES = ['smart', 'manual'] as const
export type Mode = (typeof MODES)[number]

/** The mode in the stored options; anything else is Smart, the default. */
export function modeOf(options: Readonly<Record<string, unknown>>): Mode {
  return options.mode === 'manual' ? 'manual' : 'smart'
}

/** Whether a switch is on in the stored options; one never set is at its default. */
export function isSwitchOn(options: Readonly<Record<string, unknown>>, key: SwitchKey): boolean {
  const value = options[key]

  return typeof value === 'boolean' ? value : (SWITCHES.find(one => one.key === key)?.isOnByDefault ?? false)
}

/** The model for the status and the task check; anything not offered falls back to haiku. */
export function modelOf(options: Readonly<Record<string, unknown>>): string {
  return MODELS.find(one => one === options.summaryModel) ?? 'haiku'
}
