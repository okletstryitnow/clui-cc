# Dock Auto-Hide Slide-In/Out Detection — Research Findings

**Date:** 2026-03-25
**Context:** clui-cc Electron app needs to reposition its floating window when the macOS Dock temporarily slides in during auto-hide.

## Current State in Codebase

- `src/main/index.ts` lines 1051-1067: listens to `display-metrics-changed` with `workArea` — only fires when auto-hide *setting* changes, NOT when Dock slides in/out
- Window positioned using `display.workArea` which accounts for Dock when visible
- Window is bottom-anchored with `PILL_BOTTOM_MARGIN = 24`

---

## Approach 1: NSNotificationCenter / NSApplicationDelegate

**Notifications investigated:**
- `NSApplicationDidChangeScreenParametersNotification` — fires when Dock *moves to a different edge/screen*, NOT when it slides in/out during auto-hide
- `com.apple.dock.prefchanged` (distributed notification) — fires when Dock preferences change (e.g., autohide toggled), NOT for slide events

**Verdict: NOT VIABLE** — No notification exists for Dock slide in/out.

---

## Approach 2: CGSPrivate / SkyLight / CoreDock

**CoreDock (in HIServices.framework):**
- `CoreDockGetAutoHideEnabled()` — returns whether auto-hide is ON, not whether Dock is currently visible
- `CoreDockSetAutoHideEnabled()` — can toggle auto-hide
- No function to query "is Dock currently slid in"

**CGSPrivate:**
- `CGSGetOnScreenWindowList()` — could enumerate windows but same as CGWindowListCopyWindowInfo
- No specific Dock visibility state function

**SkyLight:**
- Client-side IPC to WindowServer via Mach messages
- The Dock has "universal owner" privileges — querying its state requires either SIP disable or code injection into Dock.app
- Not practical for an Electron app

**Verdict: NOT VIABLE** for production use. Private APIs change between macOS versions, require no sandbox, and offer no advantage over CGWindowListCopyWindowInfo.

---

## Approach 3: Accessibility APIs (AXUIElement)

**Findings:**
- `hs.axuielement.applicationElement('Dock')` returns limited attributes: AXChildren, AXRole, AXTitle
- The Dock process is "special" — AXObserver often fails with `invalidObject` errors
- Items in the Dock don't have stable AXUIElements unless menus are showing
- No `AXValueChanged` or visibility notification for the Dock bar itself

**Verdict: NOT VIABLE** — Dock does not cooperate with accessibility observer pattern.

---

## Approach 4: NSEvent.addGlobalMonitorForEvents (Mouse Tracking)

**How it works:**
- Monitor `.mouseMoved` events globally
- Check if cursor is near the screen edge where Dock lives
- Infer that Dock will slide in when cursor enters the trigger zone (~4px from edge)

**Pros:**
- No special permissions needed
- Event-driven, not polling
- Can predict Dock appearance before it fully slides in

**Cons:**
- Does NOT actually detect Dock visibility — only mouse proximity
- False positives: mouse near edge doesn't always trigger Dock (e.g., when a fullscreen app is active)
- False negatives: Dock can remain visible after mouse moves away (delay before hide)
- Global monitor does NOT receive events consumed by Dock's own event tracking
- Would need to know Dock orientation (bottom/left/right) and size to define trigger zone

**Verdict: PARTIALLY VIABLE** — Could supplement another approach but unreliable alone.

---

## Approach 5: Polling (Two Sub-Approaches)

### 5a: Poll NSScreen.visibleFrame

**How it works:**
- `NSScreen.visibleFrame` DOES change when Dock slides in/out
- When auto-hidden: visibleFrame height ≈ full screen minus ~4px (tracking rect)
- When slid in: visibleFrame height = full screen minus Dock height minus menu bar
- Poll every 200-500ms via `setInterval`, compare to cached value

**In Electron:**
- `screen.getDisplayNearestPoint(cursor).workArea` maps to `NSScreen.visibleFrame`
- Could poll `screen.getPrimaryDisplay().workArea` or all displays

**Pros:**
- Uses only public APIs
- No special permissions required
- Directly measures the value used for positioning
- Works in sandboxed Electron app

**Cons:**
- Polling overhead (minor — reading workArea is cheap)
- 200-500ms latency between Dock appearing and repositioning
- Must poll ALL displays if user has multiple monitors

