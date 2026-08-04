# Grok Desk — Computer Use: Full Engineering Specification

**Date:** 2026-07-11  
**Status:** Approved — complete feature definition (single delivery, not a research preview)  
**Product:** Grok Desk  
**Related:**
- [Grok Desk product design](./2026-07-10-grok-desk-design.md) (prior non-goal superseded for this capability)
- [Agent browser + subagent HUD](./2026-07-11-agent-browser-subagent-hud-design.md) (coexists; not replaced)

This document is the **single source of truth** for implementing computer use end-to-end. An implementer should be able to ship the **entire** feature from this file without waiting on further product design. Partial ship (screenshot-only, Mac-only GA) is **not** acceptable for the feature flag.

---

## 0. One-liner and scope of delivery

**One-liner:** Grok Desk captures the user’s screen and drives mouse/keyboard on macOS and Windows so the agent can operate any visible app, behind a Permissions tab, per-task grant, exclusive bursts, yield-to-user, rate limits, and full audit.

**Delivery definition (DONE when all of the following are true):**

1. Machine master switch + OS permission probes work on Mac and Windows.
2. Per-task **Allow desktop control** gates tool availability.
3. Full tool set is live: screenshot, mouse_move, click, double_click, drag, type, key, scroll, wait, open_app, list_displays.
4. Engine can invoke tools via desk-hosted MCP (mirror of desk-browser).
5. Exclusive control bursts + yield on real user input + Pause all.
6. Permissions tab, task toggle, HUD strip, tray “Desktop active”, stream tool chips + screenshots.
7. Coord mapping correct for Retina/DPI and multi-display selection.
8. Policy, rate limits, deny heuristics, audit records.
9. Unit + adapter + gateway + renderer tests; dual-OS smoke criteria met.
10. Skills/preamble tell the model when to use `desktop.*` vs `browser.*`.

---

## 1. Product decisions (locked)

| Decision | Choice |
|----------|--------|
| Capability | Real desktop GUI control (Claude/Codex-class) |
| Technique | Pure pixel loop (screenshot + synthetic input) |
| Cursor model | Shared system pointer; exclusive short bursts; agent overlay; yield to user |
| Platforms | **macOS and Windows required for feature GA** |
| Success bar | Use any app (vision + coords), not a fixed app matrix |
| Safety UX | Settings → Permissions + OS grants + task grant + pause/yield |
| Tool prefix | `desktop.*` (MCP) / `desktop_*` (internal host tool ids) |
| Coexistence | Keep `browser.*` for sandboxed in-app web |

### Explicit non-goals (this delivery)

- Virtual display / dedicated Space as isolation
- True dual independent cursors
- AX / UI Automation as primary control path
- Mobile remote dispatch
- Per-click approval modals
- Replacing shell/fs tools

---

## 2. Architecture

### 2.1 Data path

```
Grok Build engine
  └─ MCP tools/call (desktop-mcp-server.mjs)
       └─ HTTP POST → local DesktopHostServer (main)
            └─ DesktopPolicyStore.authorize
            └─ DesktopUseService.exec
                 └─ MacDesktopAdapter | WinDesktopAdapter

Gateway (optional host_call path, parallel to browser)
  └─ HostBridge.desktopExec / desktopConfigure / desktopDestroy
       └─ same DesktopUseService (main host_call handler)
```

**Primary engine path:** local MCP (same pattern as `browser-mcp-server.mjs` + `browser-host-server.ts`).  
**Secondary path:** gateway `host_call` for lifecycle (`configure`, `destroy`, pause integration) and any future non-MCP routing.

Renderer never performs capture or input. It only toggles grants, shows HUD, and displays status/screenshots already in the task stream.

### 2.2 Component ownership

| Component | Package / path | Responsibility |
|-----------|----------------|----------------|
| Pure types + policy helpers | `packages/shared` | Zod/types, coord math pure fns, deny list pure fns, error codes |
| Host bridge | `packages/gateway/src/host-bridge.ts` | `desktopExec`, `desktopConfigure`, `desktopStatus`, `desktopDestroy` |
| Gateway inject MCP | `packages/gateway/src/index.ts` | Prepend desk-desktop MCP when env set (mirror desk-browser) |
| Runner lifecycle | `packages/gateway/src/services/runner.ts` | configure on task start; destroy on end/cancel; pause rejects |
| DesktopUseService | `apps/desktop/src/main/desktop-use-service.ts` | Orchestrate capture/input/exclusive/yield |
| Adapters | `apps/desktop/src/main/desktop/{mac,win}-adapter.ts` | OS APIs |
| Policy store | `apps/desktop/src/main/desktop-policy-store.ts` | Master + task grant + budgets + denylist gate |
| Host HTTP | `apps/desktop/src/main/desktop-host-server.ts` | Localhost MCP backend |
| MCP server | `apps/desktop/resources/desktop-mcp-server.mjs` | Engine-facing tools/list + tools/call |
| IPC | main + preload + renderer | Permissions status, task grant, HUD events |
| UI | renderer | Permissions tab, task toggle, HUD |
| Skills | `skills/desk-defaults/SKILL.md` | When to use desktop vs browser |

### 2.3 Session identity

