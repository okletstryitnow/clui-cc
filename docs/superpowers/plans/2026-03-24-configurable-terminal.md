# Configurable Terminal for "Open in CLI" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded Ghostty "Open in CLI" with a user-configurable terminal picker (Terminal.app / Ghostty / iTerm2) that auto-detects installed terminals and persists the choice via localStorage.

**Architecture:** Terminal detection runs in the main process via IPC (`DETECT_TERMINALS`). The renderer stores the user's choice in the existing `useThemeStore` (which manages all persistent settings via `clui-settings` localStorage key). The `OPEN_IN_TERMINAL` handler reads the preference and dispatches to the correct terminal launcher. A new row in `SettingsPopover` lets users pick their terminal.

**Tech Stack:** Electron IPC, Zustand (useThemeStore), React, existing Clui CC design patterns

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/main/terminal-launcher.ts` | CREATE | Terminal detection + per-terminal launch logic |
| `src/main/index.ts` | MODIFY | Wire new IPC handlers, refactor OPEN_IN_TERMINAL to use launcher |
| `src/shared/types.ts` | MODIFY | Add IPC channel constants + TerminalId type |
| `src/preload/index.ts` | MODIFY | Expose `detectTerminals()` API method |
| `src/renderer/theme.ts` | MODIFY | Add `terminalApp` to settings store + persistence |
| `src/renderer/components/SettingsPopover.tsx` | MODIFY | Add terminal picker row |
| `src/renderer/components/StatusBar.tsx` | MODIFY | Remove hardcoded Ghostty tooltip, use dynamic label |

---

### Task 1: Terminal Launcher Module (Main Process)

**Files:**
- Create: `src/main/terminal-launcher.ts`

- [ ] **Step 1: Create terminal-launcher.ts with detection and launch logic**

Uses `existsSync` for app detection, `execFileSync` for tmux check (no shell injection).
Each terminal has its own launch function using `execFile` (not `exec`).
AppleScript strings for iTerm2/Terminal.app use proper escaping.
Ghostty uses `open -na` with `--command=` (single argument, no splitting).

Key functions:
- `detectTerminals()` — returns array of `{ id, label, installed, hasTmux? }`
- `resolveTerminal(preference, terminals)` — auto-priority: Ghostty > iTerm2 > Terminal.app
- `launchTerminal(terminal, cmd, projectPath)` — dispatches to correct launcher

- [ ] **Step 2: Commit**

```bash
git add src/main/terminal-launcher.ts
git commit -m "feat: add terminal detection and launcher module"
```

---

### Task 2: IPC Wiring + Types

**Files:**
- Modify: `src/shared/types.ts` — add `DETECT_TERMINALS` IPC channel + `TerminalId` type
- Modify: `src/preload/index.ts` — expose `detectTerminals()` in CluiAPI
- Modify: `src/main/index.ts` — add handler, refactor OPEN_IN_TERMINAL to use launcher

Key changes:
- `OPEN_IN_TERMINAL` arg type gets optional `terminal?: TerminalId`
- Handler calls `resolveTerminal()` then `launchTerminal()`
- Old shellSingleQuote/Ghostty code removed from index.ts (now in terminal-launcher.ts)

- [ ] **Step 1: Add types and IPC channel**
- [ ] **Step 2: Add preload bridge method**
- [ ] **Step 3: Add DETECT_TERMINALS handler in main**
- [ ] **Step 4: Refactor OPEN_IN_TERMINAL to use terminal-launcher**
- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/preload/index.ts src/main/index.ts
git commit -m "feat: wire terminal detection IPC and refactor launcher dispatch"
```

---

### Task 3: Settings Persistence (Theme Store)

**Files:**
- Modify: `src/renderer/theme.ts`

- [ ] **Step 1: Add `terminalApp: TerminalId` to ThemeState + loadSettings/saveSettings**

Default: `'auto'`. Validated against `['auto', 'terminal', 'ghostty', 'iterm']` on load.
Follows exact same pattern as `themeMode`, `soundEnabled`, `expandedUI`.

- [ ] **Step 2: Add `setTerminalApp` action to store**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/theme.ts
git commit -m "feat: add terminalApp to persistent settings store"
```

---

### Task 4: Settings Popover UI

**Files:**
- Modify: `src/renderer/components/SettingsPopover.tsx`

- [ ] **Step 1: Add TerminalPicker component (inline, same file)**

Follows existing SettingsPopover patterns:
- Row with Terminal icon + label + current value button
- Click opens inline option list (like model picker, not a separate popover)
- Only shows installed terminals
- "Auto" option shows detected best terminal in parentheses
- iTerm2 shows "(tmux)" suffix if tmux is available
- Check icon on selected option
- Uses `useThemeStore` for state, `window.clui.detectTerminals()` for installed list

- [ ] **Step 2: Add separator + TerminalPicker row after "Dark theme" section**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/SettingsPopover.tsx
git commit -m "feat: add terminal picker to settings popover"
```

---

### Task 5: Wire StatusBar to Pass Preference

**Files:**
- Modify: `src/renderer/components/StatusBar.tsx`

- [ ] **Step 1: Read terminalApp from useThemeStore, pass to openInTerminal**

```tsx
const terminalApp = useThemeStore((s) => s.terminalApp)
window.clui.openInTerminal(tab.claudeSessionId, tab.workingDirectory, terminalApp)
```

- [ ] **Step 2: Dynamic tooltip based on preference**
- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/StatusBar.tsx
git commit -m "feat: pass terminal preference from StatusBar to launcher"
```

---

### Task 6: Build + End-to-End Test

- [ ] **Step 1: Verify build**

```bash
npm run build
```

Expected: zero errors.

- [ ] **Step 2: Production build + install**

```bash
npm run dist
pkill -f "Clui CC" 2>/dev/null; sleep 2
rm -rf "/Applications/Clui CC.app"
cp -R "release/mac-arm64/Clui CC.app" "/Applications/Clui CC.app"
open "/Applications/Clui CC.app"
```

- [ ] **Step 3: Test auto-detect** — Settings > Terminal shows "Auto (Ghostty)"
- [ ] **Step 4: Test each terminal** — Switch in settings, click "Open in CLI", verify correct terminal opens
- [ ] **Step 5: Test persistence** — Quit, relaunch, setting preserved
- [ ] **Step 6: Test session resume** — Start session, click "Open in CLI", verify `--resume` in log
