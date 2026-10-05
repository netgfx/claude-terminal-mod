import type { ClientModule } from 'claude-code'

import type { Style, ViewProps } from '../types'

type Key = { key: string; ctrl?: true; shift?: true; meta?: true }
type Sent = { seq: number; ev: Key }
type State = {
  id: string
  seq: number
  outbox: Sent[]
  sentCols: number
  sentRows: number
  ack: number
}

// Draws the PTY's screen and hands every key (Escape aside: it returns focus
// to Claude) to the hooks module. Keys stay in the outbox until the hooks
// module acks them, since an undelivered post is replaced by the next one.
const TermView: ClientModule<ViewProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  let state = surface.state
  if (state === undefined) {
    const fresh: State = { id: Math.random().toString(36).slice(2), seq: 0, outbox: [], sentCols: 0, sentRows: 0, ack: 0 }
    state = fresh
    const flush = () => {
      fresh.outbox = fresh.outbox.filter(sent => sent.seq > fresh.ack)
      const sized = surface.columns > 0 && (surface.columns !== fresh.sentCols || surface.rows !== fresh.sentRows)
      if (!sized && fresh.outbox.length === 0) return
      fresh.sentCols = surface.columns
      fresh.sentRows = surface.rows
      surface.post({ t: 'in', id: fresh.id, ev: fresh.outbox, cols: surface.columns, rows: surface.rows })
    }
    surface.onKey(e => {
      fresh.outbox.push({ seq: ++fresh.seq, ev: { key: e.key, ...(e.ctrl && { ctrl: true }), ...(e.shift && { shift: true }), ...(e.meta && { meta: true }) } })
      flush()
    })
    surface.every(40, flush)
    surface.setState(fresh)
  }
  if (props.ack !== undefined && props.ackId === state.id) state.ack = Math.max(state.ack, props.ack)

  const rows = props.r ?? []
  const styles = props.s ?? []
  const [cx, cy] = props.c ?? [-1, -1]
  const height = Math.max(1, surface.rows || rows.length)

  const span = (text: string, style: Style | undefined, cursor = false) => (
    <Text
      color={style?.f}
      backgroundColor={style?.b}
      bold={style?.B === 1}
      italic={style?.I === 1}
      underline={style?.U === 1}
      dimColor={style?.D === 1}
      strikethrough={style?.S === 1}
      inverse={(style?.R === 1) !== cursor}
    >
      {text}
    </Text>
  )

  const line = (y: number) => {
    const runs = rows[y] ?? []
    if (y !== cy) {
      if (runs.length === 0) return <Text> </Text>
      return <Text wrap="truncate-end">{runs.map(([text, sid]) => span(text, styles[sid]))}</Text>
    }
    // the cursor's row: split the run under it and draw that cell inverse
    const parts = []
    let x = 0
    let drawn = false
    for (const [text, sid] of runs) {
      const chars = [...text]
      if (!drawn && cx >= x && cx < x + chars.length) {
        const at = cx - x
        if (at > 0) parts.push(span(chars.slice(0, at).join(''), styles[sid]))
        parts.push(span(chars[at]!, styles[sid], true))
        if (at + 1 < chars.length) parts.push(span(chars.slice(at + 1).join(''), styles[sid]))
        drawn = true
      } else parts.push(span(text, styles[sid]))
      x += chars.length
    }
    if (!drawn && cx >= 0) {
      if (cx > x) parts.push(span(' '.repeat(cx - x), undefined))
      parts.push(span(' ', undefined, true))
    }
    return <Text wrap="truncate-end">{parts}</Text>
  }

  const lines = []
  for (let y = 0; y < height; y++) lines.push(line(y))
  if (rows.length === 0 && props.note) lines[0] = <Text dimColor>{props.note}</Text>

  return <Box flexDirection="column">{lines}</Box>
}

export default TermView