- Use **thread root task id** for desktop session (same as browser: `tasks.threadRootId(taskId)`).
- Follow-ups and children share one desktop control grant for the chat root unless product later splits grants.
- Field name: `desktopSessionId` on runner (parallel to `browserSessionId`).

---

## 3. Shared contracts

### 3.1 Tool names

| MCP name | Internal host tool id |
|----------|----------------------|
| `desktop.screenshot` | `desktop_screenshot` |
| `desktop.mouse_move` | `desktop_mouse_move` |
| `desktop.click` | `desktop_click` |
| `desktop.double_click` | `desktop_double_click` |
| `desktop.drag` | `desktop_drag` |
| `desktop.type` | `desktop_type` |
| `desktop.key` | `desktop_key` |
| `desktop.scroll` | `desktop_scroll` |
| `desktop.wait` | `desktop_wait` |
| `desktop.open_app` | `desktop_open_app` |
| `desktop.list_displays` | `desktop_list_displays` |

Conversion: dots → underscores (same as browser MCP).

### 3.2 TypeScript types (`packages/shared/src/desktop-types.ts`)

```ts
export type DesktopTool =
  | "desktop_screenshot"
  | "desktop_mouse_move"
  | "desktop_click"
  | "desktop_double_click"
  | "desktop_drag"
  | "desktop_type"
  | "desktop_key"
  | "desktop_scroll"
  | "desktop_wait"
  | "desktop_open_app"
  | "desktop_list_displays";

export type DesktopErrorCode =
  | "desktop_disabled_machine"
  | "desktop_disabled_task"
  | "desktop_paused"
  | "desktop_permission_capture"
  | "desktop_permission_input"
  | "desktop_yielded"
  | "desktop_rate_limited"
  | "desktop_denied_target"
  | "desktop_invalid_args"
  | "desktop_display_not_found"
  | "desktop_capture_failed"
  | "desktop_input_failed"
  | "desktop_open_app_failed"
  | "desktop_not_supported";

export interface DesktopDisplayInfo {
  id: string;
  label: string;
  width: number;       // device pixels
  height: number;
  scaleFactor: number;
  bounds: { x: number; y: number; width: number; height: number }; // DIP or device — adapters document; service normalizes to device
  isPrimary: boolean;
}

export interface DesktopExecArgs {
  taskId: string;
  tool: DesktopTool;
  args: Record<string, unknown>;
}

export interface DesktopExecResult {
  ok: boolean;
  output: string;
  code?: DesktopErrorCode;
  /** PNG or JPEG as data URL for model + stream */
  screenshot?: string;
  /** Image space dimensions returned with screenshot */
  width?: number;
  height?: number;
  displayId?: string;
  scaleFactor?: number;
  /** Image-space → device-pixel scale applied by service */
  imageToDeviceScale?: number;
  displays?: DesktopDisplayInfo[];
  frontmostApp?: string | null;
  frontmostWindowTitle?: string | null;
}

export interface DesktopMachineSettings {
  /** Master switch — default false */
  enabled: boolean;
  /** Preferred display id; null = primary */
  defaultDisplayId: string | null;
  /** Max actions per rolling 60s window — default 60 */
  maxActionsPerMinute: number;
  /** Max actions per task lifetime — default 2000 */
  maxActionsPerTask: number;
  /** Screenshot long-edge max px for model — default 1280 */
  maxScreenshotLongEdge: number;
  /** JPEG quality 0–100 if using jpeg — default 75; PNG if quality omitted and format png */
  screenshotFormat: "png" | "jpeg";
  screenshotJpegQuality: number;
}

export interface DesktopTaskState {
  taskId: string; // thread root
  granted: boolean;
  displayId: string | null;
  actionCount: number;
  windowStartedAt: number;
  windowActionCount: number;
  softPaused: boolean; // after yield until user resumes grant or explicit resume
}

export interface DesktopPermissionStatus {
  captureGranted: boolean;
  inputGranted: boolean;
  /** Platform notes for UI */
  captureDetail: string;
  inputDetail: string;
  platform: "darwin" | "win32" | "other";
}

export interface DesktopStatusEvent {
  taskId: string;
  active: boolean;
  exclusive: boolean;
  softPaused: boolean;
  lastAction: string | null;
  lastError: string | null;
  lastScreenshotDataUrl: string | null;
  frontmostApp: string | null;
  displayId: string | null;
  updatedAt: string; // ISO
}

export const DEFAULT_DESKTOP_MACHINE_SETTINGS: DesktopMachineSettings = {
  enabled: false,
  defaultDisplayId: null,
  maxActionsPerMinute: 60,
  maxActionsPerTask: 2000,
  maxScreenshotLongEdge: 1280,
  screenshotFormat: "jpeg",
  screenshotJpegQuality: 75,
};
```

### 3.3 Tool argument schemas (Zod — `packages/shared/src/desktop-tool-schemas.ts`)

All coordinates are **integers in screenshot image space** unless noted.

