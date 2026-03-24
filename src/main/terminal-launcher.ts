import { execFile, execFileSync } from 'child_process'
import { existsSync } from 'fs'
import { log as _log } from './logger'

function log(msg: string): void {
  _log('TerminalLauncher', msg)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type TerminalId = 'auto' | 'terminal' | 'ghostty' | 'iterm'

export interface TerminalInfo {
  id: TerminalId
  label: string
  installed: boolean
  hasTmux?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Single-quote a string safe for POSIX shell arguments */
function sq(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

/** Escape a string for embedding inside an AppleScript double-quoted string */
function escapeAppleScript(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// ─── Detection ────────────────────────────────────────────────────────────────

const APP_PATHS: Record<Exclude<TerminalId, 'auto'>, string> = {
  ghostty: '/Applications/Ghostty.app',
  iterm:   '/Applications/iTerm.app',
  terminal: '/System/Applications/Utilities/Terminal.app',
}

function detectTmux(): boolean {
  try {
    execFileSync('which', ['tmux'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export function detectTerminals(): TerminalInfo[] {
  const hasTmux = detectTmux()
  log(`tmux available: ${hasTmux}`)

  const results: TerminalInfo[] = [
    {
      id: 'ghostty',
      label: 'Ghostty',
      installed: existsSync(APP_PATHS.ghostty),
    },
    {
      id: 'iterm',
      label: 'iTerm2',
      installed: existsSync(APP_PATHS.iterm),
      hasTmux,
    },
    {
      id: 'terminal',
      label: 'Terminal',
      installed: existsSync(APP_PATHS.terminal),
    },
  ]

  for (const t of results) {
    log(`${t.label}: installed=${t.installed}`)
  }

  return results
}

// ─── Resolution ───────────────────────────────────────────────────────────────

const AUTO_PRIORITY: Exclude<TerminalId, 'auto'>[] = ['ghostty', 'iterm', 'terminal']

export function resolveTerminal(
  preference: TerminalId,
  terminals: TerminalInfo[],
): TerminalInfo | null {
  const installed = terminals.filter(t => t.installed)

  if (preference === 'auto') {
    for (const id of AUTO_PRIORITY) {
      const found = installed.find(t => t.id === id)
      if (found) {
        log(`auto resolved to ${found.label}`)
        return found
      }
    }
    log('auto resolution: no terminal found')
    return null
  }

  const preferred = installed.find(t => t.id === preference)
  if (preferred) {
    log(`resolved to preferred: ${preferred.label}`)
    return preferred
  }

  log(`preferred terminal '${preference}' not installed`)
  return null
}

// ─── Launchers ────────────────────────────────────────────────────────────────

function launchGhostty(cmd: string, projectPath: string): void {
  // Build the shell command: cd to project then run cmd
  // /bin/zsh -lc loads login shell environment (PATH, nvm, conda, etc.)
  const shellCmd = `cd ${sq(projectPath)} && ${cmd}`
  const ghosttyCmd = `/bin/zsh -lc ${sq(shellCmd)}`
  const args = ['-na', 'Ghostty', '--args', `--command=${ghosttyCmd}`]
  log(`launching Ghostty: ${shellCmd}`)
  execFile('/usr/bin/open', args, err => {
    if (err) log(`Ghostty launch error: ${err.message}`)
  })
}

function launchITerm(cmd: string, projectPath: string, hasTmux: boolean): void {
  const shellCmd = hasTmux
    ? `tmux new-session ${sq(`cd ${sq(projectPath)} && ${cmd}`)}`
    : `cd ${sq(projectPath)} && ${cmd}`

  const escaped = escapeAppleScript(shellCmd)
  const script = [
    'tell application "iTerm2"',
    '  activate',
    '  tell current window',
    `    create tab with default profile command "${escaped}"`,
    '  end tell',
    'end tell',
  ].join('\n')

  log(`launching iTerm2 (tmux=${hasTmux}): ${shellCmd}`)
  execFile('/usr/bin/osascript', ['-e', script], err => {
    if (err) log(`iTerm2 launch error: ${err.message}`)
  })
}

function launchTerminalApp(cmd: string, projectPath: string): void {
  const shellCmd = `cd ${sq(projectPath)} && ${cmd}`
  const escaped = escapeAppleScript(shellCmd)
  const script = [
    'tell application "Terminal"',
    '  activate',
    `  do script "${escaped}"`,
    'end tell',
  ].join('\n')

  log(`launching Terminal.app: ${shellCmd}`)
  execFile('/usr/bin/osascript', ['-e', script], err => {
    if (err) log(`Terminal.app launch error: ${err.message}`)
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function launchTerminal(
  terminal: TerminalInfo,
  cmd: string,
  projectPath: string,
): void {
  log(`launchTerminal id=${terminal.id} cmd=${cmd} path=${projectPath}`)
  switch (terminal.id) {
    case 'ghostty':
      launchGhostty(cmd, projectPath)
      break
    case 'iterm':
      launchITerm(cmd, projectPath, terminal.hasTmux ?? false)
      break
    case 'terminal':
      launchTerminalApp(cmd, projectPath)
      break
    default:
      log(`unknown terminal id: ${(terminal as TerminalInfo).id}`)
  }
}