**CRITICAL FINDING:** Need to verify whether Electron's `screen.getDisplay*().workArea` updates in real-time when the Dock slides in, or if it's cached/snapshotted. This is the key validation step.

**Verdict: MOST VIABLE — recommended primary approach.**

### 5b: Poll CGWindowListCopyWindowInfo for Dock Window

**How it works:**
- Call `CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID)`
- Filter for `kCGWindowOwnerName == "Dock"`
- Check `kCGWindowBounds` to see if Dock window is on-screen with non-zero dimensions
- When auto-hidden, Dock window bounds will be off-screen or minimal
- When slid in, Dock window bounds will be on-screen with full dimensions

**Reference:** GitHub Gist by yeahdongcn specifically documents Dock hidden/shown window properties: https://gist.github.com/yeahdongcn/aab7c4259fc74c138a4bd1c267fccfb9

**Pros:**
- Can detect exact Dock window position and size
- Can differentiate Dock from other system windows

**Cons:**
- **Requires Screen Recording permission** (macOS 10.15+) for accurate window info from other processes
- Requires native module (node-ffi-napi or custom N-API addon)
- Heavier than visibleFrame polling
- Dock owns multiple windows — need to identify the correct one

**Verdict: VIABLE but heavy — use only if visibleFrame polling proves insufficient.**

---

## Approach 6: How Alfred/Raycast/Spotlight Handle This

**Key finding:** These apps **do not solve this problem — they avoid it entirely.**

- All three are centered vertically (or upper-third) on screen, far from the Dock
- They use `pop-up-menu` or higher window level which renders ABOVE the Dock
- Spotlight/Alfred dismiss on blur — Dock interaction would dismiss the palette anyway
- Raycast's Window Manager extension manages tiled windows but doesn't track Dock slide state

**DockAutoHide** (github.com/nshcr/DockAutoHide) is the closest real solution:
- It toggles the auto-hide *setting* based on window overlap detection
- Uses Apple Events to read/toggle auto-hide preference
- Uses CGWindowListCopyWindowInfo for overlap detection (with Screen Recording permission)
- Does NOT detect slide in/out — it prevents the problem by toggling the setting

**Verdict: No precedent exists for detecting slide in/out. Apps avoid the problem architecturally.**

---

## Approach 7: Electron-Specific APIs

**What Electron provides:**
- `screen.on('display-metrics-changed')` — does NOT fire for Dock slide in/out (confirmed in codebase)
- `screen.getDisplay*().workArea` — may or may not update in real-time during slide
- `app.dock` — only controls THIS app's dock icon, not the system Dock
- `BrowserWindow.setAlwaysOnTop(true, 'pop-up-menu')` — renders window ABOVE Dock
- No Dock visibility API in Electron

**Window Level Solution (Alternative to Detection):**
- Levels `floating` through `status`: window renders BELOW Dock
- Levels `pop-up-menu` and above: window renders ABOVE Dock
- Current code uses `screen-saver` level — this is ABOVE Dock already!

**CRITICAL INSIGHT:** The app at line 133 uses `setAlwaysOnTop(true, 'screen-saver')` which places the window ABOVE the Dock. If the Dock slides in, it should appear BEHIND the clui-cc window, not overlap it.

**If the actual problem is that workArea-based positioning pushes the window UP when Dock is considered visible:**
- The window Y coordinate uses `display.workArea` which already excludes Dock space
- If Dock slides in and workArea shrinks, the NEXT `showWindow()` call would position higher
- But the window doesn't reposition dynamically during a Dock slide-in (no listener fires)

**Verdict: The window level may already prevent visual overlap. The problem may only manifest on next showWindow() call.**

---

## Approach 8: CGWindowListCopyWindowInfo (Detailed)

See Approach 5b above. Additional details:

**Implementation in Electron would require:**
1. Native N-API module or `ffi-napi` package
2. Rebuild for Electron ABI via `electron-rebuild`
3. Screen Recording permission check via `node-mac-permissions`
4. Timer-based polling loop in main process
5. Parse CFDictionary results to find Dock window bounds

**Dock Window Identification:**
- Filter by `kCGWindowOwnerName == "Dock"`
- The main Dock bar has a specific `kCGWindowLayer` (typically layer 20 or 25)
- Check `kCGWindowIsOnscreen` and `kCGWindowBounds`
- Dock may own multiple windows (tooltips, menus, etc.)

