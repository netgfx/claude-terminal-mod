import type { EngineInterface, HookStream, ProcessSpawnChunk, ProcessSpawnResult, Register, Timer } from 'claude-code'

import type { Frame, ViewProps } from '../types'
import { shellArgs, takeLines, unixShell } from './lib'

const PANE = 'terminal-mod'

type Phase = 'idle' | 'starting' | 'running' | 'exited' | 'error'
type KeyEvent = { key: string; ctrl?: true; shift?: true; meta?: true }
type Inbound = { t: 'in'; id: string; ev: { seq: number; ev: KeyEvent }[]; cols: number; rows: number }

let configured = { shell: '', node: '' }

// The PTY host and the screen it last sent. Module variables: a reload starts
// over, and the old host dies with the old module's spawn loop.
let phase: Phase = 'idle'
let note = ''
let frame: Frame | undefined
let host: { port: number; token: string } | undefined
let stream: HookStream<ProcessSpawnChunk, ProcessSpawnResult> | undefined
let ping: Timer | undefined
let size = { cols: 0, rows: 0 }
let clientId = ''
let lastSeq = 0
let pending: KeyEvent[] = []
let sending: Promise<void> = Promise.resolve()

function viewProps(): ViewProps {
  return { ...(frame ?? {}), note, ack: lastSeq, ackId: clientId }
}

function redraw($: EngineInterface) {
  $.ui.invalidate('ui.render')
}

