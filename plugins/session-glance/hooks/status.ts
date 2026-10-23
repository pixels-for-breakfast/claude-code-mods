import type { Owner, Task } from '../types'
import { activeOf, displayRows, ownedBy } from './tree'

/** The status card's text: what the model wrote, read into fields, criteria and the markdown handoff. */

/** The status fields, each label in a theme colour for what it means, so the card reads at a glance in light and dark. */
export const FIELDS = [
  { key: 'goal', label: 'Goal', color: 'suggestion' },
  { key: 'done_when', label: 'Done when', color: 'permission' },
  { key: 'done', label: 'Done', color: 'success' },
  { key: 'next', label: 'Next', color: 'warning' },
] as const

/** Reads `Label: value` lines (any case) into goal / done_when / done / next / drift; prose without labels comes back whole as `goal`. */
export function parseSummary(text: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*[-*]?\s*(goal|done[\s_-]*when|done|next|drift|retitle|your[\s_-]*move)\s*:\s*(.+)$/i)
    if (match?.[1] && match[2]) {
      fields[match[1].toLowerCase().replace(/[\s-]+/g, '_')] = match[2].trim()
    }
  }

  return Object.keys(fields).length === 0 && text.trim() !== '' ? { goal: text.trim() } : fields
}

export type Criterion = { text: string; isMet: boolean; isTicked: boolean }

/**
 * Splits DONE_WHEN into criteria: `[x] met; [ ] open`. A criterion the person ticked stays met
 * whatever the model says. A line without markers is one open criterion, as older summaries wrote it.
 */
export function parseCriteria(doneWhen: string | undefined, tickedKeys: readonly string[]): Criterion[] {
  if (doneWhen === undefined || doneWhen.trim() === '') {
    return []
  }

  return doneWhen
    .split(';')
    .map(part => part.trim().match(/^(?:\[([ xX])\]\s*)?(.+)$/))
    .flatMap(match => {
      const text = match?.[2]?.trim() ?? ''
      const isTicked = tickedKeys.includes(text.toLowerCase())

      return text === '' ? [] : [{ text, isMet: isTicked || match?.[1]?.toLowerCase() === 'x', isTicked }]
    })
}

/** DONE_WHEN written back from criteria, for the next summary prompt. */
export function formatCriteria(criteria: readonly Criterion[]): string {
  return criteria.map(criterion => `[${criterion.isMet ? 'x' : ' '}] ${criterion.text}`).join('; ')
}

/** A RETITLE line worth offering: not "none", not the title the session already has, not one the person dismissed. */
export function suggestionFrom(retitle: string | undefined, anchor: string, dismissed: readonly string[]): string {
  const suggestion = driftNote(retitle).replace(/^["']|["']$/g, '').slice(0, 80)

  return suggestion === '' || suggestion.toLowerCase() === anchor.toLowerCase() || dismissed.includes(suggestion.toLowerCase()) ? '' : suggestion
}

/** The drift line to show, or empty when the turn served the goal. */
export function driftNote(drift: string | undefined): string {
  return drift === undefined || /^(none|no|n\/a|-)?\.?$/i.test(drift.trim()) ? '' : drift.trim()
}

/**
 * The session as markdown to paste into a PR, a standup or the next session: title, status,
 * done-when as checkboxes and the whole checklist (folded subtasks too) in the pane's order.
 */
export function handoffMarkdown(sessionTitle: string, text: string, all: readonly Task[], tickedKeys: readonly string[]): string {
  const fields = parseSummary(text)
  const criteria = parseCriteria(fields.done_when, tickedKeys)
  const status = [
    fields.goal ? `**Goal:** ${fields.goal}` : '',
    criteria.length > 0 ? ['**Done when:**', ...criteria.map(criterion => `- [${criterion.isMet ? 'x' : ' '}] ${criterion.text}`)].join('\n') : '',
    fields.done ? `**Done:** ${fields.done}` : '',
    fields.next ? `**Next:** ${fields.next}` : '',
  ].filter(part => part !== '')
  const section = (heading: string, owner: Owner): string[] => {
    const lines = displayRows(activeOf(ownedBy(all, owner))).map(row => `${row.depth === 1 ? '  ' : ''}- [${row.shown === 'completed' ? 'x' : ' '}] ${row.task.subject}`)

    return lines.length > 0 ? [heading, lines.join('\n')] : []
  }

  return [`# ${sessionTitle || 'Session'}`, ...status, ...section('## Agent tasks', 'agent'), ...section('## Your to-dos', 'user')].join('\n\n')
}

/** What a compaction is told to keep: the goal and its done-when, word for word; empty with neither. */
export function compactNote(text: string): string {
  const fields = parseSummary(text)
  const lines = [fields.goal ? `Goal: ${fields.goal}` : '', fields.done_when ? `Done when: ${fields.done_when}` : ''].filter(line => line !== '')

  return lines.length === 0 ? '' : `Keep the session's goal in the summary, word for word. ${lines.join('. ')}.`
}

/** Token counts as the footer shows them: 950, 1.2k, 18k. */
export function formatTokens(count: number): string {
  return count < 1000 ? `${count}` : count < 10_000 ? `${(count / 1000).toFixed(1)}k` : `${Math.round(count / 1000)}k`
}

/** The selection as a task text: whitespace folded, cut to what the task check reads. */
export function selectionTask(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 500)
}