**Verdict: Maximum accuracy but maximum complexity. Reserve as fallback.**

---

## Recommended Strategy

### Priority 1: Verify if the problem actually exists
The app uses `screen-saver` window level — the Dock should render BEHIND it. Test whether the Dock actually overlaps the window visually.

### Priority 2: If overlap is visual — use window level
Ensure `setAlwaysOnTop(true, 'pop-up-menu')` or higher. The current `screen-saver` should work.

### Priority 3: If the problem is positioning (not overlap) — poll workArea
```typescript
// Lightweight workArea polling — repositions when Dock slides in/out
let cachedWorkArea = { x: 0, y: 0, width: 0, height: 0 }

const DOCK_POLL_INTERVAL = 300 // ms

function startDockWatcher(): NodeJS.Timeout {
  return setInterval(() => {
    if (!mainWindow || !mainWindow.isVisible()) return

    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const wa = display.workArea

    if (wa.x !== cachedWorkArea.x || wa.y !== cachedWorkArea.y ||
        wa.width !== cachedWorkArea.width || wa.height !== cachedWorkArea.height) {
      cachedWorkArea = { ...wa }

      const { width: sw, height: sh } = display.workAreaSize
      const { x: dx, y: dy } = display.workArea
      mainWindow.setBounds({
        x: dx + Math.round((sw - BAR_WIDTH) / 2),
        y: dy + sh - PILL_HEIGHT - PILL_BOTTOM_MARGIN,
        width: BAR_WIDTH,
        height: PILL_HEIGHT,
      })
      log('[dock-watcher] repositioned for workArea change')
    }
  }, DOCK_POLL_INTERVAL)
}
```

### Priority 4: If workArea doesn't update during slide — use mouse proximity + delay
Combine `NSEvent.addGlobalMonitorForEvents` (via native module) with a conservative delay matching the Dock animation duration (~0.5s default, configurable via `defaults write com.apple.dock autohide-time-modifier`).

---

## Key Validation Questions

1. **Does `screen.getDisplay*().workArea` in Electron update in real-time when the Dock slides in?** (Test by logging workArea in a tight interval while triggering Dock)
2. **Does the `screen-saver` window level prevent visual overlap with the Dock?** (The Dock renders at a very high window level — it may render ABOVE even screen-saver level)
3. **Is the actual user-facing problem overlap or mis-positioning?**

## Sources

- [Apple: visibleFrame](https://developer.apple.com/documentation/appkit/nsscreen/visibleframe)
- [Apple: didChangeScreenParametersNotification](https://developer.apple.com/documentation/appkit/nsapplication/didchangescreenparametersnotification)
- [Apple: CGWindowListCopyWindowInfo](https://developer.apple.com/documentation/coregraphics/cgwindowlistcopywindowinfo(_:_:))
- [Apple: addGlobalMonitorForEvents](https://developer.apple.com/documentation/appkit/nsevent/addglobalmonitorforevents(matching:handler:))
- [MacEnhance: Controlling the Dock with CoreDock](https://www.macenhance.com/blog/2021/coredock.html)
- [CocoaDev: DockPrefsPrivate](https://cocoadev.github.io/DockPrefsPrivate/)
- [GitHub: DockAutoHide](https://github.com/nshcr/DockAutoHide)
- [GitHub: Dock hidden/shown window properties (gist)](https://gist.github.com/yeahdongcn/aab7c4259fc74c138a4bd1c267fccfb9)
- [GitHub: Get Dock position, size and hidden state (gist)](https://gist.github.com/wonderbit/c8896ff429a858021a7623f312dcdbf9)
- [jviotti: Exploring macOS Private Frameworks](https://www.jviotti.com/2023/11/20/exploring-macos-private-frameworks.html)
- [GitHub: SkyLightWindow](https://github.com/Lakr233/SkyLightWindow)
- [Electron: BrowserWindow](https://www.electronjs.org/docs/latest/api/browser-window)
- [Electron Issue #8018: Window over Dock in macOS](https://github.com/electron/electron/issues/8018)
- [SwiftUI: Detect Mouse Location & Show Auxiliary Window](https://levelup.gitconnected.com/swiftui-macos-detect-mouse-location-show-auxiliary-window-20e2acb593b0)