| Tool | Args | Required |
|------|------|----------|
| `desktop_screenshot` | `displayId?: string` | — |
| `desktop_mouse_move` | `x: number`, `y: number` | x, y |
| `desktop_click` | `x`, `y`, `button?: "left"\|"right"\|"middle"`, `count?: number` (1–3) | x, y |
| `desktop_double_click` | `x`, `y` | x, y |
| `desktop_drag` | `x1`, `y1`, `x2`, `y2`, `durationMs?: number` (0–5000, default 300) | x1,y1,x2,y2 |
| `desktop_type` | `text: string` (max 8000 chars) | text |
| `desktop_key` | `key: string`, `modifiers?: string[]` | key |
| `desktop_scroll` | `x`, `y`, `dx?: number`, `dy?: number` | x, y; at least one of dx/dy |
| `desktop_wait` | `ms: number` (0–30000, default 500, clamp 30000) | — |
| `desktop_open_app` | `name?: string`, `path?: string` | name or path |
| `desktop_list_displays` | `{}` | — |

**Key names:** normalize to a closed set where possible:

`enter`, `return`, `tab`, `escape`, `esc`, `backspace`, `delete`, `space`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `f1`–`f12`, and single printable characters.

**Modifiers:** `cmd`/`meta`, `ctrl`, `alt`/`option`, `shift`. On Windows map `cmd`→`ctrl` only if explicitly configured; default: `cmd` is macOS Command, Windows Control is `ctrl` only (do not silently remap — document in tool description).

### 3.4 Exec result conventions

- `ok: true` → `output` short human summary (`"clicked (412, 220)"`, `"typed 14 chars"`).
- `ok: false` → `code` set + `output` user/agent-readable recovery text.
- Screenshots: `data:image/jpeg;base64,...` preferred for size; PNG allowed.
- Always attach `width`/`height` (image space) with screenshots so the model knows the coordinate grid.

### 3.5 HostBridge API

Extend `HostBridge` / `NullHostBridge` / `StdioHostBridge`:

```ts
desktopExec(req: DesktopExecArgs): Promise<DesktopExecResult>;
desktopConfigure(req: {
  taskId: string;
  granted: boolean;
  displayId?: string | null;
  machine: DesktopMachineSettings;
}): Promise<void>;
desktopGetStatus(taskId: string): Promise<DesktopStatusEvent | null>;
desktopDestroy(taskId: string): Promise<void>;
desktopPermissions(): Promise<DesktopPermissionStatus>;
```

Host call method strings:

| Method | Params |
|--------|--------|
| `desktop.exec` | DesktopExecArgs |
| `desktop.configure` | configure req |
| `desktop.status` | `{ taskId }` |
| `desktop.destroy` | `{ taskId }` |
| `desktop.permissions` | `{}` |

### 3.6 Settings persistence

Add to app settings (SQLite / existing settings service), not only in-memory:

```ts
// On AppSettings (or nested)
desktopControl: DesktopMachineSettings;
```

Wire through:

- `packages/shared/src/settings-schema.ts` — settable key `desktopControl` with nested schema
- Gateway settings get/set
- Renderer Settings → Permissions binds to this object

**Defaults:** all of `DEFAULT_DESKTOP_MACHINE_SETTINGS` (`enabled: false`).

### 3.7 Task grant persistence

Store per thread-root task:

| Store | Key | Value |
|-------|-----|--------|
| Gateway DB or main policy store | `desktop_grant:{threadRootId}` | `{ granted: boolean, displayId: string \| null, softPaused: boolean }` |

**Default:** `granted: false`.  
Survive app restart for active/incomplete tasks; clear grant when task thread is deleted.

IPC for renderer:

| Method | Params | Result |
|--------|--------|--------|
| `desktop.permissions.get` | `{}` | `DesktopPermissionStatus` + `DesktopMachineSettings` |
| `desktop.permissions.openCaptureSettings` | `{}` | opens OS UI |
| `desktop.permissions.openInputSettings` | `{}` | opens OS UI |
| `desktop.machine.set` | `Partial<DesktopMachineSettings>` | updated settings |
| `desktop.task.getGrant` | `{ taskId }` | `{ granted, displayId, softPaused }` |
| `desktop.task.setGrant` | `{ taskId, granted, displayId? }` | ok |
| `desktop.task.resume` | `{ taskId }` | clears softPaused |

Events (main → renderer):

| Channel | Payload |
|---------|---------|
| `grokdesk:desktop:status` | `DesktopStatusEvent` |

---

## 4. Policy engine

### 4.1 Authorize algorithm (`DesktopPolicyStore.authorize`)

Run **before** every `exec` (MCP host and host_call):

```
1. If platform not darwin|win32 → fail desktop_not_supported
2. If !machine.enabled → fail desktop_disabled_machine
3. If !taskState.granted → fail desktop_disabled_task
4. If global pause (tasks.isPaused / desktop global) → fail desktop_paused
5. If taskState.softPaused && tool != desktop_screenshot && tool != desktop_list_displays
     → fail desktop_yielded (message: user took control; enable Resume)
6. Probe permissions:
   - Any input tool needs inputGranted else desktop_permission_input
   - screenshot/list_displays need captureGranted else desktop_permission_capture
7. Rate limits:
   - if actionCount >= maxActionsPerTask → desktop_rate_limited
   - rolling 60s window: if windowActionCount >= maxActionsPerMinute → desktop_rate_limited
   - wait and list_displays and screenshot still count toward budgets (prevent screenshot spam)
8. Validate args with Zod → desktop_invalid_args
9. Deny heuristics (see 4.2) for input tools → desktop_denied_target if hard block
10. Increment counters; return ok
```

### 4.2 Deny / caution heuristics (v1)

