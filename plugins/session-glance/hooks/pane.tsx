import type { ElementTable, RenderChildren, RenderElement } from 'claude-code'

import type { Owner, Spent, Task } from '../types'
import { ARCHIVE, CHEVRON, FOLD, GLYPH, ICON, TRASH, infoIcon } from './icons'
import { MODELS } from './settings'
import type { Criterion } from './status'
import { FIELDS, formatTokens } from './status'
import { HANDLE_CELLS } from './task-list'
import { activeOf, displayRows, ownedBy, progress } from './tree'
import type { Row } from './tree'

/**
 * The pane and the band, drawn from plain data: `register.tsx` reads the state and passes
 * it in as a view, with the actions a press runs. Nothing here reads or writes state.
 */

/** Everything Edit mode can do, shown when the info mark is clicked. */
const EDIT_HELP =
  'Drag ⠿ up or down to reorder. Drag it right to nest a task under the one above, left to take it out again. ' +
  'Click a task to rename it, add subtasks or move it to the other card. The box archives a task, the bin removes it. ' +
  'Nothing changes until Save.'

/** Type and spacing: two steps up the API's five sizes (caption, footnote, body, heading, title), for reading at a glance. */
const TYPE = { text: 'heading', label: 'body', head: 'title', icon: 24, padX: 'xl', padY: 'lg' } as const

/** One setting row of the Settings card. */
export type SettingRow = { key: string; label: string; hint: string; isOn: boolean }

/** What the pane draws, read from the state for one render. */
export type PaneView = {
  isTerminal: boolean
  fields: Record<string, string>
  criteria: Criterion[]
  isReached: boolean
  drift: string
  cost: Spent
  model: string
  suggestion: string
  chosenTitle: string
  busy: boolean
  checking: boolean
  stored: Task[]
  managing: boolean
  editedCard: Owner
  helpOpen: boolean
  adds: number
  mineAdds: number
  selected: string
  subtaskAdds: number
  foldedIds: string[]
  showSummary: boolean
  showTasks: boolean
  showMine: boolean
  showSettings: boolean
  nextMove: string
  archiveOwners: Owner[]
  settingRows: SettingRow[]
}

/** What a press in the pane runs; each one is a closure over the engine in `register.tsx`. */
export type PaneActions = {
  toggleSummary: () => unknown
  toggleCard: (owner: Owner) => unknown
  toggleSettings: () => unknown
  toggleFold: (id: string) => unknown
  toggleArchive: (owner: Owner) => unknown
  toggleHelp: () => unknown
  select: (id: string) => unknown
  changeStatus: (task: Task) => unknown
  startEditing: (owner: Owner) => unknown
  stopEditing: (isSaved: boolean) => unknown
  rename: (task: Task, value: string) => unknown
  addSubtask: (task: Task, value: string) => unknown
  move: (task: Task) => unknown
  archive: (task: Task) => unknown
  remove: (task: Task) => unknown
  restore: (task: Task) => unknown
  add: (value: string, owner: Owner) => unknown
  acceptMove: () => unknown
  dismissMove: () => unknown
  useTitle: () => unknown
  dismissTitle: () => unknown
  toggleCriterion: (criterion: Criterion) => unknown
  copy: () => unknown
  setOption: (key: string, value: boolean | string) => unknown
}

