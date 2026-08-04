# Computer Use (Desktop GUI Control) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship complete desktop computer use on macOS and Windows in one delivery: screenshot + mouse/keyboard tools, MCP + HostBridge, Permissions tab, per-task grant, exclusive bursts, yield-to-user, rate limits, audit, and dual-OS acceptance.

**Architecture:** Mirror agent browser. Engine calls `desktop.*` via `desktop-mcp-server.mjs` → localhost DesktopHostServer → DesktopPolicyStore + DesktopUseService → Mac/Win adapters. Gateway HostBridge handles configure/destroy/lifecycle. Renderer only shows Permissions, task grant, HUD.

**Tech Stack:** TypeScript monorepo, Electron main/preload/renderer, Zod, gateway SQLite settings, stdio HostBridge, MCP JSON-RPC mjs, Vitest, native input/capture (nut.js or equivalent rebuilt for Electron).

**Spec:** `docs/superpowers/specs/2026-07-11-computer-use-design.md` (authoritative). Do not ship partial (screenshot-only or single-OS GA).

---

## File structure

```
packages/shared/src/
  desktop-types.ts
  desktop-tool-schemas.ts
  desktop-coords.ts
  desktop-deny.ts
  settings-schema.ts          # + desktopControl
  ipc.ts                      # + desktop.* methods
  error-taxonomy.ts           # + desktop codes
  index.ts

packages/gateway/src/
  host-bridge.ts
  host-bridge.test.ts
  index.ts                    # MCP inject desk-desktop
  services/runner.ts          # configure/destroy desktop session
  db.ts / services/*          # optional grant persistence

apps/desktop/src/main/
  desktop-use-service.ts
  desktop-policy-store.ts
  desktop-host-server.ts
  desktop/
    types.ts
    select-adapter.ts
    mac-adapter.ts
    win-adapter.ts
    unsupported-adapter.ts
  index.ts
  ipc-bridge.ts
  tray.ts

apps/desktop/resources/
  desktop-mcp-server.mjs

apps/desktop/src/preload/index.ts
apps/desktop/src/renderer/
  components/views/settings/permissions-tab.tsx
  components/desktop-control-hud.tsx
  components/desktop-task-toggle.tsx
  hooks/use-desktop-status.ts
  lib/desktop-recovery.ts
  lib/api.ts
  i18n/locales/*.json
  components/views/task-workspace-view.tsx
  ...settings tab registry

skills/desk-defaults/SKILL.md
apps/desktop/electron-builder.yml
apps/desktop/package.json
```

---

### Task 1: Shared types, coords, deny, schemas

**Files:**
- Create: `packages/shared/src/desktop-types.ts`
- Create: `packages/shared/src/desktop-coords.ts`
- Create: `packages/shared/src/desktop-coords.test.ts`
- Create: `packages/shared/src/desktop-deny.ts`
- Create: `packages/shared/src/desktop-deny.test.ts`
- Create: `packages/shared/src/desktop-tool-schemas.ts`
- Create: `packages/shared/src/desktop-tool-schemas.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Implement types** from spec §3.2 (`DesktopTool`, `DesktopErrorCode`, `DesktopExecResult`, `DesktopMachineSettings`, `DEFAULT_DESKTOP_MACHINE_SETTINGS`, `DesktopPermissionStatus`, `DesktopStatusEvent`, `DesktopTaskState`, `DesktopDisplayInfo`).

- [ ] **Step 2: Implement coords**

```ts
// packages/shared/src/desktop-coords.ts
export function imageToDevice(
  imageX: number,
  imageY: number,
  imageW: number,
  imageH: number,
  deviceW: number,
  deviceH: number,
): { x: number; y: number } {
  if (imageW <= 0 || imageH <= 0) return { x: 0, y: 0 };
  const x = Math.round((imageX / imageW) * deviceW);
  const y = Math.round((imageY / imageH) * deviceH);
  return {
    x: Math.min(deviceW - 1, Math.max(0, x)),
    y: Math.min(deviceH - 1, Math.max(0, y)),
  };
}

export function deviceToScreen(
  deviceX: number,
  deviceY: number,
  bounds: { x: number; y: number },
): { x: number; y: number } {
  return { x: bounds.x + deviceX, y: bounds.y + deviceY };
}

