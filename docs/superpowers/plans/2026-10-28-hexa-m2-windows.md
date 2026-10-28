# Hexa M2 (Window Awareness) Implementation Plan

> **For agentic workers:** executed inline (superpowers:executing-plans), test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Hexa knows where your windows are (X11 first, Plasma Wayland through a KWin script):
- she sits on window edges and rides along with them
- she falls off when a window closes, is minimised or is covered
- she possesses windows
- she finds Claude's own window through the hook's process tree
- she shows Claude's answer when you are elsewhere, and points at Claude's window during a permission prompt
- she guides you around, follows you across screens, and can be thrown.

**Architecture:**
- A main-process window tracker emits snapshots `{ fg, wins }` (front first, display DIP, only windows on the current desktop and on her display) to the renderer as `windows:update`.
- The main process resolves each hook event's `ppid` to a window by walking `/proc` and attaches `window_id`.
- The renderer ports upstream v0.4.3's seat, pointing and possession rules (MIT) to Hexa's rig; the art and lines are Hexa's.

**Tech:** `x11` 4.3.1 (already a dependency), `dbus-next` 0.10.2 (KWin backend), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-hexa-design.md` §6.3–6.5, §7.5 (On her own, Showing you around). Upstream reference: `v0.4.3:src/renderer/js/capri.js` (`setWindows`, `seat`, `canSit`, `covered`, `pickSeat`, `goToWork`, `possess`, `aimPoint`, `spotNear`, `pointAt`, `stopPointing`, `canPoint`, `summon`), `guide.js`, `brain.js` (`away`, `onWindows`, `onNotification`, `onStop`).

## Global constraints
- Same as M1 (see its plan).
- Window titles are read **only** for the window in front, **only** to match the AI-name list (M4 jealousy). They're never stored or sent; in M2 they aren't read at all.
- Possession never draws over windows that are in front of the possessed one, and never reads window contents.
- Every snapshot is filtered to her display and the current desktop.
- Docks, desktop, menus, tooltips, notifications and her own window are skipped.

## Review Focus
1. **Window closed, minimised or moved to another desktop while she sits on it:** she falls (never floats in mid-air) within one snapshot.
2. **A window with client-side decorations:** GTK draws its shadows inside its own window, so `_GTK_FRAME_EXTENTS` must be subtracted or she sits on the shadow, not the title bar.
3. **Rapid window drags (60+ ConfigureNotify per second):** snapshots are coalesced at no more than 30 per second, with no backlog and no CPU spike.
4. **The process tree ends at systemd or init, or reaches a PID with no window** (the desktop app's own Code tab): fall back to the window in front at prompt time.
5. **A monitor removed while she sits on a window on it:** the snapshot drops it and she falls on the remaining display.

## Tasks

### Task 1: Pure window geometry
`src/main/platform/linux/window-model.js`, tested by `tests/window-model.test.js`.
- `frameRect(client, frameExtents, gtkExtents) → { x, y, w, h }`
- `isTrackable({ types, states, desktop, currentDesktop, self })`: skips the types DOCK, DESKTOP, MENU, DROPDOWN_MENU, POPUP_MENU, TOOLTIP, NOTIFICATION, SPLASH; skips the states HIDDEN; requires desktop to match or be all (0xFFFFFFFF); skips self
- `toSnapshot(list, { display, scale, fg })` → `{ fg, wins }`, front first, DIP, display-relative, keeping only what overlaps the display; `max` set when the window is maximised or fullscreen.
- Tests: CSD shadow subtracted; a minimised window dropped; another desktop dropped; order front first; DIP division at scale 1.5.

### Task 2: X11 tracker
`src/main/platform/linux/windows-x11.js`, tested by `tests/windows-x11.test.js` (live, skipped without `DISPLAY`).
- `startX11Windows({ x11, selfXid, getDisplay, onUpdate }) → { stop(), refresh(), snapshot() }`
- Reads `_NET_CLIENT_LIST_STACKING`, `_NET_ACTIVE_WINDOW` and `_NET_CURRENT_DESKTOP` on the root, and per window `_NET_WM_WINDOW_TYPE`, `_NET_WM_STATE`, `_NET_WM_DESKTOP`, `_NET_FRAME_EXTENTS`, `_GTK_FRAME_EXTENTS`, `_NET_WM_PID` and `WM_CLASS`, plus the geometry through `TranslateCoordinates`.
- Live: `PropertyNotify` on the root, and `StructureNotify` plus `PropertyNotify` on each client, coalesced to 33 ms.
- Live test: create a managed 240×140 window, wait for it to appear in a snapshot with the right geometry, move it, see the move, destroy it, see it gone.

### Task 3: Claude's window by process tree
`src/main/platform/linux/proc.js`, tested by `tests/proc.test.js` (fixtures under `tests/fixtures/proc/`).
- `parentChain(pid, { root = '/proc', max = 32 })`: reads the 4th field of `/proc/<pid>/stat` after the `)`.
- `windowForChain(chain, wins)`: the first window whose `pid` is in the chain.
- In `main.js`, each event gets `window_id` when it resolves.

### Task 4: Wiring snapshots into Hexa and the Brain
- `main.js` starts the tracker once the overlay exists, sends `windows:update`, and gives `/debug/state` the last snapshot.
- `app.js` passes it to `hexa.setWindows(snap)` and `brain.onWindows(snap)`.
- The Brain takes `s.window` from `evt.window_id` (else `fg` at the prompt).
- `away(s)`: `fg` is not `s.window`.
- `onStop`: when away, the whole reply goes in the panel (`reply`, hold `null`) and clears when you're back on Claude's window or click it.

### Task 5: Sitting and riding (ported rules)
- `hexa.js`: `setWindows`, `seat`, `canSit`, `covered`, `pickSeat`, `sitOn`; `goToWork` perches on the front window when it can.
- Dropping her with her hips within 24 px of a window's top edge makes her sit there.
- A fall passing a window top within her x range is caught by the ledge.
- Ride along when the window moves; fall when it's gone, maximised or covered.
- Hexa's seat: `pos.y = win.y + 66 * scale` (her hips on the edge, thighs folded).
- Tests: ride; fall on close, minimise and cover; drop onto a ledge; caught mid-fall; `pickSeat` prefers the front window.

### Task 6: Possession (ported rules, Hexa's look)
- `fx.possess(rect, { covers, look })` draws over the window minus whatever covers it:
  - its frame lit cyan
  - a hex grid sweeping across it
  - glitch slices
  - her visor glyph big across it, with dot-matrix eyes opening that follow the pointer
- It lasts 1.9 s, then she leaves from another window or further along this one.
- `visibleParts(rect, covers)` is pure and tested.
- Possession runs only when sitting, with `possess` on in her settings and full motion. The menu gets *Possess my windows*.

### Task 7: Pointing at things
- Acts `point` (head snap, coil, strike, `lock` cue) and `unpoint`.
- `fx.pointer(from, rect, label)`: a dashed data wire, corner brackets, a tag; it retracts on stop.
- Ported `aimPoint`, `spotNear`, `pointAt`, `stopPointing`, `canPoint`.
- The Brain's permission prompt, when you're away, points at Claude's window labelled `CLAUDE`.
- Tests: `spotNear` stays on screen and beside the rect; `canPoint` refuses maximised or covered windows.

### Task 8: The guide
- `src/renderer/js/guide.js`: *How does it work?* from her menu. The panel gains `buttons` (`[{ id, label, primary }]` and `onAction`).
- Topics:
  - **Where's Claude:** point at its window.
  - **Claude's folder:** `shell.showItemInFolder(~/.claude/settings.json)`, then point at the file manager window that opens.
  - **Where's my icon:** the panel's tray area; the bottom-right on KDE's default panel, or the top-right when the work area starts lower than the display.
  - **Plug me into Claude:** install the hooks, with the restart note.
- First start shows the welcome with a **Plug me in** button.
- Tests: the flow's state machine with stubbed host calls.

### Task 9: Multiple screens and throwing (rebuilt from the spec, not upstream code)
- **Screens:** the tray gets a *Screen* submenu and *Follow me across screens*. When the pointer stays 3 s on another display, the overlay moves there: she jumps through a shared edge (`sharedEdge(a, b)` is pure) or teleports. Alerts bring her to the pointer's display.
- **Throwing:** the drag keeps a 100 ms velocity window. Released faster than 900 px/s, she flies:
  - gravity applies
  - a screen edge crashes her: stuck 400 ms, a glass crack, then a bounce
  - a window top edge catches her, or she bounces and the window shakes (drawn only)
  - landing upright she skids; otherwise she slides, then gets up
  - she can be caught mid-air
  - three throws within 20 s make her mad (zap, then no pickup for 15 s).
- `flightStep(state, dt, area, ledges)` is pure.
- Tests: flight physics, crash and bounce, the ledge catch, the mad counter.

### Task 10: KWin backend (Plasma Wayland)
- `src/main/platform/linux/kwin.js` plus `kwin-script/main.js`. The app exports `io.github.hexa.Windows` on the session bus (`dbus-next`) and loads the script through `org.kde.KWin /Scripting loadScript/start`. The script sends the stacking order as JSON on every window change.
- Selected when `WAYLAND_DISPLAY` is set and `XDG_CURRENT_DESKTOP` contains KDE; X11 is used otherwise.
- Tests: the snapshot parser; `node --check` on the script.

### Task 11: Verification
- With Konsole and Dolphin open: she perches on the front window while Claude works, rides along when it's dragged, falls when it's closed, and possesses it.
- The guide points at Claude's window.
- The demo still runs.
- Click routing passes.
- The notes and the merge.