/** The session pane: the Status card, the two task cards, Settings and the cost line. */
export function drawPane(table: ElementTable, view: PaneView, act: PaneActions): RenderElement {
  const { Box, Button, Text } = table
  const Client = 'Client' in table ? table.Client : undefined
  const Input = 'Input' in table ? table.Input : undefined
  const Svg = 'Svg' in table && !view.isTerminal ? table.Svg : undefined
  const {
    isTerminal, fields, criteria, isReached, drift, cost, suggestion, chosenTitle, busy, checking, stored, managing, editedCard,
    helpOpen, adds, mineAdds, selected, subtaskAdds, foldedIds, showSummary, showTasks, showMine, showSettings, nextMove,
    archiveOwners, settingRows,
  } = view
  const hasSummary = Object.keys(fields).length > 0
  const type = TYPE
  // The terminal lays out whole cells only: two per Edit row, a blank one above the text that the drop line can use.
  // Elsewhere the heading-size rows take three.
  const rowHeight = isTerminal ? 2 : 3

  // The terminal draws the small spacing steps as no rows at all, so it gets whole blank rows where the desktop's gaps fall.
  const airy = isTerminal ? 1 : 0
  const header = (key: string, label: string, isOpen: boolean, aside: RenderChildren, onPress: () => unknown) => (
    <Box justifyContent="space-between" alignItems="center" marginBottom={airy}>
      <Box alignItems="center" gap="xs">
        <Button key={key} plain onPress={onPress}>
          <Text weight="medium" size={type.head} color="claude">
            {label}
          </Text>
          {!Svg && <Text color="inactive">{isOpen ? ' ▾' : ' ▸'}</Text>}
        </Button>
        {Svg && <Svg source={isOpen ? CHEVRON.open : CHEVRON.closed} alt={isOpen ? 'collapse' : 'expand'} width={14} height={14} />}
      </Box>
      {aside}
    </Box>
  )
  /** Something the model suggests, with a button to take it and one to dismiss it for good. */
  const suggestionBox = (label: string, text: string, acceptKey: string, acceptLabel: string, onAccept: () => unknown, dismissKey: string, onDismiss: () => unknown) => (
    <Box flexDirection="column" gap="xs" marginBottom={airy}>
      <Text size={type.label} color="suggestion">
        {label}
      </Text>
      <Text size={type.text}>{text}</Text>
      <Box gap="md" alignItems="center">
        <Button key={acceptKey} plain onPress={onAccept}>
          <Text size={type.text} color="claude" weight="medium">
            {acceptLabel}
          </Text>
        </Button>
        <Button key={dismissKey} plain onPress={onDismiss}>
          <Text size={type.text} color="subtle">
            Dismiss
          </Text>
        </Button>
      </Box>
    </Box>
  )
  const note = (text: string) => (
    <Text size={type.text} color="inactive">
      {text}
    </Text>
  )
  // A Button holds text only, so an icon that takes a press is a picture with an empty Button laid over it.
  const iconButton = (key: string, source: string, alt: string, glyph: string, onPress: () => unknown) =>
    Svg ? (
      <Box position="relative">
        <Svg source={source} alt={alt} width={type.icon} height={type.icon} />
        <Box position="absolute" top={0} left={0} width="100%" height="100%">
          <Button key={key} plain onPress={onPress}>
            <Text>{'\u2003'}</Text>
          </Button>
        </Box>
      </Box>
    ) : (
      <Button key={key} plain onPress={onPress}>
        <Text color="inactive">{glyph}</Text>
      </Button>
    )

  /** One task row: checkbox, text that shrinks before anything is pushed out, subtask count and fold caret, trash in Edit mode. */
  const taskRow = (row: Row, isEditing: boolean, isFirst: boolean) => {
    const isFolded = foldedIds.includes(row.task.id)
    // The caret sits at the row's end, so rows with and without one keep their checkboxes in line.
    const fold =
      row.children > 0
        ? iconButton(`fold-${row.task.id}`, isFolded ? FOLD.closed : FOLD.open, isFolded ? 'expand' : 'collapse', isFolded ? '▸' : '▾', () => act.toggleFold(row.task.id))
        : null

    return (
      <Box
        key={`${isEditing ? 'edit' : 'row'}-${row.task.id}`}
        height={isEditing ? rowHeight : undefined}
        alignItems={isEditing && isTerminal ? 'flex-end' : 'center'}
        gap="sm"
        minWidth={0}
        paddingLeft={row.depth === 1 && !isEditing ? 3 : 0}
        // Edit rows keep their fixed pitch: the layer over them maps the pointer by it.
        marginTop={!isEditing && row.depth === 0 && !isFirst ? airy : 0}
      >
        {isEditing && (
          <Box width={HANDLE_CELLS + (row.depth === 1 ? 3 : 0)} flexShrink={0}>
            <Text color="inactive">⠿</Text>
          </Box>
        )}
        {Svg ? (
          <Svg source={ICON[row.shown]} alt={row.shown.replace('_', ' ')} width={type.icon} height={type.icon} />
        ) : (
          <Text color={row.shown === 'in_progress' || row.shown === 'partial' ? 'claude' : 'inactive'}>{GLYPH[row.shown]}</Text>
        )}
        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Button
            key={`${isEditing ? 'select' : 'task'}-${row.task.id}`}
            plain
            onPress={() => (isEditing ? act.select(row.task.id) : act.changeStatus(row.task))}
          >
            <Text
              size={type.text}
              color={row.shown === 'completed' ? 'inactive' : undefined}
              strikethrough={!isEditing && row.shown === 'completed'}
              underline={isEditing && row.task.id === selected}
              wrap="truncate-end"
            >
              {row.task.subject}
            </Text>
          </Button>
        </Box>
        {row.children > 0 && note(`${row.childrenDone}/${row.children}`)}
        {!isEditing && fold}
      </Box>
    )
  }

  /** The buttons of one Edit-mode row, at the row's pitch so they line up with it: fold, archive, remove; one click each, beside the drag layer. */
  const editControls = (row: Row) => (
    <Box key={`controls-${row.task.id}`} height={rowHeight} alignItems={isTerminal ? 'flex-end' : 'center'} justifyContent="flex-end" gap="sm">
      {row.children > 0 &&
        (foldedIds.includes(row.task.id)
          ? iconButton(`fold-${row.task.id}`, FOLD.closed, 'expand', '▸', () => act.toggleFold(row.task.id))
          : iconButton(`fold-${row.task.id}`, FOLD.open, 'collapse', '▾', () => act.toggleFold(row.task.id)))}
      {iconButton(`archive-${row.task.id}`, ARCHIVE, 'Archive', '▤', () => act.archive(row.task))}
      {iconButton(`remove-${row.task.id}`, TRASH, 'Remove', '✕', () => act.remove(row.task))}
    </Box>
  )

  /** One task card: the agent's tasks, or the person's own to-dos. One card edits at a time. */
  const taskCard = (owner: Owner) => {
    const isMine = owner === 'user'
    // The agent's card keeps the keys it had before the split.
    const suffix = isMine ? '-mine' : ''
    const list = activeOf(ownedBy(stored, owner))
    // Shown once in the fold: a subtask archived with its main task goes with it.
    const archivedTasks = ownedBy(stored, owner).filter(
      task => task.archived === true && !stored.some(one => one.id === task.parentId && one.archived === true),
    )
    const isArchiveOpen = archiveOwners.includes(owner)
    const rows = displayRows(list, foldedIds)
    const { done, total } = progress(list)
    const isOpen = isMine ? showMine : showTasks
    // One card edits at a time; while it does, the other shows its tasks and no Edit button.
    const isEditing = managing && editedCard === owner

    return (
      <Box flexDirection="column" gap="sm" borderStyle="round" borderColor="subtle" paddingX={type.padX} paddingY={type.padY}>
        {header(
          `toggle-tasks${suffix}`,
          isMine ? 'Your to-dos' : 'Agent tasks',
          isOpen,
          <Box gap="sm" alignItems="center">
            {checking || total === 0 || done < total ? (
              note(checking ? 'checking…' : total > 0 ? `${done}/${total}` : '')
            ) : (
              <Text size={type.text} color="success">
                {`${done}/${total}`}
              </Text>
            )}
            {isOpen && !managing && (
              <Button key={`toggle-manage${suffix}`} plain onPress={() => act.startEditing(owner)}>
                <Text size={type.text} color="subtle">
                  Edit
                </Text>
              </Button>
            )}
            {isOpen && isEditing && (
              <Button key={`cancel-edit${suffix}`} plain onPress={() => act.stopEditing(false)}>
                <Text size={type.text} color="subtle">
                  Cancel
                </Text>
              </Button>
            )}
            {isOpen && isEditing && (
              <Button key={`save-edit${suffix}`} plain onPress={() => act.stopEditing(true)}>
                <Text size={type.text} color="claude" weight="medium">
                  Save
                </Text>
              </Button>
            )}
          </Box>,
          () => act.toggleCard(owner),
        )}
        {isOpen && isMine && nextMove !== '' && !isEditing && suggestionBox('Your next step?', nextMove, 'add-move', 'Add', act.acceptMove, 'dismiss-move', act.dismissMove)}
        {isOpen && rows.length === 0 && note(isMine ? 'Nothing for you yet.' : 'No tasks yet.')}
        {isOpen && isEditing && Client && rows.length > 0 && (
          // The rows below hold the icons; the layer on top draws handles and the drop line and takes the clicks.
          // The layer covers the handle and text only; the buttons beside it are real Buttons, one click each.
          <Box gap="sm" minWidth={0}>
            <Box flexDirection="column" position="relative" flexGrow={1} flexShrink={1} minWidth={0}>
              {rows.map((row, i) => taskRow(row, true, i === 0))}
              {isTerminal && <Box height={1} />}
              <Box position="absolute" top={0} left={0} right={0} bottom={0}>
                <Client
                  key={`edit-overlay${suffix}`}
                  module="./task-list.tsx"
                  props={{ tasks: list, folded: foldedIds, rowHeight, hasGapRows: isTerminal }}
                  width="100%"
                  height={Math.ceil(rows.length * rowHeight) + (isTerminal ? 1 : 0)}
                />
              </Box>
            </Box>
            <Box flexDirection="column" flexShrink={0}>
              {rows.map(row => editControls(row))}
              {isTerminal && <Box height={1} />}
            </Box>
          </Box>
        )}
        {isOpen &&
          isEditing &&
          Input &&
          rows
            .filter(row => row.task.id === selected)
            .map(row => (
              <Box flexDirection="column" gap="xs" marginTop="sm" borderStyle="round" borderColor="subtle" paddingX="sm" paddingY="sm">
                {note('Rename')}
                <Input key={`rename-${row.task.id}`} value={row.task.subject} submitLabel="Rename" onSubmit={value => act.rename(row.task, value)} />
                {row.depth === 0 && (
                  <Box flexDirection="column" gap="xs" marginTop="xs">
                    {note('Add a subtask')}
                    <Input
                      key={`subtask-${row.task.id}-${subtaskAdds}`}
                      placeholder="What needs doing…"
                      submitLabel="Add"
                      onSubmit={value => act.addSubtask(row.task, value)}
                    />
                  </Box>
                )}
                <Box marginTop="xs">
                  <Button key={`move-${row.task.id}`} plain onPress={() => act.move(row.task)}>
                    <Text size={type.text} color="subtle">
                      {isMine ? 'Hand to the agent' : 'Move to your to-dos'}
                    </Text>
                  </Button>
                </Box>
              </Box>
            ))}
        {isOpen && isEditing && !selected && rows.length > 0 && (
          // One short line about nesting, the least obvious move; a click on the info mark shows the rest.
          <Box marginTop={airy} alignItems="center" gap="sm" minWidth={0}>
            {iconButton('edit-help', infoIcon(helpOpen), helpOpen ? 'Hide help' : 'Show help', '?', act.toggleHelp)}
            <Box flexShrink={1} minWidth={0}>{note('Drag ⠿ right to nest a task under the one above')}</Box>
          </Box>
        )}
        {isOpen && isEditing && helpOpen && !selected && rows.length > 0 && (
          // A blank row above on the terminal, lined up with the line's text after the ?.
          <Box marginTop={isTerminal ? 1 : 'xs'} paddingLeft={isTerminal ? 2 : 0} minWidth={0}>
            {note(EDIT_HELP)}
          </Box>
        )}
        {isOpen && (!isEditing || !Client) && rows.map((row, i) => taskRow(row, false, i === 0))}
        {isOpen && !isEditing && archivedTasks.length > 0 && (
          <Box flexDirection="column" gap="xs" marginTop={airy}>
            <Button
              key={`toggle-archived${suffix}`}
              plain
              onPress={() => act.toggleArchive(owner)}
            >
              <Text size={type.text} color="inactive">
                {`Archived (${archivedTasks.length}) ${isArchiveOpen ? '▾' : '▸'}`}
              </Text>
            </Button>
            {isArchiveOpen &&
              archivedTasks.map(task => (
                <Box key={`archived-${task.id}`} alignItems="center" gap="sm" minWidth={0}>
                  <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
                    <Text size={type.text} color="inactive" wrap="truncate-end">
                      {task.subject}
                    </Text>
                  </Box>
                  <Button key={`restore-${task.id}`} plain onPress={() => act.restore(task)}>
                    <Text size={type.text} color="subtle">
                      Restore
                    </Text>
                  </Button>
                </Box>
              ))}
          </Box>
        )}
        {isOpen && Input && (
          <Box marginTop={isTerminal ? 1 : 'sm'}>
            <Input
              key={`add-task${suffix}-${isMine ? mineAdds : adds}`}
              placeholder={isMine ? 'Add a to-do for yourself…' : 'Add a task for the agent…'}
              submitLabel="Add"
              onSubmit={value => act.add(value, owner)}
            />
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap="lg" padding={isTerminal ? 0 : 'md'}>
      <Box flexDirection="column" gap="sm" borderStyle="round" borderColor="subtle" paddingX={type.padX} paddingY={type.padY}>
        {header(
          'toggle-summary',
          'Status',
          showSummary,
          <Box gap="sm" alignItems="center">
            {note(busy ? 'updating…' : '')}
            {(hasSummary || stored.length > 0) && !managing && (
              <Button
                key="copy-handoff"
                plain
                onPress={act.copy}
              >
                <Text size={type.text} color="subtle">
                  Copy
                </Text>
              </Button>
            )}
          </Box>,
          act.toggleSummary,
        )}
        {suggestion !== '' && suggestionBox('Title suggestion', suggestion, 'use-title', 'Use', act.useTitle, 'dismiss-title', act.dismissTitle)}
        {chosenTitle !== '' && note(`Renames the session to "${chosenTitle}" at your next prompt.`)}
        {showSummary && !hasSummary && (
          <Text size={type.text} color="inactive">
            Appears after the first answer.
          </Text>
        )}
        {showSummary &&
          FIELDS.filter(field => fields[field.key]).map(field => (
            <Box flexDirection="column" marginBottom={airy}>
              <Text size={type.label} color={field.color}>
                {field.label}
              </Text>
              {field.key === 'done_when' ? (
                <Box flexDirection="column">
                  {criteria.map(criterion => (
                    <Box key={`criterion-row-${criterion.text}`} alignItems="center" gap="sm" minWidth={0}>
                      {Svg ? (
                        <Svg source={criterion.isMet ? ICON.completed : ICON.pending} alt={criterion.isMet ? 'met' : 'open'} width={type.icon} height={type.icon} />
                      ) : (
                        <Text color="inactive">{criterion.isMet ? GLYPH.completed : GLYPH.pending}</Text>
                      )}
                      <Box flexGrow={1} flexShrink={1} minWidth={0}>
                        <Button key={`criterion-${criterion.text}`} plain onPress={() => act.toggleCriterion(criterion)}>
                          <Text size={type.text} color={criterion.isMet ? 'inactive' : undefined}>
                            {criterion.text}
                          </Text>
                        </Button>
                      </Box>
                    </Box>
                  ))}
                  {isReached && (
                    <Text size={type.text} color="success">
                      Goal reached: wrap up, or set a new goal.
                    </Text>
                  )}
                </Box>
              ) : (
                <Text size={type.text}>{fields[field.key]}</Text>
              )}
            </Box>
          ))}
        {showSummary && drift !== '' && <Text size={type.text} color="inactive">{`Off goal: ${drift}`}</Text>}
      </Box>

      {taskCard('agent')}
      {taskCard('user')}
      <Box flexDirection="column" gap="sm" borderStyle="round" borderColor="subtle" paddingX={type.padX} paddingY={type.padY}>
        {header('toggle-settings', 'Settings', showSettings, null, act.toggleSettings)}
        {showSettings &&
          settingRows.map(row => (
            <Box key={`setting-row-${row.key}`} justifyContent="space-between" alignItems="center" gap="md" minWidth={0}>
              <Box flexDirection="column" flexShrink={1} minWidth={0}>
                <Text size={type.text}>{row.label}</Text>
                <Text size={type.label} color="inactive">
                  {row.hint}
                </Text>
              </Box>
              <Button key={`setting-${row.key}`} plain onPress={() => act.setOption(row.key, !row.isOn)}>
                <Text size={type.text} color={row.isOn ? 'claude' : 'subtle'} weight={row.isOn ? 'medium' : undefined}>
                  {row.isOn ? 'On' : 'Off'}
                </Text>
              </Button>
            </Box>
          ))}
        {showSettings && (
          <Box justifyContent="space-between" alignItems="center" gap="md" minWidth={0}>
            <Box flexDirection="column" flexShrink={1} minWidth={0}>
              <Text size={type.text}>Model</Text>
              <Text size={type.label} color="inactive">
                For the status and the task check
              </Text>
            </Box>
            <Box gap="md" alignItems="center">
              {MODELS.map(model => (
                <Button key={`model-${model}`} plain onPress={() => act.setOption('summaryModel', model)}>
                  <Text size={type.text} color={view.model === model ? 'claude' : 'subtle'} weight={view.model === model ? 'medium' : undefined}>
                    {model === 'haiku' ? 'Haiku' : 'Sonnet'}
                  </Text>
                </Button>
              ))}
            </Box>
          </Box>
        )}
      </Box>
      {cost.calls > 0 && (
        <Text size="footnote" color="inactive">
          {`glance: ${cost.calls} ${cost.calls === 1 ? 'call' : 'calls'} · ${formatTokens(cost.input + cost.output)} tokens (${formatTokens(cost.output)} out) · ${view.model}`}
        </Text>
      )}
    </Box>
  )
}

/** What the band above the prompt draws. */
export type BandView = { isTerminal: boolean; isOpen: boolean; title: string; done: number; total: number; openForYou: number; isSelected: boolean }
export type BandActions = { togglePane: () => unknown; addSelection: (owner: Owner) => unknown }

/** The band above the prompt: the pane toggle, the selection buttons and a one-line status. */
export function drawBand(table: ElementTable, view: BandView, act: BandActions): RenderElement {
  const { Box, Button, Text } = table
  const { isOpen, done, total, openForYou, isSelected } = view
  const current = view.title

  return (
    <Box gap="sm" alignItems="center">
      <Button key="toggle-pane" plain dimColor hotkey={view.isTerminal ? 'g' : undefined} onPress={act.togglePane}>
        <Text size="footnote" color="subtle">
          {isOpen ? '◂ Hide status' : '▸ Show status'}
        </Text>
      </Button>
      {isSelected && (
        <Button key="task-from-selection" plain onPress={() => act.addSelection('agent')}>
          <Text size="footnote" color="claude">
            + Task
          </Text>
        </Button>
      )}
      {isSelected && (
        <Button key="todo-from-selection" plain onPress={() => act.addSelection('user')}>
          <Text size="footnote" color="claude">
            + To-do
          </Text>
        </Button>
      )}
      <Text size="footnote" color="inactive" wrap="truncate-end">
        {current || 'No status yet'}
        {total > 0 ? `  ·  ${done}/${total} tasks` : ''}
        {openForYou > 0 ? `  ·  ${openForYou} for you` : ''}
      </Text>
    </Box>
  )
}