Best-effort using frontmost process name + window title when adapters can supply them **before** input (optional pre-check). If unavailable, skip (do not block entire feature).

**Hard block process name substrings (case-insensitive):**

```
1password, onepassword, bitwarden, lastpass, dashlane, keeper, keepass,
keychain access, credential manager
```

**Hard-confirm not used in v1** (no modal per action). Instead: hard block denylist with clear `output` text telling the agent to ask the user to complete the sensitive step manually.

**Caution (log only, do not block):** window titles containing `password`, `sign in`, `login` — still allow; audit `caution: possible auth UI`.

### 4.3 First-enable consent (UI only)

When user flips machine master **off → on**:

- Modal or inline confirm:  
  **“Desktop control lets Grok Desk move the mouse and type on this computer. Only enable for tasks you trust. You can pause anytime from the tray.”**  
  Buttons: Cancel / Enable

When user flips task grant **off → on**:

- If OS permissions incomplete → block enable, show recovery.  
- Else short inline note (non-blocking toast): “Desktop control on for this chat. Pause or move the mouse to interrupt.”

### 4.4 Pause integration

- `tasks.pauseAll` → desktop policy global paused; in-flight exclusive burst aborted; new exec fails `desktop_paused`.
- `tasks.resumeAll` → clear global pause; does **not** clear softPaused (user must Resume desktop on task).
- Task cancel / delete thread → `desktopDestroy`.

### 4.5 Yield-to-user

During exclusive burst:

- Listen for real hardware mouse move / key (adapters).
- Ignore synthetic events from our own injection (tag or time window: ignore events within 16ms of our inject if OS cannot distinguish).
- On real user input:  
  1. Abort remaining inject for this tool  
  2. Set `softPaused = true`  
  3. Emit status + stream event `desktop_yielded`  
  4. Return `ok: false, code: desktop_yielded`

User resumes via task HUD **Resume desktop** → `desktop.task.resume`.

---

## 5. Coordinate and capture system

### 5.1 Screenshot pipeline

1. Resolve `displayId` = args.displayId ?? task.displayId ?? machine.defaultDisplayId ?? primary.
2. Adapter captures full display bitmap in **device pixels**.
3. Service records `deviceWidth`, `deviceHeight`, `scaleFactor`, display `bounds`.
4. Downscale so `max(deviceWidth, deviceHeight)` maps to `maxScreenshotLongEdge` (keep aspect ratio).  
   `imageToDeviceScale = deviceLongEdge / imageLongEdge`.
5. Encode JPEG/PNG → data URL.
6. Return image space `width`/`height` and `imageToDeviceScale`.

**Model instruction (tool description):**  
“Coordinates are relative to the last screenshot’s width/height (origin top-left). Call desktop.screenshot after UI changes before clicking.”

### 5.2 Image → device → screen mapping

```
deviceX = round(imageX * imageToDeviceScale)
deviceY = round(imageY * imageToDeviceScale)
// Clamp to [0, deviceWidth-1] x [0, deviceHeight-1]
screenX = display.bounds.x + deviceX
screenY = display.bounds.y + deviceY
```

Adapters accept **global screen coordinates** in the coordinate system expected by the OS input API (document per OS in adapter).

### 5.3 Multi-display

- `desktop.list_displays` returns all displays with ids and labels (`"Built-in Retina"`, `"Display 2"`).
- Task grant UI: optional display picker (default primary).
- Clicking on wrong display fails soft if coords map off-display after clamp — still inject clamped point; agent should re-screenshot.

### 5.4 Performance budgets

| Operation | Target |
|-----------|--------|
| Screenshot capture+encode | < 500ms typical |
| Click / key | < 100ms inject |
| Type 100 chars | < 2s (small per-char delay 5–15ms to avoid drop) |
| Tool timeout (host) | 30s (except wait up to 30s) |

---

## 6. DesktopUseService

### 6.1 Responsibilities

- Hold last capture metadata per taskId (for coord map without re-capture).
- If model clicks without a prior screenshot in this session, auto-capture once then map (or fail `desktop_invalid_args` with “screenshot first” — **prefer auto-capture** for robustness).
- Exclusive burst:
  - `beginExclusive(taskId)` → set status exclusive=true, show overlay
  - perform action
  - `endExclusive()` always in finally
- Emit `DesktopStatusEvent` on start/end/error/yield.
- Call policy store first; never bypass.

### 6.2 Per-tool behavior

| Tool | Behavior |
|------|----------|
| screenshot | capture; update last metadata; return image; set lastScreenshot on status |
| list_displays | adapter.listDisplays |
| mouse_move | map coords; exclusive; move |
| click | map; exclusive; move+down+up; count loops |
| double_click | click count 2 with OS double-click interval |
| drag | map both ends; move to start; down; interpolate to end over durationMs; up |
| type | exclusive; unicode typing; do not interpret as shortcuts except raw text |
| key | exclusive; key + modifiers |
| scroll | move to point; scroll ticks from dx/dy (120 units ≈ one notch; map dy/100 → notches) |
| wait | sleep ms; no exclusive required |
| open_app | macOS `open -a` / `open path`; Windows `shell.openPath` / Start-Process by name best-effort |

### 6.3 Overlay (agent cursor)

