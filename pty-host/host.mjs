// terminal-mod PTY host: runs a real shell in a pseudo-terminal (ConPTY on
// Windows, forkpty on macOS/Linux), keeps the screen in a headless xterm and
// streams it to the mod as JSON lines on stdout. Input arrives over a
// token-protected HTTP server bound to 127.0.0.1.
//
//   node host.mjs '{"shell":"pwsh","args":[],"cwd":"...","cols":100,"rows":30}'
//
// stdout lines: {"t":"ready","port","token"} | {"t":"f",...frame} | {"t":"exit","code"} | {"t":"error","message"}
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const say = msg => {
  try {
    process.stdout.write(JSON.stringify(msg) + '\n')
  } catch {
    process.exit(0)
  }
}
process.stdout.on('error', () => process.exit(0))

// First run on a machine (or a new OS/arch): fetch the native PTY build
function load() {
  try {
    return { pty: require('@lydell/node-pty'), xterm: require('@xterm/headless') }
  } catch (error) {
    say({ t: 'status', message: 'Installing terminal support (one-time npm install)…' })
    const r = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--omit=dev'], { cwd: here, shell: true, encoding: 'utf8' })
    if (r.status !== 0) {
      say({ t: 'error', message: `npm install failed in ${here}: ${(r.stderr || r.stdout || String(error)).trim().slice(-400)}` })
      process.exit(1)
    }
    for (const key of Object.keys(require.cache)) delete require.cache[key]
    return { pty: require('@lydell/node-pty'), xterm: require('@xterm/headless') }
  }
}

const opts = JSON.parse(process.argv[2] ?? '{}')
const { pty, xterm } = load()
const Terminal = xterm.Terminal ?? xterm.default?.Terminal

let cols = Math.max(10, opts.cols | 0 || 100)
let rows = Math.max(3, opts.rows | 0 || 30)
const term = new Terminal({ cols, rows, scrollback: 5000, allowProposedApi: true })

const env = { ...process.env, ...(opts.env ?? {}), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'terminal-mod' }
for (const key of ['NO_COLOR', 'CLICOLOR', 'PAGER', 'GIT_PAGER', 'CLAUDECODE']) if (!(opts.env && key in opts.env)) delete env[key]

// ConPTY wants a real file: resolve `pwsh` to C:\...\pwsh.exe through PATH
function executable(shell) {
  if (process.platform !== 'win32' || /[\\/]/.test(shell)) return shell
  const r = spawnSync('where.exe', [shell], { encoding: 'utf8' })
  const hit = r.status === 0 && r.stdout.split(/\r?\n/).find(line => /\.(exe|com)$/i.test(line.trim()))
  return hit ? hit.trim() : /\.\w+$/.test(shell) ? shell : shell + '.exe'
}

let child
try {
  child = pty.spawn(executable(opts.shell), opts.args ?? [], { name: 'xterm-256color', cols, rows, cwd: opts.cwd || process.cwd(), env })
} catch (error) {
  say({ t: 'error', message: `could not start ${opts.shell}: ${error?.message ?? error}` })
  process.exit(1)
}

// The shell's queries (cursor position, device attributes) answered by xterm go back to it
term.onData(data => child.write(data))
child.onData(data => term.write(data, schedule))
child.onExit(({ exitCode }) => {
  flush()
  say({ t: 'exit', code: exitCode })
  setTimeout(() => process.exit(0), 50)
})

// ---- frames ---------------------------------------------------------------

const BASE16 = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff']
const hex = n => '#' + n.toString(16).padStart(6, '0')
const palette = i => {
  if (i < 16) return BASE16[i]
  if (i < 232) {
    const v = i - 16, step = [0, 95, 135, 175, 215, 255]
    return hex((step[Math.floor(v / 36)] << 16) | (step[Math.floor(v / 6) % 6] << 8) | step[v % 6])
  }
  const g = 8 + (i - 232) * 10
  return hex((g << 16) | (g << 8) | g)
}

function styleOf(cell) {
  const s = {}
  if (cell.isFgRGB()) s.f = hex(cell.getFgColor())
  else if (cell.isFgPalette()) s.f = palette(cell.getFgColor())
  if (cell.isBgRGB()) s.b = hex(cell.getBgColor())
  else if (cell.isBgPalette()) s.b = palette(cell.getBgColor())
  if (cell.isBold()) s.B = 1
  if (cell.isItalic()) s.I = 1
  if (cell.isUnderline()) s.U = 1
  if (cell.isInverse()) s.R = 1
  if (cell.isDim()) s.D = 1
  if (cell.isStrikethrough()) s.S = 1
  return s
}

let timer
let last = ''
function schedule() {
  if (!timer) timer = setTimeout(flush, 16)
}
function flush() {
  clearTimeout(timer)
  timer = undefined
  const buf = term.buffer.active
  const styles = []
  const ids = new Map()
  const idOf = s => {
    const k = JSON.stringify(s)
    let id = ids.get(k)
    if (id === undefined) ids.set(k, (id = styles.push(s) - 1))
    return id
  }
  const cell = buf.getNullCell()
  const lines = []
  for (let y = 0; y < rows; y++) {
    const line = buf.getLine(buf.viewportY + y)
    const runs = []
    if (line) {
      let text = '', sid = -1
      for (let x = 0; x < cols; x++) {
        line.getCell(x, cell)
        if (cell.getWidth() === 0) continue // right half of a wide character
        const id = idOf(styleOf(cell))
        if (id !== sid && text) runs.push([text, sid]), (text = '')
        sid = id
        text += cell.getChars() || ' '
      }
      if (text) runs.push([text, sid])
      // trailing blanks in the default style carry nothing
      const end = runs[runs.length - 1]
      if (end && styles[end[1]] && Object.keys(styles[end[1]]).length === 0) {
        end[0] = end[0].trimEnd()
        if (!end[0]) runs.pop()
      }
    }
    lines.push(runs)
  }
  const atBottom = buf.viewportY === buf.baseY
  const frame = { t: 'f', cols, rows, r: lines, s: styles, c: atBottom ? [buf.cursorX, buf.cursorY] : null, up: buf.baseY - buf.viewportY }
  const json = JSON.stringify(frame)
  if (json !== last) {
    last = json
    process.stdout.write(json + '\n')
  }
}

