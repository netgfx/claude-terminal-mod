export const isPwsh = (shell: string) => /(^|[\/])(pwsh|powershell)(\.exe)?$/i.test(shell)

/** Arguments for an interactive shell: a login shell on macOS/Linux so PATH matches Terminal.app. */
export function shellArgs(shell: string): string[] {
  if (isPwsh(shell)) return ['-NoLogo']
  if (/(^|[\/])(cmd)(\.exe)?$/i.test(shell)) return []
  if (/(^|[\/])(bash|zsh|sh|dash|ksh|mksh|ash|fish)(\.exe)?$/i.test(shell)) return ['-l']
  return []
}

/** macOS and Linux: the login shell, else /bin/sh. */
export const unixShell = (login: string | undefined) => (login && login.trim() ? login.trim() : '/bin/sh')

export type HostMessage =
  | { t: 'ready'; port: number; token: string; pid?: number }
  | ({ t: 'f' } & import('../types').Frame)
  | { t: 'exit'; code: number }
  | { t: 'error'; message: string }
  | { t: 'status'; message: string }

/** Splits the host's stdout into whole JSON lines, keeping the unfinished tail. */
export function takeLines(buffer: string): { messages: HostMessage[]; rest: string } {
  const messages: HostMessage[] = []
  let rest = buffer
  let at: number
  while ((at = rest.indexOf('\n')) !== -1) {
    const line = rest.slice(0, at).trim()
    rest = rest.slice(at + 1)
    if (!line) continue
    try {
      messages.push(JSON.parse(line) as HostMessage)
    } catch {
      // not ours (a stray console line): skip it
    }
  }
  return { messages, rest }
}