- Renderer or main-layer always-on-top transparent window is acceptable.
- Minimum v1: **no separate overlay window required** if tray + HUD show “Using desktop”; preferred: small crosshair or colored cursor badge near pointer via a frameless `BrowserWindow` `setIgnoreMouseEvents(true)` updated on move.
- If overlay is too costly, ship HUD-only and document; do not block GA on fancy overlay.

### 6.4 Frontmost app metadata

After each successful input tool (best-effort):

- macOS: NSWorkspace frontmost application + AX focused window title if Accessibility allows  
- Windows: GetForegroundWindow + process name  

Attach to result and status for stream chips (“clicked · Numbers”).

---

## 7. Platform adapters

### 7.1 Interface (`apps/desktop/src/main/desktop/types.ts`)

```ts
export interface DesktopAdapter {
  platform: "darwin" | "win32";
  getPermissionStatus(): Promise<DesktopPermissionStatus>;
  openCaptureSettings(): Promise<void>;
  openInputSettings(): Promise<void>;
  listDisplays(): Promise<DesktopDisplayInfo[]>;
  captureDisplay(displayId: string): Promise<{
    pngOrJpeg: Buffer;
    mime: "image/png" | "image/jpeg";
    deviceWidth: number;
    deviceHeight: number;
    scaleFactor: number;
    bounds: { x: number; y: number; width: number; height: number };
  }>;
  mouseMove(screenX: number, screenY: number): Promise<void>;
  mouseClick(opts: {
    screenX: number;
    screenY: number;
    button: "left" | "right" | "middle";
    count: number;
  }): Promise<void>;
  mouseDrag(opts: {
    x1: number; y1: number; x2: number; y2: number; durationMs: number;
  }): Promise<void>;
  typeText(text: string): Promise<void>;
  key(opts: { key: string; modifiers: string[] }): Promise<void>;
  scroll(opts: {
    screenX: number; screenY: number; dx: number; dy: number;
  }): Promise<void>;
  openApp(opts: { name?: string; path?: string }): Promise<void>;
  getFrontmost(): Promise<{ app: string | null; title: string | null }>;
  /** Start listening for real user input; callback on yield */
  startYieldMonitor(onYield: () => void): () => void; // returns stop
}
```

### 7.2 macOS adapter

| Concern | Implementation guidance |
|---------|-------------------------|
| Capture permission | Screen Recording; use `systemPreferences.getMediaAccessStatus('screen')` where available, or probe capture failure |
| Input permission | Accessibility; `systemPreferences.isTrustedAccessibilityClient(false)` / prompt with `true` once from UI button |
| Capture | Prefer `desktopCapturer.getSources({ types:['screen'], thumbnailSize })` for v1 reliability; optional ScreenCaptureKit native later |
| Input | `@nut-tree-fork/nut-js` or `robotjs` rebuilt for Electron ABI, **or** small native module wrapping CGEvent; must ship with electron-rebuild in package scripts |
| Open settings | `shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')` and Accessibility pane URLs (current macOS deep links; fallback to Security & Privacy) |
| open_app | `open -a "App Name"` or `open "/path"` |
| Packaging | `electron-builder` entitlements: hardened runtime + description strings for screen and accessibility usage if required by notarization |

**Info.plist / entitlements usage strings (as required by OS):**

- Screen recording purpose string: “Grok Desk captures the screen so the coworker agent can see UI while desktop control is enabled.”
- Accessibility: “Grok Desk controls the mouse and keyboard when you allow desktop control on a task.”

### 7.3 Windows adapter

| Concern | Implementation guidance |
|---------|-------------------------|
| Capture | `desktopCapturer` screen sources; Graphics Capture if needed later |
| Input | SendInput via nut.js / robotjs / native addon |
| Permissions | Windows 10/11 generally allow capture/input without macOS-style TCC; still surface “if capture fails, check Windows privacy settings for screen” |
| open settings | `ms-settings:privacy-graphicscapture` or generic privacy settings |
| open_app | `shell.openPath`, or `where` + spawn; for Start Menu names use best-effort |
| Packaging | Ship native addon for both x64 and arm64 if applicable |

### 7.4 Native dependency policy

- Prefer **one** cross-platform library if Electron rebuild works on both OS CI targets.
- Pin version; add `scripts/rebuild-native-for-electron.mjs` usage already in repo.
- If native fails on a platform, feature must **not** silently no-op: surface `desktop_not_supported` / `desktop_input_failed` with install/rebuild guidance for dev, and block GA on that platform.

### 7.5 Selecting adapter

```ts
function createDesktopAdapter(): DesktopAdapter {
  if (process.platform === "darwin") return new MacDesktopAdapter();
  if (process.platform === "win32") return new WinDesktopAdapter();
  return new UnsupportedDesktopAdapter();
}
```

---

## 8. MCP server (engine surface)

### 8.1 File

`apps/desktop/resources/desktop-mcp-server.mjs`  
Mirror structure of `browser-mcp-server.mjs`.

### 8.2 Env

| Env | Purpose |
|-----|---------|
| `GROKDESK_DESKTOP_URL` | `http://127.0.0.1:<port>` |
| `GROKDESK_DESKTOP_TOKEN` | bearer/token header |
| `GROKDESK_DESKTOP_TASK_ID` | thread root task id (set per run) |
| `GROKDESK_DESKTOP_MCP_PATH` | path to mjs for gateway inject |

