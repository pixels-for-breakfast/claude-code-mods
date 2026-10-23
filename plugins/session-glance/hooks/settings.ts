/** The settings the mod keeps in `userConfig`: one row each feeds the Settings card, `/glance <word>` and the defaults. */
export const SWITCHES = [
  {
    key: 'renameSession',
    word: 'rename',
    label: 'Rename the session',
    hint: 'The status title becomes the session title',
    isOnByDefault: false,
    on: 'The status title will now rename this session at your next prompt.',
    off: 'Sessions keep their own title now.',
  },
  {
    key: 'suggestTitle',
    word: 'suggest',
    label: 'Suggest a new title',
    hint: 'When the work moves on; only while renaming is off',
    isOnByDefault: true,
    on: 'A new title is suggested when the work moves away from the session title (while renaming is off).',
    off: 'No more title suggestions.',
  },
  {
    key: 'autoSummary',
    word: 'auto',
    label: 'Update after every answer',
    hint: 'Off: only on /glance refresh',
    isOnByDefault: true,
    on: 'The status updates after every answer again.',
    off: 'The status only changes on /glance refresh now.',
  },
  {
    key: 'checkTasks',
    word: 'check',
    label: 'Check tasks you type',
    hint: 'Tidy the wording, ask when unclear',
    isOnByDefault: true,
    on: 'Typed tasks are checked again.',
    off: 'Typed tasks are added as typed now.',
  },
] as const

export type SwitchKey = (typeof SWITCHES)[number]['key']

export const MODELS = ['haiku', 'sonnet'] as const

/** Whether a switch is on in the stored options; one never set is at its default. */
export function isSwitchOn(options: Readonly<Record<string, unknown>>, key: SwitchKey): boolean {
  const value = options[key]

  return typeof value === 'boolean' ? value : (SWITCHES.find(one => one.key === key)?.isOnByDefault ?? false)
}

/** The model for the status and the task check; anything not offered falls back to haiku. */
export function modelOf(options: Readonly<Record<string, unknown>>): string {
  return MODELS.find(one => one === options.summaryModel) ?? 'haiku'
}
