import type { ShownStatus } from './tree'

/** The pictures and glyphs the pane draws: SVG on surfaces that draw pictures, glyphs on the terminal. */

export const GLYPH = { in_progress: '◐', partial: '◒', pending: '○', completed: '●' } as const

/** Rounded-square checkboxes in the desktop sidebar's grey; in progress and partly done in the accent. */
export const ICON: Record<ShownStatus, string> = {
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
export const FOLD = {
  open: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4.5 6.5l3.5 3.5 3.5-3.5" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  closed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6.5 4.5l3.5 3.5-3.5 3.5" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
} as const

/** A trash bin and an archive box in the sidebar's grey: drawn as pictures, pressed through the Button laid over each. */
export const TRASH =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#8a8a8a" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.2h11M6.2 4.2V2.8h3.6v1.4M4 4.2l.7 9h6.6l.7-9M6.7 6.6v4.6M9.3 6.6v4.6"/></svg>'
export const ARCHIVE =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="#8a8a8a" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="3" rx="0.8"/><path d="M3.2 6v6.5h9.6V6M6.5 8.8h3"/></svg>'

/** Desktop chevrons in the sidebar's grey, drawn beside the header label as the app's own cards do. */
export const CHEVRON = {
  open: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M4.5 6.5l3.5 3.5 3.5-3.5" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  closed: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M6.5 4.5l3.5 3.5-3.5 3.5" fill="none" stroke="#8a8a8a" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
} as const

/** An info mark: grey at rest, in the accent while its help is open. */
export function infoIcon(isOpen: boolean): string {
  const color = isOpen ? '#d97757' : '#8a8a8a'

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
    `<circle cx="8" cy="8" r="6.2" fill="none" stroke="${color}" stroke-width="1.3"/>` +
    `<path d="M8 7.2v4" stroke="${color}" stroke-width="1.4" stroke-linecap="round"/>` +
    `<circle cx="8" cy="4.9" r="0.85" fill="${color}"/></svg>`
  )
}