### 8.3 Host HTTP API (`desktop-host-server.ts`)

| Route | Method | Body | Auth |
|-------|--------|------|------|
| `/exec` | POST | `{ taskId, tool, args }` | header `x-grokdesk-desktop-token` |
| `/health` | GET | — | token optional |

Bind **127.0.0.1 only**. Random port. Token = crypto random 32 bytes hex.

### 8.4 Tool descriptions (engine-facing)

Each tool description must include:

- Coordinate system (screenshot space)
- Prefer screenshot after UI changes
- Prefer `browser.*` for sandboxed web the user watches in Desk
- Use `desktop.*` for native apps and real OS UI
- Desktop control may be disabled — errors are actionable

### 8.5 Image content in MCP results

Return content array suitable for vision models:

```json
{
  "content": [
    { "type": "text", "text": "screenshot 1280x800 display=..." },
    { "type": "image", "data": "<base64>", "mimeType": "image/jpeg" }
  ]
}
```

If MCP image type unsupported by Grok Build bridge, fall back to text + data URL in text (same as browser screenshot path does today). **Match whatever browser screenshot already does successfully** so the engine path is consistent.

### 8.6 Gateway MCP injection

In `packages/gateway` (mirror `prependDeskBrowserMcp`):

- When `GROKDESK_DESKTOP_URL`, `TOKEN`, `MCP_PATH` set, prepend MCP server id `desk-desktop` with env including **per-run** `GROKDESK_DESKTOP_TASK_ID` = thread root.
- Inject only if machine settings enabled **or** always inject and let authorize fail (prefer **always inject when host present**, fail closed on grant — so model can see tools and get clear errors).  
  **Locked choice:** inject when host env present; authorization enforces grant. Skills say not to call when user hasn’t enabled.

---

## 9. Gateway / runner integration

### 9.1 Task start

```
await hostBridge.desktopConfigure({
  taskId: desktopSessionId,
  granted: loadGrant(desktopSessionId),
  displayId: loadDisplay(desktopSessionId),
  machine: settings.desktopControl,
});
```

### 9.2 Task end / cancel

```
await hostBridge.desktopDestroy(desktopSessionId);
```

Only destroy when **no other running task** shares the same thread root. Mirror browser destroy rules if they share lifecycle.

### 9.3 Audit

On every desktop tool result (success or fail), append audit:

```ts
{
  taskId,
  action: "desktop_tool",
  detail: {
    tool,
    argsSummary, // coords, key names; type text redacted to length only in default audit UI
    ok,
    code,
    frontmostApp,
    frontmostWindowTitle,
  }
}
```

Also append task event `tool_result` so the stream shows chips/images (engine may already emit tool_result — avoid duplicates; prefer engine stream as source of truth when MCP path, audit always from host).

### 9.4 Fake engine

Extend `FakeEngine` / fixtures for tests:

- Scenario: grant on → screenshot → click → done  
- Scenario: grant off → tool fails with desktop_disabled_task  

---

## 10. UI specification

### 10.1 Settings → Permissions tab

New tab in settings (alongside Account, Preferences, Tools, License, Language).

**Sections:**

1. **Desktop control (master)**  
   - Toggle bound to `desktopControl.enabled`  
   - Helper text: “Allow Grok Desk to see the screen and control the mouse and keyboard when you turn it on for a task.”

2. **System permissions**  
   - Capture: status chip Granted / Missing / Unknown + button “Open Screen Recording settings”  
   - Input: status chip + “Open Accessibility settings” (macOS) / “Input help” (Windows)  
   - Refresh status button

3. **Limits** (advanced, collapsed by default)  
   - Max actions per minute (number)  
   - Max actions per task  
   - Screenshot quality (slider or select)

4. **Safety note**  
   - Static copy about residual risk (password fields, deny list best-effort)

**i18n:** add keys under `settings.permissions.*` in all locale files (en required; other locales may copy English initially if product allows — **prefer full en strings; mirror existing pattern for other locales**).

### 10.2 Task workspace chrome

Near globe / approval mode controls:

- Switch: **Desktop** on/off (task grant)  
- When softPaused: badge **Paused — you took control** + **Resume** button  
- When exclusive/active: strip  

**Desktop HUD strip (when `status.active` or recent activity < 3s):**

```
[● Using desktop]  {frontmostApp or "Desktop"}   [Pause] [Stop]
```

- **Pause** → sets softPaused (local) + does not cancel whole task  
- **Stop** → sets granted false + destroy exclusive + optional cancel not forced  

Optional thumbnail of last screenshot on expand (chevron).

### 10.3 Stream presentation

- Tool chips: `desktop.click`, `desktop.type`, etc. (match existing tool chip styling)  
- Screenshots: same image component as browser screenshots  
- Failed tools: red chip + code-mapped recovery string from taxonomy

### 10.4 Tray / menu bar

Extend `TrayStatus` with desktop activity:

- If any task has `status.exclusive` or active desktop exec → tray label/tooltip “Desktop control active”  
- Menu item **Pause all** already exists — ensure it stops desktop  
- Optional menu: **Desktop control: On/Off** for master switch (nice-to-have; Settings is enough for v1)

### 10.5 Recovery copy map

