import type { Task } from '../types'
import { FIELDS, formatCriteria, parseCriteria, parseSummary } from './status'

/** What the mod asks the model, and how its replies are read back. */

/** Splits the model's reply into the session title and the summary lines below it. */
export function splitReply(reply: string): { title: string; summary: string } {
  const match = reply.trim().match(/^TITLE:\s*(.+)\n?([\s\S]*)$/)

  return match ? { title: (match[1] ?? '').trim().slice(0, 80), summary: (match[2] ?? '').trim() } : { title: '', summary: reply.trim() }
}

/** Builds the rolling-summary prompt: the previous status is folded together with the latest exchange. */
export function summaryPrompt(previous: string, prompt: string, answer: string, tickedKeys: readonly string[] = [], titleToCheck = ''): string {
  const fields = parseSummary(previous)
  const doneWhen = formatCriteria(parseCriteria(fields.done_when, tickedKeys))

  return [
    `You keep a glanceable status of a coding session. Reply with exactly these ${titleToCheck === '' ? 'seven' : 'eight'} lines and nothing else:`,
    'TITLE: <session title, max 6 words>',
    'GOAL: <what the user is after, max 12 words>',
    'DONE_WHEN: <1-4 checkable criteria that mean the goal is reached, max 8 words each, separated by "; ", each starting [x] when met, else [ ]>',
    'DONE: <what was just finished, max 12 words>',
    'NEXT: <the next step or open question, max 12 words>',
    'DRIFT: <when the latest exchange did not serve GOAL, what happened instead, max 10 words; else none>',
    "YOUR_MOVE: <when the next step is the user's own (push, review, answer a question, decide, test by hand), that step as a short imperative, max 8 words; else none>",
    ...(titleToCheck === ''
      ? []
      : [
          `RETITLE: <only when the session's work as a whole has moved away from what the title "${titleToCheck}" describes (a detour of one exchange is not enough): a title that fits it now, max 6 words; else none>`,
        ]),
    'Keep criteria that still apply word for word; a criterion marked [x] in the previous status stays [x]. A new goal gets new criteria.',
    'Terse fragments, no full sentences, no markdown, no repetition between lines.',
    `<previous_status>${previous ? FIELDS.map(field => `${field.key.toUpperCase()}: ${(field.key === 'done_when' ? doneWhen : fields[field.key]) ?? ''}`).join('\n') : '(none yet)'}</previous_status>`,
    `<latest_user_message>${prompt.slice(0, 4000)}</latest_user_message>`,
    `<latest_assistant_reply>${answer.slice(0, 8000)}</latest_assistant_reply>`,
  ].join('\n')
}

export type Verdict = { verdict: 'ok' | 'unclear' | 'duplicate'; subject: string; question: string; options: string[]; duplicateOf: string }

/** Reads Haiku's JSON verdict on a task; anything unreadable is treated as "fine as typed". */
export function parseVerdict(reply: string, typed: string): Verdict {
  const fallback: Verdict = { verdict: 'ok', subject: typed, question: '', options: [], duplicateOf: '' }
  const json = reply.match(/\{[\s\S]*\}/)?.[0]
  if (json === undefined) {
    return fallback
  }
  try {
    const raw = JSON.parse(json) as Partial<Verdict>
    const verdict = raw.verdict === 'unclear' || raw.verdict === 'duplicate' ? raw.verdict : 'ok'
    const options = Array.isArray(raw.options) ? raw.options.filter(o => typeof o === 'string' && o.trim() !== '').slice(0, 3) : []

    return {
      verdict: verdict === 'unclear' && options.length === 0 ? 'ok' : verdict,
      subject: typeof raw.subject === 'string' && raw.subject.trim() !== '' ? raw.subject.trim() : typed,
      question: typeof raw.question === 'string' ? raw.question.trim() : '',
      options,
      duplicateOf: typeof raw.duplicateOf === 'string' ? raw.duplicateOf.trim() : '',
    }
  } catch {
    return fallback
  }
}

/** Builds the validation prompt for a task the person typed. */
export function validationPrompt(typed: string, goal: string, existing: readonly Task[]): string {
  return [
    'A user is adding a task to the checklist of a coding session. Judge the typed text and reply with one JSON object:',
    '{"verdict":"ok"|"unclear"|"duplicate","subject":"<clean imperative task, max 10 words>","question":"<one short question>","options":["<2-3 concrete candidate tasks>"],"duplicateOf":"<existing task>"}',
    '- ok: the task is concrete enough to act on; "subject" is its tidied wording (keep the meaning, fix typos).',
    '- unclear: only when you cannot write a concrete task without guessing; ask the question and give options that each resolve it.',
    '- duplicate: it means the same as an open existing task; name it in "duplicateOf".',
    `<session_goal>${goal || '(unknown)'}</session_goal>`,
    `<existing_tasks>${existing.map(task => `- [${task.status}] ${task.subject}`).join('\n') || '(none)'}</existing_tasks>`,
    `<typed_task>${typed.slice(0, 500)}</typed_task>`,
  ].join('\n')
}
