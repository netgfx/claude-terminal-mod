/** One style of the screen: colours as #rrggbb, flags as 1. */
export type Style = { f?: string; b?: string; B?: 1; I?: 1; U?: 1; R?: 1; D?: 1; S?: 1 }

/** One screen frame from the PTY host: rows of [text, style index] runs. */
export type Frame = {
  cols: number
  rows: number
  r: [string, number][][]
  s: Style[]
  /** cursor [x, y], null while scrolled back */
  c: [number, number] | null
  /** lines scrolled back from the bottom */
  up: number
}

/** What the Client surface module draws from. */
export type ViewProps = Partial<Frame> & { note?: string; ack?: number; ackId?: string }