async function post($: EngineInterface, path: string, body: unknown) {
  const at = host
  if (!at) return
  await $.http
    .fetch(`http://127.0.0.1:${at.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-trm-token': at.token },
      body: JSON.stringify(body),
    })
    .catch(() => undefined)
}

// One request at a time, in order; keys typed meanwhile ride the next batch
function sendKeys($: EngineInterface, events: KeyEvent[]) {
  pending.push(...events)
  sending = sending.then(async () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    await post($, '/in', batch)
  })
}

async function findShell($: EngineInterface): Promise<string> {
  if (configured.shell) return configured.shell
  if ((await $.env.get('OS')) === 'Windows_NT') {
    return $.process
      .run(['pwsh', '-NoLogo', '-NoProfile', '-Command', 'exit 0'], { timeoutMs: 15000 })
      .then(() => 'pwsh', () => 'powershell')
  }
  return unixShell(await $.env.get('SHELL'))
}

// Claude started from the macOS Dock has a bare PATH: ask the login shell where node is
async function findNode($: EngineInterface, shell: string): Promise<string> {
  if (configured.node) return configured.node
  if ((await $.env.get('OS')) === 'Windows_NT') return 'node'
  const login = /fish$/.test(shell) ? '/bin/sh' : shell
  const found = await $.process
    .run([login, '-l', '-c', 'command -v node'], { timeoutMs: 15000 })
    .then(r => r.stdout.trim().split('\n').pop() ?? '', () => '')
  return found || 'node'
}

async function start($: EngineInterface) {
  if (phase === 'starting' || phase === 'running') return
  phase = 'starting'
  note = 'Starting shell…'
  frame = undefined
  redraw($)

  const shell = await findShell($)
  const node = await findNode($, shell)
  const cwd = await $.session.cwd()
  const spec = { shell, args: shellArgs(shell), cwd, cols: size.cols || 100, rows: size.rows || 24 }
  const child = $.process.spawn({ argv: [node, `${$.plugin.root}/pty-host/host.mjs`, JSON.stringify(spec)], cwd })
  stream = child
  let out = ''
  let err = ''
  try {
    for await (const { stream: pipe, text } of child) {
      if (pipe === 'stderr') {
        err = (err + text).slice(-2000)
        continue
      }
      const taken = takeLines(out + text)
      out = taken.rest
      for (const message of taken.messages) {
        if (message.t === 'f') {
          const { t: _t, ...next } = message
          frame = next
          redraw($)
        } else if (message.t === 'ready') {
          host = { port: message.port, token: message.token }
          phase = 'running'
          note = ''
          ping?.cancel()
          ping = $.clock.every(10000, () => void post($, '/ping', {}))
          if (size.cols && (size.cols !== spec.cols || size.rows !== spec.rows)) void post($, '/resize', size)
        } else if (message.t === 'status') {
          note = message.message
          redraw($)
        } else if (message.t === 'error') {
          phase = 'error'
          note = message.message
        } else if (message.t === 'exit') {
          phase = 'exited'
          note = `[${shell} exited with ${message.code}] Press Enter to start a new shell.`
        }
      }
    }
  } catch (error) {
    if (stream === child) {
      phase = 'error'
      const why = error instanceof Error ? error.message : String(error)
      note = `Could not start the PTY host with "${node}": ${why}. Is Node.js 18+ installed? Set its path in /config → terminal-mod → Node.js.`
    }
  } finally {
    if (stream === child) {
      stream = undefined
      host = undefined
      ping?.cancel()
      ping = undefined
      if (phase === 'starting' || phase === 'running') {
        phase = 'error'
        note = err.trim() ? `PTY host stopped: ${err.trim().split('\n').slice(-3).join(' ')}` : 'PTY host stopped.'
      }
      if (phase === 'exited' || phase === 'error') {
        // keep the last screen, with the note on a line of its own below it
        frame = frame ? { ...frame, r: [...frame.r.slice(0, Math.max(0, frame.rows - 1)), [[note, -1]]] } : undefined
      }
      redraw($)
    }
  }
}

async function stop($: EngineInterface) {
  const child = stream
  if (!child) return
  await post($, '/kill', {})
  stream = undefined
  host = undefined
  ping?.cancel()
  ping = undefined
  phase = 'idle'
  frame = undefined
  note = ''
  await child.return(undefined as never).catch(() => undefined)
}

async function restart($: EngineInterface) {
  await stop($)
  phase = 'idle'
  await start($)
}

async function open($: EngineInterface) {
  const opened = await $.ui.open({ id: PANE, title: 'Terminal', focus: true, rows: 24, columns: 100 })
  if (!opened.isPlaced) {
    $.ui.toast(`terminal: ${opened.reason}`)
    return
  }
  // hand the keys straight to the terminal; a click on it does the same
  await $.ui.focus({ requestId: PANE, key: 'term' }).catch(() => undefined)
}

export const register: Register = (on, options) => {
  configured = {
    shell: typeof options.shell === 'string' ? options.shell.trim() : '',
    node: typeof options.node === 'string' ? options.node.trim() : '',
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'trm',
      description: 'Open a real terminal pane in the workspace folder',
    })
    return next(e)
  })

  on('command.run', { command: 'trm' }, async $ => {
    await open($)
    return { text: 'Terminal opened. Click it to type; Esc hands the keys back to Claude.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) await stop($)
    return next(e)
  })

  // The Client posts its size and the keys typed into it
  on('ui.message', { requestId: PANE }, async ($, e) => {
    const data = e.data as Inbound
    if (!data || data.t !== 'in') return {}
    if (data.id !== clientId) {
      clientId = data.id
      lastSeq = 0
    }
    if (data.cols > 0 && data.rows > 0 && (data.cols !== size.cols || data.rows !== size.rows)) {
      size = { cols: data.cols, rows: data.rows }
      if (phase === 'running') void post($, '/resize', size)
    }
    const fresh = data.ev.filter(sent => sent.seq > lastSeq)
    if (fresh.length > 0) lastSeq = fresh[fresh.length - 1]!.seq
    const keys = fresh.map(sent => sent.ev)

    if (phase === 'idle') void start($)
    else if ((phase === 'exited' || phase === 'error') && keys.some(k => k.key === 'return')) void restart($)
    else if (phase === 'running' && keys.length > 0) sendKeys($, keys)

    return { props: viewProps() }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    if (!('Client' in elements)) {
      return <Text dimColor>The terminal draws in the Claude Code terminal and desktop app.</Text>
    }
    const { Client } = elements
    const cols = Math.max(20, e.props.bodyColumns)
    const rows = Math.max(3, e.props.scroll.bodyRows - (phase === 'error' ? 1 : 0))

    return (
      <Box flexDirection="column">
        <Client key="term" module="./term-view.tsx" props={viewProps()} width={cols} height={rows} />
        {phase === 'error' && (
          <Box flexDirection="row" gap={1}>
            <Button key="restart" label="Restart" variant="primary" onPress={() => void restart($)} />
            <Text dimColor wrap="truncate-end">{note}</Text>
          </Box>
        )}
      </Box>
    )
  })
}