export function computeDownscale(
  deviceW: number,
  deviceH: number,
  maxLongEdge: number,
): { imageW: number; imageH: number; imageToDeviceScale: number } {
  const longEdge = Math.max(deviceW, deviceH);
  if (longEdge <= maxLongEdge) {
    return { imageW: deviceW, imageH: deviceH, imageToDeviceScale: 1 };
  }
  const scale = maxLongEdge / longEdge;
  return {
    imageW: Math.max(1, Math.round(deviceW * scale)),
    imageH: Math.max(1, Math.round(deviceH * scale)),
    imageToDeviceScale: 1 / scale,
  };
}
```

- [ ] **Step 3: Tests for coords** — Retina 2x (2560→1280), clamp corners, multi-display offset via deviceToScreen.

- [ ] **Step 4: Deny list** — `isDeniedDesktopTarget(app: string | null, title: string | null): boolean` using substrings from spec §4.2.

- [ ] **Step 5: Zod schemas** for each tool’s args; `parseDesktopToolArgs(tool, args)`.

- [ ] **Step 6: Export from index; run**

```bash
pnpm --filter @grokdesk/shared test
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/desktop-*.ts packages/shared/src/index.ts
git commit -m "feat(shared): desktop computer-use types, coords, deny, schemas"
```

---

### Task 2: Settings schema + error taxonomy

**Files:**
- Modify: `packages/shared/src/settings-schema.ts`
- Modify: `packages/shared/src/settings-schema.test.ts`
- Modify: `packages/shared/src/error-taxonomy.ts`
- Modify: `packages/shared/src/error-taxonomy.test.ts`
- Modify: `packages/shared/src/types.ts` (AppSettings if defined here)
- Modify: gateway settings defaults wherever `AppSettings` is constructed

- [ ] **Step 1: Add** `desktopControl` to settable settings with nested schema matching `DesktopMachineSettings`.

- [ ] **Step 2: Default** `enabled: false` in gateway default settings.

- [ ] **Step 3: Map** desktop error codes in `classifyEngineError` / new `classifyDesktopCode` used by renderer recovery.

- [ ] **Step 4: Tests green; commit**

```bash
git commit -m "feat(shared): desktopControl settings + error taxonomy"
```

---

### Task 3: DesktopPolicyStore

**Files:**
- Create: `apps/desktop/src/main/desktop-policy-store.ts`
- Create: `apps/desktop/src/main/desktop-policy-store.test.ts`

- [ ] **Step 1: Write failing tests** for authorize matrix: machine off, task off, paused, softPaused (screenshot allowed), rate limit per minute/task, invalid args, deny target.

- [ ] **Step 2: Implement** authorize algorithm from spec §4.1 exactly.

- [ ] **Step 3: Methods:** `setMachine`, `setGrant(taskId, granted, displayId?)`, `setSoftPaused`, `setGlobalPaused`, `configureFromGateway`, `getTaskState`, `incrementOnSuccess` (or increment inside authorize), `destroy(taskId)`.

- [ ] **Step 4: Tests pass; commit**

```bash
git commit -m "feat(desktop): DesktopPolicyStore for computer-use grants and budgets"
```

---

### Task 4: Mock adapter + DesktopUseService

**Files:**
- Create: `apps/desktop/src/main/desktop/types.ts`
- Create: `apps/desktop/src/main/desktop/unsupported-adapter.ts`
- Create: `apps/desktop/src/main/desktop-use-service.ts`
- Create: `apps/desktop/src/main/desktop-use-service.test.ts`

- [ ] **Step 1: Define** `DesktopAdapter` interface per spec §7.1.

- [ ] **Step 2: Create** in-memory `MockDesktopAdapter` in test file (fixed 200x100 display, records actions).

- [ ] **Step 3: Implement** `DesktopUseService.exec` — policy first, then tool switch; auto-screenshot if no capture metadata; map coords; exclusive begin/end; yield monitor wiring; status emitters.

- [ ] **Step 4: Tests:** click maps correctly; type records text; yield sets softPaused and fails; list_displays; wait; open_app delegates.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(desktop): DesktopUseService with mock adapter tests"
```

---

### Task 5: macOS + Windows adapters

**Files:**
- Create: `apps/desktop/src/main/desktop/mac-adapter.ts`
- Create: `apps/desktop/src/main/desktop/win-adapter.ts`
- Create: `apps/desktop/src/main/desktop/select-adapter.ts`
- Modify: `apps/desktop/package.json` (add native dependency if chosen)
- Modify: rebuild scripts if needed

- [ ] **Step 1: Choose** input library (prefer one that rebuilds for Electron on both OS). Document choice in commit message.

- [ ] **Step 2: Implement MacDesktopAdapter** — desktopCapturer capture, permission probes, CGEvent/nut input, open settings URLs, open_app via `open`, yield monitor.

- [ ] **Step 3: Implement WinDesktopAdapter** — capture, SendInput path, open_app, settings links, yield monitor.

- [ ] **Step 4: select-adapter.ts** returns correct adapter by `process.platform`.