| Code | User-facing (en) |
|------|------------------|
| `desktop_disabled_machine` | Turn on Desktop control in Settings → Permissions. |
| `desktop_disabled_task` | Enable Desktop for this chat to let Grok use the screen. |
| `desktop_paused` | Tasks are paused. Resume from the tray or task bar. |
| `desktop_permission_capture` | Grant Screen Recording to Grok Desk in System Settings. |
| `desktop_permission_input` | Grant Accessibility (mouse and keyboard) to Grok Desk. |
| `desktop_yielded` | You moved the mouse or typed — desktop control paused. Click Resume when ready. |
| `desktop_rate_limited` | Too many desktop actions — wait a moment or raise limits in Permissions. |
| `desktop_denied_target` | Blocked: sensitive app (password manager / security). Complete this step yourself. |
| `desktop_invalid_args` | Invalid desktop action arguments. |
| `desktop_display_not_found` | That display is not available. Call list_displays. |
| `desktop_capture_failed` | Could not capture the screen. Check permissions and try again. |
| `desktop_input_failed` | Could not control the mouse/keyboard. Check Accessibility permissions. |
| `desktop_open_app_failed` | Could not open that app. Check the name or path. |
| `desktop_not_supported` | Desktop control is not supported on this platform. |

Add to error taxonomy if useful for recovery banners.

---

## 11. Skills and system guidance

### 11.1 Update `skills/desk-defaults/SKILL.md`

Add section:

```markdown
## Desktop control vs agent browser

- For websites the user should **watch inside Grok Desk**, prefer **browser.*** tools
  (isolated agent browser + globe pane).
- For **native apps**, Finder/Explorer, OS dialogs, or anything outside the agent browser,
  use **desktop.*** tools (screenshot → act → screenshot).
- Desktop tools only work if the user enabled Desktop control in Settings and for this chat.
- After any UI change, take a fresh desktop.screenshot before clicking.
- Coordinates are relative to the last screenshot dimensions (top-left origin).
- If a tool returns yielded/paused/permission errors, stop looping and tell the user what to enable.
```

### 11.2 Optional marketing / ops skills

One line cross-link: “May use desktop control when user has granted it.”

---

## 12. Packaging and CI

### 12.1 electron-builder

- macOS: usage description keys for screen/accessibility as required  
- Windows: no special TCC; ensure native modules pack under `extraResources` if needed  
- Include `desktop-mcp-server.mjs` in `apps/desktop/resources` (packaged next to browser MCP)

### 12.2 CI matrix

| Job | Assert |
|-----|--------|
| unit (any OS) | policy, coords, schemas, host bridge types |
| integration macOS | adapter permission probe + capture mock or real in signed env |
| integration Windows | same |
| e2e smoke | fake engine desktop path on available OS |

**GA gate:** both macOS and Windows integration suites green for desktop feature; otherwise do not enable master switch in production builds (or ship disabled with “coming soon” only if dual OS fails — **prefer hold feature flag `desktopControlFeature: true` only when both pass**).

Internal constant:

```ts
export const DESKTOP_CONTROL_FEATURE_ENABLED = true; // flip false to hide UI
```

---

## 13. File inventory (create / modify)

### Create

```
packages/shared/src/desktop-types.ts
packages/shared/src/desktop-types.test.ts
packages/shared/src/desktop-tool-schemas.ts
packages/shared/src/desktop-tool-schemas.test.ts
packages/shared/src/desktop-coords.ts
packages/shared/src/desktop-coords.test.ts
packages/shared/src/desktop-deny.ts
packages/shared/src/desktop-deny.test.ts

apps/desktop/src/main/desktop-use-service.ts
apps/desktop/src/main/desktop-use-service.test.ts
apps/desktop/src/main/desktop-policy-store.ts
apps/desktop/src/main/desktop-policy-store.test.ts
apps/desktop/src/main/desktop-host-server.ts
apps/desktop/src/main/desktop-host-server.test.ts
apps/desktop/src/main/desktop/types.ts
apps/desktop/src/main/desktop/mac-adapter.ts
apps/desktop/src/main/desktop/win-adapter.ts
apps/desktop/src/main/desktop/unsupported-adapter.ts
apps/desktop/src/main/desktop/coords-map.ts
apps/desktop/src/main/desktop/select-adapter.ts

apps/desktop/resources/desktop-mcp-server.mjs

apps/desktop/src/renderer/components/views/settings/permissions-tab.tsx
apps/desktop/src/renderer/components/desktop-control-hud.tsx
apps/desktop/src/renderer/components/desktop-task-toggle.tsx
apps/desktop/src/renderer/hooks/use-desktop-status.ts
apps/desktop/src/renderer/lib/desktop-recovery.ts
apps/desktop/src/renderer/lib/desktop-recovery.test.ts
```

### Modify