// ---- keys -----------------------------------------------------------------

const CSI = '\x1b['
const SS3 = '\x1bO'
const mod = e => 1 + (e.shift ? 1 : 0) + (e.meta ? 2 : 0) + (e.ctrl ? 4 : 0)
const TILDE = { insert: 2, delete: 3, pageup: 5, pagedown: 6, f5: 15, f6: 17, f7: 18, f8: 19, f9: 20, f10: 21, f11: 23, f12: 24 }
const LETTER = { up: 'A', down: 'B', right: 'C', left: 'D', home: 'H', end: 'F', f1: 'P', f2: 'Q', f3: 'R', f4: 'S' }

function encode(e) {
  if (typeof e.text === 'string') {
    return term.modes.bracketedPasteMode ? `\x1b[200~${e.text}\x1b[201~` : e.text
  }
  const key = String(e.key ?? '')
  const name = key.toLowerCase()
  const m = mod(e)
  if (name in LETTER) {
    const app = term.modes.applicationCursorKeysMode && /^(up|down|right|left|home|end)$/.test(name)
    if (m > 1) return `${CSI}1;${m}${LETTER[name]}`
    return (app || /^f[1-4]$/.test(name) ? SS3 : CSI) + LETTER[name]
  }
  if (name in TILDE) return `${CSI}${TILDE[name]}${m > 1 ? ';' + m : ''}~`
  switch (name) {
    case 'return': case 'enter': return e.meta ? '\x1b\r' : '\r'
    case 'tab': return e.shift ? `${CSI}Z` : '\t'
    case 'backspace': return e.ctrl ? '\x08' : e.meta ? '\x1b\x7f' : '\x7f'
    case 'escape': case 'esc': return '\x1b'
    case 'space': return e.ctrl ? '\x00' : ' '
  }
  if ([...key].length !== 1) return '' // an unknown named key
  if (e.ctrl) {
    const c = key.toLowerCase().charCodeAt(0)
    if (c >= 97 && c <= 122) return (e.meta ? '\x1b' : '') + String.fromCharCode(c - 96)
    const map = { '[': '\x1b', '\\': '\x1c', ']': '\x1d', '^': '\x1e', '_': '\x1f', '/': '\x1f', '@': '\x00', ' ': '\x00', '2': '\x00' }
    if (key in map) return map[key]
  }
  return (e.meta ? '\x1b' : '') + key
}

function input(e) {
  if (e.scroll) {
    term.scrollLines(e.scroll)
    return flush()
  }
  // shift+PageUp/PageDown scroll the scrollback, as in most terminals
  const name = String(e.key ?? '').toLowerCase()
  if (e.shift && (name === 'pageup' || name === 'pagedown')) {
    term.scrollLines((name === 'pageup' ? -1 : 1) * Math.max(1, rows - 2))
    return flush()
  }
  const data = encode(e)
  if (!data) return
  if (term.buffer.active.viewportY !== term.buffer.active.baseY) term.scrollToBottom()
  child.write(data)
}

// ---- control channel ------------------------------------------------------

const token = randomBytes(24).toString('hex')
let lastSeen = Date.now()
const server = createServer((req, res) => {
  if (req.headers['x-trm-token'] !== token || req.method !== 'POST') {
    res.writeHead(403).end()
    return
  }
  let body = ''
  req.setEncoding('utf8')
  req.on('data', chunk => (body += chunk))
  req.on('end', () => {
    lastSeen = Date.now()
    try {
      const data = body ? JSON.parse(body) : {}
      switch (req.url) {
        case '/in':
          for (const e of Array.isArray(data) ? data : [data]) input(e)
          break
        case '/resize': {
          const c = Math.max(10, data.cols | 0), r = Math.max(3, data.rows | 0)
          if (c !== cols || r !== rows) {
            cols = c
            rows = r
            term.resize(cols, rows)
            child.resize(cols, rows)
            schedule()
          }
          break
        }
        case '/kill':
          res.writeHead(204).end()
          shutdown()
          return
        case '/ping':
          break
        default:
          res.writeHead(404).end()
          return
      }
      res.writeHead(204).end()
    } catch (error) {
      res.writeHead(400).end(String(error?.message ?? error))
    }
  })
})

function shutdown() {
  try { child.kill() } catch {}
  setTimeout(() => process.exit(0), 100)
}

// The mod pings every few seconds; if it goes away (reload, crash) so does the shell
setInterval(() => {
  if (Date.now() - lastSeen > 45000) shutdown()
}, 5000).unref()
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
process.on('SIGHUP', shutdown)

server.listen(0, '127.0.0.1', () => {
  say({ t: 'ready', port: server.address().port, token, pid: child.pid })
  schedule()
})
