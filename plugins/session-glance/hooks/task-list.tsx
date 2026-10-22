import type { ClientModule } from 'claude-code'

import type { Task } from '../types'
import { INDENT_CELLS, displayRows, planDrop } from './tree'

/** Cells the handle takes at a row's left, and the trash and fold caret at its right, as the pane lays them out. */
export const HANDLE_CELLS = 2
const TRASH_CELLS = 2.5
const FOLD_CELLS = 2.5

/**
 * `hasGapRows`: each row's text sits on its last cell with blank cells above it, plus one
 * blank row after the list (the terminal), so the line goes in a blank row and never over text.
 */
export type OverlayProps = { tasks: Task[]; folded: string[]; rowHeight: number; hasGapRows?: boolean }
type DragState = { dragId: string; startX: number; startY: number; slot: number; dx: number; isMoved: boolean }

const IDLE: DragState = { dragId: '', startX: 0, startY: 0, slot: -1, dx: 0, isMoved: false }

/**
 * A see-through layer over the Edit-mode rows. While a handle is dragged it draws
 * the line where the task will land, on its own: the pane is not redrawn until the
 * drop, as the desktop holds that back while the pointer is captured. Being on top,
 * it also takes the rows' clicks and posts them to the pane by zone: the trash and
 * fold caret at the right, the task text elsewhere.
 */
const EditOverlay: ClientModule<OverlayProps, DragState> = (props, surface) => {
  const { Box, Text } = surface.elements
  const drag = surface.state ?? IDLE
  const rows = displayRows(props.tasks, props.folded)
  const pitch = props.rowHeight
  // The layer's own size, from its props: the desktop sizes the region to what it draws, and
  // `surface.rows` is 0 until it has measured, so drawing by that left a one-cell strip.
  const height = Math.max(1, Math.ceil(rows.length * pitch) + (props.hasGapRows ? 1 : 0))
  const yOf = (event: { y: number; fine?: { y: number } }): number => event.fine?.y ?? event.y + 0.5
  const xOf = (event: { x: number; fine?: { x: number } }): number => event.fine?.x ?? event.x + 0.5
  const rowAt = (y: number): number => Math.max(0, Math.min(rows.length - 1, Math.floor(y / pitch)))
  // The gap nearest the pointer: 0 is above the first row, rows.length below the last.
  const slotAt = (y: number): number => Math.max(0, Math.min(rows.length, Math.round(y / pitch)))
  const dxAt = (x: number): number => {
    const dx = x - drag.startX

    return dx >= INDENT_CELLS ? INDENT_CELLS : dx <= -INDENT_CELLS ? -INDENT_CELLS : 0
  }

  /** A press that did not drag: which control of the row it landed on. */
  const click = (x: number, y: number): void => {
    const row = rows[rowAt(y)]
    if (row === undefined) {
      return
    }
    const fromRight = surface.columns - x
    if (fromRight <= TRASH_CELLS) {
      surface.post({ type: 'remove', id: row.task.id })
    } else if (row.children > 0 && fromRight <= TRASH_CELLS + FOLD_CELLS) {
      surface.post({ type: 'fold', id: row.task.id })
    } else if (x > HANDLE_CELLS) {
      surface.post({ type: 'select', id: row.task.id })
    }
  }

  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') {
      const isHandle = xOf(event) <= HANDLE_CELLS
      const row = rows[rowAt(yOf(event))]
      surface.setState({
        dragId: isHandle && row ? row.task.id : '',
        startX: xOf(event),
        startY: yOf(event),
        slot: rowAt(yOf(event)),
        dx: 0,
        isMoved: false,
      })
    } else if (event.type === 'move' && drag.dragId !== '') {
      const next = { ...drag, slot: slotAt(yOf(event)), dx: dxAt(xOf(event)), isMoved: true }
      if (next.slot !== drag.slot || next.dx !== drag.dx || !drag.isMoved) {
        surface.setState(next)
      }
    } else if (event.type === 'up' && event.button === 'left') {
      if (drag.dragId !== '' && drag.isMoved) {
        surface.post({ type: 'drop', id: drag.dragId, slot: slotAt(yOf(event)), dx: dxAt(xOf(event)) })
      } else if (drag.dragId === '') {
        click(drag.startX, drag.startY)
      }
      surface.setState(IDLE)
    }
  })

  const plan = drag.dragId !== '' && drag.isMoved ? planDrop(props.tasks, drag.dragId, drag.slot, drag.dx, props.folded) : undefined
  const lineRow = plan ? (plan.lineBeforeId === null ? rows.length : rows.findIndex(row => row.task.id === plan.lineBeforeId)) : -1
  // Cells are whole here: a gap on a cell edge is drawn as the cell's top stroke, a gap mid-cell as its middle stroke.
  const gapY = lineRow * pitch
  const lineCell = Math.min(Math.max(0, Math.floor(gapY)), height - 1)
  // Below the last row there is no cell under the gap, so the last cell's bottom stroke marks it.
  const stroke = props.hasGapRows ? '─' : gapY >= height ? '▁' : gapY === Math.floor(gapY) ? '▔' : '─'

  return (
    <Box flexDirection="column" width="100%" height={height} position="relative">
      {plan && lineRow >= 0 && (
        <Box position="absolute" top={lineCell} left={HANDLE_CELLS + (plan.depth === 1 ? 3 : 0)} right={0} height={1} overflow="hidden">
          <Text color="claude" wrap="truncate-end">
            {stroke.repeat(400)}
          </Text>
        </Box>
      )}
    </Box>
  )
}

export default EditOverlay