- [ ] **Step 5: Smoke-test manually** on current OS (capture + move mouse slightly in a dev harness or unit with real adapter gated by `DESCRIBE_REAL_DESKTOP=1`).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(desktop): macOS and Windows desktop control adapters"
```

---

### Task 6: Host HTTP server + MCP server

**Files:**
- Create: `apps/desktop/src/main/desktop-host-server.ts`
- Create: `apps/desktop/src/main/desktop-host-server.test.ts`
- Create: `apps/desktop/resources/desktop-mcp-server.mjs`

- [ ] **Step 1: Implement** localhost server mirror of `browser-host-server.ts` (`/exec`, token, 127.0.0.1).

- [ ] **Step 2: Implement** MCP tools/list + tools/call for all `desktop.*` tools; map to internal ids; pass taskId from env.

- [ ] **Step 3: Screenshot MCP result shape** matches browser screenshot (text + image/data URL).

- [ ] **Step 4: Tests for host server auth; commit**

```bash
git commit -m "feat(desktop): desktop host server and MCP tool surface"
```

---

### Task 7: HostBridge + main wiring + gateway MCP inject + runner

**Files:**
- Modify: `packages/gateway/src/host-bridge.ts`
- Modify: `packages/gateway/src/host-bridge.test.ts`
- Modify: `packages/gateway/src/index.ts`
- Modify: `packages/gateway/src/services/runner.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: engine MCP env if browser task id is set similarly

- [ ] **Step 1: Extend HostBridge** with desktopExec/Configure/Destroy/Permissions methods and Null/Stdio implementations (`desktop.exec`, etc.).

- [ ] **Step 2: main index** — construct DesktopUseService + PolicyStore + startDesktopHostServer; set `GROKDESK_DESKTOP_*` env; handle host_call methods next to browser.

- [ ] **Step 3: Gateway** prepend `desk-desktop` MCP when env present (mirror desk-browser); set `GROKDESK_DESKTOP_TASK_ID` per run to thread root.

- [ ] **Step 4: Runner** — desktopConfigure on start; desktopDestroy when thread idle/cancel (same root-id rules as browser).

- [ ] **Step 5: Unit tests host-bridge; commit**

```bash
git commit -m "feat(gateway): host bridge and MCP injection for desktop control"
```

---

### Task 8: IPC, preload, renderer Permissions + HUD + task grant

**Files:**
- Modify: `packages/shared/src/ipc.ts`
- Modify: `apps/desktop/src/main/ipc-bridge.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/lib/api.ts`
- Create: permissions-tab, desktop-control-hud, desktop-task-toggle, use-desktop-status, desktop-recovery
- Modify: settings view registry, task-workspace-view, tray, locales

- [ ] **Step 1: Wire IPC methods** from spec §3.7.

- [ ] **Step 2: Permissions tab** — master toggle, permission chips, open OS settings, advanced limits.

- [ ] **Step 3: Task toggle + HUD + softPaused Resume.**

- [ ] **Step 4: Tray tooltip** when desktop active.

- [ ] **Step 5: i18n en + other locales** (keys for all recovery strings).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(desktop): Permissions tab, task grant, desktop HUD"
```

---

### Task 9: Skills, stream polish, packaging

**Files:**
- Modify: `skills/desk-defaults/SKILL.md`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: task-stream if tool naming needs aliases
- Packaging resources include `desktop-mcp-server.mjs`

- [ ] **Step 1: Skill guidance** desktop vs browser per spec §11.

- [ ] **Step 2: electron-builder** usage strings / resources.

- [ ] **Step 3: Verify packaged resource path resolution** like browser MCP `resolveBrowserMcpPath` → `resolveDesktopMcpPath`.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): skills, packaging, and stream polish for computer use"
```

---

### Task 10: Full verification (DONE gate)

- [ ] **Step 1: Run all unit tests**

```bash
pnpm test
```

- [ ] **Step 2: Manual dual-OS checklist** from spec §15.6 (both macOS and Windows). Record results in commit message or short note under `docs/plans/` if needed.

- [ ] **Step 3: Confirm** feature flag / UI visible; master default **off**; no control without grant.

- [ ] **Step 4: Final commit** if fixes needed

```bash
git commit -m "test(desktop): computer-use acceptance fixes for dual-OS GA"
```

---

## Spec coverage checklist

| Spec section | Task |
|--------------|------|
| §3 Shared contracts | 1–2, 7 |
| §4 Policy | 3 |
| §5 Coords/capture | 1, 4–5 |
| §6 DesktopUseService | 4 |
| §7 Adapters | 5 |
| §8 MCP | 6–7 |
| §9 Gateway/runner | 7 |
| §10 UI | 8 |
| §11 Skills | 9 |
| §12 Packaging/CI | 9–10 |
| §15 Testing / DONE | 10 |

---

## Execution

After this plan is approved for execution:

1. **Subagent-driven** (recommended) — one task per subagent + review  
2. **Inline** — execute tasks in session with checkpoints  

Do not mark complete until §0 of the full spec (DONE definition) is satisfied on both OS.
