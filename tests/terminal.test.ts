import { expect, mock, test } from 'claude-code/testing'

import { shellArgs, takeLines, unixShell } from '../hooks/lib'

const PANE = {
  plugin: 'terminal-mod',
  component: 'Pane',
  requestId: 'terminal-mod',
  viewport: { columns: 160, rows: 50 },
  props: {
    title: 'Terminal',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const frame = (text: string) =>
  JSON.stringify({ t: 'f', cols: 80, rows: 20, r: [[[text, 0]]], s: [{ f: '#0dbc79', B: 1 }], c: [text.length, 0], up: 0 }) + '\n'

// A stand-in for pty-host/host.mjs: says ready, draws one frame, then exits when told
function fakeHost(on: any, env: Record<string, string>) {
  const spawned: { argv: readonly string[]; cwd?: string }[] = []
  const posted: { path: string; body: any }[] = []
  let exit: () => void = () => {}

  mock.env(on, env)
  on('session.cwd', async () => ({ value: env.OS ? 'D:\\ws' : '/Users/me/ws' }))
  on('process.run', async (_$: any, e: any) => ({
    value: { exitCode: 0, stdout: e.argv.includes('command -v node') ? '/opt/homebrew/bin/node\n' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  }))
  on('process.spawn', async function* (_$: any, e: any) {
    spawned.push({ argv: e.argv, cwd: e.cwd })
    const exited = new Promise<void>(resolve => (exit = resolve))
    yield { stream: 'stdout' as const, text: '{"t":"ready","port":4321,"token":"tok"}\n' + frame('PS D:\\ws>').slice(0, 20) }
    yield { stream: 'stdout' as const, text: frame('PS D:\\ws>').slice(20) }
    await exited
    yield { stream: 'stdout' as const, text: '{"t":"exit","code":0}\n' }
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', async (_$: any, e: any) => {
    posted.push({ path: new URL(e.url).pathname, body: JSON.parse(e.init?.body ?? 'null') })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  return { spawned, posted, exit: () => exit() }
}

for (const os of ['windows', 'macos'] as const) {
  test(`${os}: a real shell starts at the pane's size, draws, takes keys in order, restarts on Enter`, async ($, on) => {
    mock.clock(on)
    const fake = fakeHost(on, os === 'windows' ? { OS: 'Windows_NT' } : { SHELL: '/bin/zsh' })

    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.resize({ columns: 80, rows: 20, in: 'term' })
    await ui.advance(50)

    expect(fake.spawned).toHaveLength(1)
    const [node, script, spec] = fake.spawned[0]!.argv
    expect(script).toMatch(/pty-host[\\/]host\.mjs$/)
    const parsed = JSON.parse(spec!)
    expect(parsed).toMatchObject({ cols: 80, rows: 20 })
    if (os === 'windows') {
      expect(node).toBe('node')
      expect(parsed).toMatchObject({ shell: 'pwsh', args: ['-NoLogo'], cwd: 'D:\\ws' })
    } else {
      expect(node).toBe('/opt/homebrew/bin/node')
      expect(parsed).toMatchObject({ shell: '/bin/zsh', args: ['-l'], cwd: '/Users/me/ws' })
    }

    // the frame reaches the Client
    await ui.advance(50)
    expect(JSON.stringify(await ui.drawn({ in: 'term' }))).toContain('PS D:\\\\ws>')

    for (const key of ['l', 's']) await ui.key({ key, in: 'term' })
    await ui.key({ key: 'c', ctrl: true, in: 'term' })
    await ui.key({ key: 'return', in: 'term' })
    await ui.advance(200)
    const sent = fake.posted.filter(p => p.path === '/in').flatMap(p => p.body)
    expect(sent).toEqual([{ key: 'l' }, { key: 's' }, { key: 'c', ctrl: true }, { key: 'return' }])

    // resending unacked keys never types them twice
    await ui.advance(400)
    expect(fake.posted.filter(p => p.path === '/in').flatMap(p => p.body)).toHaveLength(4)

    // the pane resized: the PTY follows
    await ui.resize({ columns: 60, rows: 12, in: 'term' })
    await ui.advance(50)
    expect(fake.posted.find(p => p.path === '/resize')?.body).toEqual({ cols: 60, rows: 12 })

    fake.exit()
    await ui.advance(50)
    expect(JSON.stringify(await ui.drawn({ in: 'term' }))).toContain('Press Enter')
    await ui.key({ key: 'return', in: 'term' })
    await ui.advance(50)
    expect(fake.spawned).toHaveLength(2)
    await ui.unmount()
  })
}

test('/trm opens and focuses the pane', async ($, on) => {
  const opened: string[] = []
  on('ui.open', async (_$: any, e: any) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('ui.focus', async () => ({}))
  const answer = await $.command.run({ command: 'trm', args: '' } as any)
  expect(opened).toContain('terminal-mod')
  expect(answer.text).toContain('Terminal opened')
})

test('lib: host lines split whole, the tail kept', () => {
  const { messages, rest } = takeLines('{"t":"ready","port":1,"token":"x"}\nnoise\n{"t":"exit"')
  expect(messages).toEqual([{ t: 'ready', port: 1, token: 'x' }])
  expect(rest).toBe('{"t":"exit"')
})

test('lib: shells start interactive, login shells on macOS', () => {
  expect(shellArgs('pwsh')).toEqual(['-NoLogo'])
  expect(shellArgs('C:\\Windows\\System32\\cmd.exe')).toEqual([])
  expect(shellArgs('/bin/zsh')).toEqual(['-l'])
  expect(shellArgs('/opt/homebrew/bin/fish')).toEqual(['-l'])
  expect(unixShell('/bin/zsh')).toBe('/bin/zsh')
  expect(unixShell(undefined)).toBe('/bin/sh')
})
