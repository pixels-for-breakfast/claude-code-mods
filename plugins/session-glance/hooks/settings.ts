/** The settings the mod keeps in `userConfig`, and how `/glance` switches them. */

/** `/glance <word> on|off` and the userConfig field each one sets. */
export const SWITCHES = {
  rename: { key: 'renameSession', on: 'The status title will now rename this session at your next prompt.', off: 'Sessions keep their own title now.' },
  auto: { key: 'autoSummary', on: 'The status updates after every answer again.', off: 'The status only changes on /glance refresh now.' },
  check: { key: 'checkTasks', on: 'Typed tasks are checked again.', off: 'Typed tasks are added as typed now.' },
  suggest: {
    key: 'suggestTitle',
    on: 'A new title is suggested when the work moves away from the session title (while renaming is off).',
    off: 'No more title suggestions.',
  },
} as const
export const MODELS = ['haiku', 'sonnet'] as const