```
packages/shared/src/index.ts
packages/shared/src/settings-schema.ts
packages/shared/src/types.ts              # TrayStatus if needed; AppSettings
packages/shared/src/ipc.ts               # desktop.* methods
packages/shared/src/error-taxonomy.ts    # map desktop codes

packages/gateway/src/host-bridge.ts
packages/gateway/src/host-bridge.test.ts
packages/gateway/src/index.ts            # MCP inject + settings
packages/gateway/src/services/runner.ts  # configure/destroy
packages/gateway/src/db.ts              # optional grant table
packages/engine-grok/src/*              # per-run MCP env task id if needed

apps/desktop/src/main/index.ts          # wire service, host, host_call, env
apps/desktop/src/main/ipc-bridge.ts     # desktop IPC
apps/desktop/src/main/tray.ts           # desktop active tooltip
apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/lib/api.ts
apps/desktop/src/renderer/components/views/settings/*  # tab registry
apps/desktop/src/renderer/components/views/task-workspace-view.tsx
apps/desktop/src/renderer/components/task-stream.tsx   # chips if needed
apps/desktop/src/renderer/i18n/locales/*.json
apps/desktop/electron-builder.yml
apps/desktop/package.json               # native dep if any
skills/desk-defaults/SKILL.md
```

---

## 14. Implementation order (single delivery)

Execute in this order so each step is testable; **do not ship** until the full checklist in §0 is green.

1. **Shared types, schemas, coords, deny, settings keys** + unit tests  
2. **DesktopPolicyStore** + unit tests  
3. **DesktopUseService** with mock adapter + unit tests  
4. **Mac adapter** + **Win adapter** + select-adapter  
5. **desktop-host-server** + **desktop-mcp-server.mjs**  
6. **HostBridge + main host_call + gateway MCP inject + runner lifecycle**  
7. **IPC + Permissions tab + task grant toggle + HUD + tray + i18n**  
8. **Skills + error taxonomy + stream/chip polish**  
9. **Packaging entitlements + rebuild scripts**  
10. **Full test pass + dual-OS dogfood script**  
11. **Enable feature flag / master default remains off**

No intermediate product release of screenshot-only.

---

## 15. Testing specification

### 15.1 Unit (required)

| Area | Cases |
|------|-------|
| Coords | 2x Retina map; clamp; multi-display offset |
| Schemas | valid/invalid tools; key normalization |
| Deny | 1Password block; normal app allow |
| Policy | machine off; task off; pause; rate limit; softPaused allows screenshot |
| Coords scale | 2560 device → 1280 image → click (100,100) → device (200,200) |

### 15.2 Service integration (mock adapter)

- Full click path with auto-screenshot  
- Yield mid-drag sets softPaused  
- Destroy clears exclusive  

### 15.3 Host server

- Reject bad token  
- Exec routes to service  

### 15.4 Gateway

- host_call desktop.exec round-trip with StdioHostBridge mock  
- MCP inject presence when env set  

### 15.5 Renderer

- Permissions tab toggles settings  
- Task grant disabled when machine off  
- HUD shows on status events  

### 15.6 Manual dual-OS acceptance (required for DONE)

On **both** macOS and Windows:

1. Fresh install: master off, no accidental control.  
2. Enable master → OS permission prompts/guidance work.  
3. Task grant on → agent (or fake tool client) screenshots real desktop.  
4. Click a visible target (e.g. open Calculator/Notepad, click button) succeeds.  
5. Type text into a text field succeeds.  
6. User moves mouse mid-run → yield + Resume works.  
7. Pause all blocks further desktop tools.  
8. Password manager frontmost → blocked with clear message (if installed; else simulate process name in test).  
9. Agent browser still works independently.  
10. Audit log contains desktop actions.

---

## 16. Security and privacy

- Localhost-only control plane; random token per process life.  
- No screenshots uploaded except as model multimodal payload to SuperGrok/xAI under existing auth (same as any vision).  
- Audit stored locally.  
- Default off.  
- Product copy must not claim perfect avoidance of sensitive fields.  
- Redact long `desktop.type` text in default UI audit; full text may exist in detailed audit for debugging (local only).

---

## 17. Observability

Main log (redacted):

- desktop exec tool name, ok/code, durationMs, taskId  
- never log full screenshot bytes  
- never log typed passwords intentionally; type text truncated to 32 chars in logs  

---

## 18. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Native module Electron ABI hell | Rebuild scripts; CI both platforms; fail loud |
| Shared cursor steals work | Exclusive bursts, yield, soft pause, HUD |
| Runaway agent | Rate limits, pause all, max per task |
| Model ignores screenshot space | Tool descriptions + auto re-screenshot + width/height always returned |
| Grok Build MCP image support quirks | Match browser screenshot result shape exactly |
| Permission UX friction | Permissions tab + deep links + recovery codes |
| Dual-OS slip | GA gate both OS |

---

## 19. Success metrics (qualitative)

- User completes one real multi-app workflow with desktop control on each OS without terminal.  
- Interruption (mouse move / pause all) always recovers cleanly within 1s.  
- Zero known stuck exclusive grabs after stop.  
- Support burden: permission issues resolved via in-app deep links without custom builds.

---

## 20. Supersession note

Section 23 of `2026-07-10-grok-desk-design.md` listed “Full computer-use … as primary driver” as out of scope. **This specification supersedes that line** for computer use as an **optional, grant-gated host capability**. Computer use is not the primary driver of all tasks; shell, fs, browser, and MCP remain first-class.

---

## 21. Changelog

| Date | Change |
|------|--------|
| 2026-07-11 | Initial product design (pixel loop, dual-OS, Permissions) |
| 2026-07-11 | Expanded to full engineering specification for single complete delivery |

---

## 22. Approval

Product approach approved in brainstorming (pure pixel loop, dual-OS GA, Permissions tab).  
This full engineering expansion is the implementation contract for shipping the **entire** feature in one go.
