# Agent Browser + Subagent HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an isolated in-app agent browser (globe + ~50% live pane, observe+steer tools) and a lightweight subagent HUD, per the approved design.

**Architecture:** Electron main owns `BrowserService` (`WebContentsView` + per-task session partition). Renderer only toggles a globe and reports bounds. Gateway policy-gates `browser_*` tools and executes them via a **host bridge** (JSON-lines reverse calls on the existing gateway stdio pipe). Production Grok also gets a tiny **desk-browser MCP** that hits the same main-process control socket so `executesOwnTools` engines can drive the pane. Subagent HUD is pure UI over existing `parentTaskId` task trees + latest tool/step events.

**Tech Stack:** TypeScript, Electron 33 (`WebContentsView`), React, Vitest, existing gateway JSON-lines RPC, optional Node `http` loopback control plane for MCP.

**Spec:** `docs/superpowers/specs/2026-07-11-agent-browser-subagent-hud-design.md`

**Scope:** v1 product slice = **P0–P2** (open/screenshot/read → click/type/scroll + policy → subagent HUD). P3/P4 are out of this plan.

---

## File structure

```
packages/shared/src/
  browser-url.ts              # pure URL/origin/private-network checks
  browser-url.test.ts
  browser-policy.ts           # evaluateBrowserToolRequest(policy, req, sessionState)
  browser-policy.test.ts
  policy.ts                   # extend ToolName with browser_* tools
  types.ts                    # BrowserStatus, subagent HUD DTOs if needed
  ipc.ts                      # document host-only methods (renderer browser IPC is main, not gateway)
  index.ts                    # re-export browser-url + browser-policy

packages/engine-grok/src/
  events.ts                   # mapToolName: browser.* → browser_* tools
  events.test.ts
  types.ts                    # NormalizedEngineEvent.tool union
  fake-engine.ts              # optional browser scenario helper for tests

packages/gateway/src/
  host-bridge.ts              # HostBridge interface + null impl
  services/runner.ts          # execute browser_* via host bridge; lifecycle destroy
  services/browser-session.ts # per-task origin session state for Balanced policy
  services/tasks.ts           # listChildren helper if missing
  cli.ts                      # multiplex host_call on stdout
  index.ts                    # wire HostBridge from env/callback

apps/desktop/src/main/
  browser-service.ts          # WebContentsView pool, tools, partitions
  browser-url-guard.ts        # re-export / thin wrap of shared browser-url if needed in main
  browser-host-server.ts      # 127.0.0.1 HTTP control plane (token auth)
  browser-mcp-server.mjs      # stdio MCP entry (spawned by Grok); calls host server
  gateway-process.ts          # handle host_call from gateway → BrowserService
  index.ts                    # construct BrowserService + host server + wire gateway
  preload/index.ts            # browser.* IPC for renderer
  ipc-bridge.ts               # optional: leave gateway RPC as-is

apps/desktop/src/renderer/
  lib/browser-ui.ts           # keep-closed / pin state helpers (pure)
  lib/browser-ui.test.ts
  lib/subagent-hud.ts         # aggregate children + current step
  lib/subagent-hud.test.ts
  lib/api.ts                  # browser status/bounds helpers via preload
  components/browser-globe.tsx
  components/browser-pane-slot.tsx  # empty half-pane that reports bounds
  components/subagent-hud.tsx
  components/views/task-workspace-view.tsx  # split + chrome icons
  i18n/locales/en.json        # minimal strings only if needed (prefer aria-labels)

skills/desk-defaults/SKILL.md # short note: prefer desk-browser / browser_* for live pages
```

---

## Conventions locked by this plan

| Item | Value |
|------|--------|
| Tool names (policy + events) | `browser_open`, `browser_click`, `browser_type`, `browser_scroll`, `browser_screenshot`, `browser_read` |
| Engine/MCP surface names | `browser.open`, `browser.click`, … (map with dots → underscores) |
| Partition | `persist:grokdesk-task-<taskId>` then `session.clearStorageData()` + destroy view on task end |
| Host bridge method | `browser.exec` with `{ taskId, tool, args }` |
| Control server | `http://127.0.0.1:<port>` + header `X-Grokdesk-Browser-Token` |
| Renderer IPC (main, not gateway) | `grokdesk:browser:getStatus`, `setBounds`, `setOpen`, `subscribe` via `ipcRenderer` events |
| One view per task | Parent task id owns the browser; children share parent’s browser unless later changed |

---

### Task 1: Shared browser URL guards

**Files:**
- Create: `packages/shared/src/browser-url.ts`
- Create: `packages/shared/src/browser-url.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/shared/src/browser-url.test.ts
import { describe, it, expect } from "vitest";
import {
  parseBrowserUrl,
  isBlockedBrowserUrl,
  originOf,
  isSameOrigin,
} from "./browser-url.js";

describe("browser-url", () => {
  it("parses https URLs", () => {
    const u = parseBrowserUrl("https://example.com/a");
    expect(u?.protocol).toBe("https:");
    expect(originOf(u!)).toBe("https://example.com");
  });

  it("blocks file://", () => {
    expect(isBlockedBrowserUrl("file:///etc/passwd").blocked).toBe(true);
  });

  it("blocks localhost and private IPs", () => {
    expect(isBlockedBrowserUrl("http://127.0.0.1:3000").blocked).toBe(true);
    expect(isBlockedBrowserUrl("http://192.168.1.1/").blocked).toBe(true);
    expect(isBlockedBrowserUrl("http://10.0.0.2/").blocked).toBe(true);
    expect(isBlockedBrowserUrl("http://[::1]/").blocked).toBe(true);
  });

  it("allows public https", () => {
    expect(isBlockedBrowserUrl("https://example.com").blocked).toBe(false);
  });

  it("same origin compares correctly", () => {
    expect(
      isSameOrigin("https://a.com/x", "https://a.com/y"),
    ).toBe(true);
    expect(
      isSameOrigin("https://a.com", "https://b.com"),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @grokdesk/shared test -- src/browser-url.test.ts`

Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/browser-url.ts
export type UrlCheck = { blocked: boolean; reason?: string };

export function parseBrowserUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

export function originOf(url: URL): string {
  return url.origin;
}

export function isSameOrigin(a: string, b: string): boolean {
  const ua = parseBrowserUrl(a);
  const ub = parseBrowserUrl(b);
  if (!ua || !ub) return false;
  return ua.origin === ub.origin;
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "0.0.0.0" || h === "::1") return true;
  // IPv4
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
  }
  // IPv6 unique local / link-local rough checks
  if (h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) return true;
  return false;
}

export function isBlockedBrowserUrl(raw: string): UrlCheck {
  const url = parseBrowserUrl(raw);
  if (!url) return { blocked: true, reason: "Invalid URL" };
  if (url.protocol === "file:") {
    return { blocked: true, reason: "file:// URLs are not allowed" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { blocked: true, reason: `Protocol ${url.protocol} is not allowed` };
  }
  if (isPrivateHostname(url.hostname)) {
    return {
      blocked: true,
      reason: "Local and private network URLs require elevation",
    };
  }
  return { blocked: false };
}
```

Export from `packages/shared/src/index.ts`:

```ts
export * from "./browser-url.js";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @grokdesk/shared test -- src/browser-url.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/browser-url.ts packages/shared/src/browser-url.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): browser URL isolation guards"
```

---

### Task 2: Browser tool policy (Strict / Balanced / Autopilot)

**Files:**
- Create: `packages/shared/src/browser-policy.ts`
- Create: `packages/shared/src/browser-policy.test.ts`
- Modify: `packages/shared/src/policy.ts` (extend `ToolName`)
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/policy.test.ts` (smoke: unknown still works)

**Session state type** (in-memory per task, held by gateway):

```ts
export type BrowserPolicySession = {
  /** Origins already approved for open in this task (Balanced). */
  approvedOrigins: Set<string>;
  /** When true, private/file blocks may allow (future elevate). v1 always false. */
  elevatedNetwork: boolean;
};
```

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/src/browser-policy.test.ts
import { describe, it, expect } from "vitest";
import { evaluateBrowserToolRequest } from "./browser-policy.js";
import type { PolicySnapshot } from "./types.js";

const base: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: ["/ws"],
  allowNetworkTools: true,
  allowShell: true,
};

function session(origins: string[] = []) {
  return { approvedOrigins: new Set(origins), elevatedNetwork: false };
}

describe("evaluateBrowserToolRequest", () => {
  it("denies file:// open always", () => {
    const r = evaluateBrowserToolRequest(
      base,
      { tool: "browser_open", url: "file:///tmp/x" },
      session(),
    );
    expect(r.decision).toBe("deny");
  });

  it("balanced: first origin needs approval, second same origin allows", () => {
    const first = evaluateBrowserToolRequest(
      base,
      { tool: "browser_open", url: "https://example.com" },
      session(),
    );
    expect(first.decision).toBe("needs_approval");

    const second = evaluateBrowserToolRequest(
      base,
      { tool: "browser_open", url: "https://example.com/pricing" },
      session(["https://example.com"]),
    );
    expect(second.decision).toBe("allow");
  });

  it("balanced: click/type/scroll/read/screenshot allow without approval when not submit", () => {
    for (const tool of [
      "browser_click",
      "browser_type",
      "browser_scroll",
      "browser_read",
      "browser_screenshot",
    ] as const) {
      const r = evaluateBrowserToolRequest(base, { tool }, session());
      expect(r.decision).toBe("allow");
    }
  });

  it("balanced: type with submit needs approval", () => {
    const r = evaluateBrowserToolRequest(
      base,
      { tool: "browser_type", submit: true },
      session(),
    );
    expect(r.decision).toBe("needs_approval");
  });

  it("strict: open and submit always need approval; click needs approval", () => {
    const strict = { ...base, approvalMode: "strict" as const };
    expect(
      evaluateBrowserToolRequest(
        strict,
        { tool: "browser_open", url: "https://example.com" },
        session(["https://example.com"]),
      ).decision,
    ).toBe("needs_approval");
    expect(
      evaluateBrowserToolRequest(strict, { tool: "browser_click" }, session())
        .decision,
    ).toBe("needs_approval");
  });

  it("autopilot allows open of public URL", () => {
    const auto = { ...base, approvalMode: "autopilot" as const };
    expect(
      evaluateBrowserToolRequest(
        auto,
        { tool: "browser_open", url: "https://example.com" },
        session(),
      ).decision,
    ).toBe("allow");
  });

  it("denies browser tools when allowNetworkTools is false", () => {
    const noNet = { ...base, allowNetworkTools: false };
    expect(
      evaluateBrowserToolRequest(
        noNet,
        { tool: "browser_open", url: "https://example.com" },
        session(),
      ).decision,
    ).toBe("deny");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @grokdesk/shared test -- src/browser-policy.test.ts`

- [ ] **Step 3: Implement policy + extend ToolName**

In `packages/shared/src/policy.ts`, extend:

```ts
export type ToolName =
  | "read_file"
  | "write_file"
  | "delete_file"
  | "shell"
  | "network"
  | "browser_open"
  | "browser_click"
  | "browser_type"
  | "browser_scroll"
  | "browser_screenshot"
  | "browser_read"
  | "other";
```

In `evaluateToolRequest`, at the top after path checks (browser tools ignore workspace path):

```ts
  if (req.tool.startsWith("browser_")) {
    // Prefer evaluateBrowserToolRequest from callers that have session state.
    // Fallback: network flag only.
    if (!policy.allowNetworkTools) {
      return { decision: "deny", reason: "Network tools disabled" };
    }
    return { decision: "allow", reason: "Browser tool — use browser policy" };
  }
```

Prefer **runner always calls `evaluateBrowserToolRequest`** for `browser_*` and does **not** rely on the fallback.

```ts
// packages/shared/src/browser-policy.ts
import { isBlockedBrowserUrl, originOf, parseBrowserUrl } from "./browser-url.js";
import type { PolicySnapshot } from "./types.js";
import type { PolicyResult } from "./policy.js";

export type BrowserToolName =
  | "browser_open"
  | "browser_click"
  | "browser_type"
  | "browser_scroll"
  | "browser_screenshot"
  | "browser_read";

export type BrowserToolRequest = {
  tool: BrowserToolName;
  url?: string;
  /** browser_type: pressing Enter / form submit */
  submit?: boolean;
  /** future: download */
  download?: boolean;
};

export type BrowserPolicySession = {
  approvedOrigins: Set<string>;
  elevatedNetwork: boolean;
};

export function evaluateBrowserToolRequest(
  policy: PolicySnapshot,
  req: BrowserToolRequest,
  session: BrowserPolicySession,
): PolicyResult {
  if (!policy.allowNetworkTools) {
    return { decision: "deny", reason: "Network tools disabled" };
  }

  if (req.tool === "browser_open") {
    const raw = req.url ?? "";
    const block = isBlockedBrowserUrl(raw);
    if (block.blocked && !session.elevatedNetwork) {
      return { decision: "deny", reason: block.reason ?? "Blocked URL" };
    }
    const url = parseBrowserUrl(raw);
    if (!url) return { decision: "deny", reason: "Invalid URL" };
    const origin = originOf(url);

    if (policy.approvalMode === "autopilot") {
      return { decision: "allow", reason: "Autopilot browser open" };
    }
    if (policy.approvalMode === "strict") {
      return {
        decision: "needs_approval",
        reason: "Strict mode requires approval for navigation",
      };
    }
    // balanced
    if (session.approvedOrigins.has(origin)) {
      return { decision: "allow", reason: "Origin already approved" };
    }
    return {
      decision: "needs_approval",
      reason: `First visit to ${origin} requires approval`,
    };
  }

  const isSubmit = req.submit === true || req.download === true;

  if (policy.approvalMode === "autopilot") {
    return { decision: "allow", reason: "Autopilot browser action" };
  }

  if (policy.approvalMode === "strict") {
    if (
      req.tool === "browser_click" ||
      req.tool === "browser_type" ||
      isSubmit
    ) {
      return {
        decision: "needs_approval",
        reason: "Strict mode requires approval for browser interaction",
      };
    }
    // screenshot / read / scroll free in strict
    return { decision: "allow", reason: "Observe-only browser tool" };
  }

  // balanced
  if (isSubmit) {
    return {
      decision: "needs_approval",
      reason: "Form submit / download requires approval",
    };
  }
  return { decision: "allow", reason: "Browser action allowed" };
}

/** Call after user approves browser_open for a URL. */
export function rememberApprovedOrigin(
  session: BrowserPolicySession,
  url: string,
): void {
  const u = parseBrowserUrl(url);
  if (u) session.approvedOrigins.add(originOf(u));
}
```

Export from `index.ts`.

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @grokdesk/shared test -- src/browser-policy.test.ts src/policy.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/browser-policy.ts packages/shared/src/browser-policy.test.ts packages/shared/src/policy.ts packages/shared/src/index.ts
git commit -m "feat(shared): browser tool policy for strict/balanced/autopilot"
```

---

### Task 3: Engine event mapping for browser tools

**Files:**
- Modify: `packages/engine-grok/src/types.ts`
- Modify: `packages/engine-grok/src/events.ts` (`mapToolName`)
- Modify: `packages/engine-grok/src/events.test.ts`

- [ ] **Step 1: Write failing test**

```ts
  it("maps browser.open and browser_open to browser_open", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({
        type: "tool_use",
        id: "b1",
        name: "browser.open",
        input: { url: "https://example.com" },
      }),
    );
    expect(events[0]).toMatchObject({
      type: "tool_request",
      tool: "browser_open",
    });
  });

  it("maps browser.click to browser_click", () => {
    const events = parseStreamingJsonLine(
      JSON.stringify({ type: "tool_use", id: "b2", name: "browser_click" }),
    );
    expect(events[0]).toMatchObject({ type: "tool_request", tool: "browser_click" });
  });
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @grokdesk/engine-grok test -- src/events.test.ts`

- [ ] **Step 3: Update types + mapToolName**

```ts
// types.ts tool union — add browser_* variants matching shared ToolName
```

```ts
function mapToolName(name: string): NormalizedEngineEvent extends { type: "tool_request" } ? ... {
  const n = name.toLowerCase().replace(/\./g, "_");
  if (n === "browser_open" || n.endsWith("browser_open")) return "browser_open";
  if (n === "browser_click" || n.includes("browser_click")) return "browser_click";
  if (n === "browser_type" || n.includes("browser_type")) return "browser_type";
  if (n === "browser_scroll" || n.includes("browser_scroll")) return "browser_scroll";
  if (n === "browser_screenshot" || n.includes("browser_screenshot")) return "browser_screenshot";
  if (n === "browser_read" || n.includes("browser_read")) return "browser_read";
  // existing write/read/delete/shell/network...
}
```

Ensure `meta` still carries full `input` (url, selector, etc.).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/engine-grok/src/types.ts packages/engine-grok/src/events.ts packages/engine-grok/src/events.test.ts
git commit -m "feat(engine-grok): map browser.* tools into normalized events"
```

---

### Task 4: Host bridge protocol (gateway ↔ main)

**Files:**
- Create: `packages/gateway/src/host-bridge.ts`
- Modify: `packages/gateway/src/cli.ts`
- Modify: `apps/desktop/src/main/gateway-process.ts`
- Create: `packages/gateway/src/host-bridge.test.ts` (unit: mock transport)
- Create: `apps/desktop/src/main/gateway-process.host.test.ts` if pure helpers extracted

**Protocol addition (stdout from gateway, stdin from main):**

```ts
// Gateway → Main (on stdout)
{ type: "host_call", id: string, method: "browser.exec", params: { taskId, tool, args } }

// Main → Gateway (on stdin)
{ type: "host_result", id: string, ok: true, result: unknown }
// or
{ type: "host_result", id: string, ok: false, error: string }
```

Existing `{ id, method, params }` main→gateway requests unchanged.

- [ ] **Step 1: Define HostBridge interface**

```ts
// packages/gateway/src/host-bridge.ts
export type BrowserExecArgs = {
  taskId: string;
  tool:
    | "browser_open"
    | "browser_click"
    | "browser_type"
    | "browser_scroll"
    | "browser_screenshot"
    | "browser_read";
  args: Record<string, unknown>;
};

export type BrowserExecResult = {
  ok: boolean;
  output: string;
  /** data URL or path for screenshot */
  screenshot?: string;
  url?: string;
  title?: string;
};

export interface HostBridge {
  browserExec(req: BrowserExecArgs): Promise<BrowserExecResult>;
  /** Notify main that task ended — destroy view + wipe partition */
  browserDestroy(taskId: string): Promise<void>;
}

/** In-process / test double */
export class NullHostBridge implements HostBridge {
  async browserExec(): Promise<BrowserExecResult> {
    return { ok: false, output: "No host browser bridge" };
  }
  async browserDestroy(): Promise<void> {}
}

export class StdioHostBridge implements HostBridge {
  private pending = new Map<
    string,
    { resolve: (v: BrowserExecResult) => void; reject: (e: Error) => void }
  >;
  private seq = 0;
  constructor(private write: (msg: unknown) => void) {}

  /** cli.ts calls this when a host_result line arrives (should not happen — results come from parent on stdin) */
  // Actually: host_result arrives on **stdin** of gateway. cli multiplexes.

  handleHostResult(msg: {
    id: string;
    ok: boolean;
    result?: BrowserExecResult;
    error?: string;
  }): void {
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if (msg.ok && msg.result) p.resolve(msg.result);
    else p.reject(new Error(msg.error || "host_result failed"));
  }

  private call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = `host-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: BrowserExecResult) => void,
        reject,
      });
      this.write({ type: "host_call", id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Host call timeout: ${method}`));
        }
      }, 120_000).unref?.();
    });
  }

  async browserExec(req: BrowserExecArgs): Promise<BrowserExecResult> {
    return (await this.call("browser.exec", req as unknown as Record<string, unknown>)) as BrowserExecResult;
  }

  async browserDestroy(taskId: string): Promise<void> {
    await this.call("browser.destroy", { taskId });
  }
}
```

- [ ] **Step 2: Multiplex gateway stdin in `cli.ts`**

```ts
// When parsing stdin lines:
// if msg.type === "host_result" → hostBridge.handleHostResult(msg)
// else if method === "shutdown" → ...
// else → dispatchGateway as today
```

Construct `StdioHostBridge` with `send`, pass into `Gateway` constructor.

- [ ] **Step 3: Handle host_call in `GatewayProcess`**

In `apps/desktop/src/main/gateway-process.ts` line handler:

```ts
if (msg.type === "host_call" && msg.id && msg.method) {
  void this.handleHostCall(String(msg.id), String(msg.method), msg.params ?? {});
  return;
}
```

```ts
private hostHandler: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | null = null;

setHostHandler(fn: typeof this.hostHandler) {
  this.hostHandler = fn;
}

private async handleHostCall(id: string, method: string, params: Record<string, unknown>) {
  try {
    if (!this.hostHandler) throw new Error("No host handler");
    const result = await this.hostHandler(method, params);
    this.write({ type: "host_result", id, ok: true, result });
  } catch (e) {
    this.write({
      type: "host_result",
      id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

private write(msg: unknown) {
  this.child?.stdin.write(JSON.stringify(msg) + "\n");
}
```

Add unit test for message routing with a mock child if practical; otherwise test `StdioHostBridge.handleHostResult` pending map in gateway package.

- [ ] **Step 4: Wire Gateway to accept HostBridge**

Modify `packages/gateway/src/index.ts` constructor to take optional `hostBridge` defaulting to `NullHostBridge`.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/host-bridge.ts packages/gateway/src/cli.ts packages/gateway/src/index.ts apps/desktop/src/main/gateway-process.ts
git commit -m "feat: host bridge protocol for main-process browser tools"
```

---

### Task 5: BrowserService in Electron main (P0 tools)

**Files:**
- Create: `apps/desktop/src/main/browser-service.ts`
- Create: `apps/desktop/src/main/browser-service.test.ts` (pure helpers: bounds clamp, partition name)
- Modify: `apps/desktop/src/main/index.ts`

**API:**

```ts
export type BrowserStatus = {
  taskId: string;
  url: string;
  title: string;
  loading: boolean;
  error: string | null;
  active: boolean;
  lastAction: string | null;
};

export class BrowserService {
  constructor(private getMainWindow: () => BrowserWindow | null) {}

  async ensure(taskId: string): Promise<void>
  setBounds(taskId: string, bounds: { x: number; y: number; width: number; height: number } | null): void
  setVisible(taskId: string, visible: boolean): void
  async exec(taskId: string, tool: string, args: Record<string, unknown>): Promise<BrowserExecResult>
  async destroy(taskId: string): Promise<void>
  getStatus(taskId: string): BrowserStatus | null
  onStatus(cb: (s: BrowserStatus) => void): () => void
}
```

Implementation notes:

- Prefer `WebContentsView` from `electron` (Electron 33). Fallback: `BrowserView` if needed.
- Session: `session.fromPartition(\`persist:grokdesk-task-${taskId}\`, { cache: true })`
- `webPreferences`: `sandbox: true`, `nodeIntegration: false`, `contextIsolation: true`, no preload for agent pages
- Block navigations that fail `isBlockedBrowserUrl` via `will-navigate` / `window.open`
- Tools:
  - `browser_open`: `loadURL(url)`
  - `browser_screenshot`: `webContents.capturePage()` → PNG data URL or write temp file under app temp
  - `browser_read`: `webContents.executeJavaScript` that returns `document.body?.innerText?.slice(0, 50_000)`
- P1 tools in Task 7 (click/type/scroll) — stub with clear error if called early **or** implement in Task 7 only

- [ ] **Step 1: Pure helper tests**

```ts
import { partitionForTask, clampBounds } from "./browser-service.js";

it("partitionForTask is stable and isolated", () => {
  expect(partitionForTask("abc")).toBe("persist:grokdesk-task-abc");
});

it("clampBounds rejects non-positive sizes", () => {
  expect(clampBounds({ x: 0, y: 0, width: 0, height: 100 })).toBeNull();
});
```

- [ ] **Step 2: Implement BrowserService**

Use `executeJavaScript` for read; for open wait on `did-finish-load` or `did-fail-load` with timeout (30s).

Emit status on load events.

- [ ] **Step 3: Wire in main**

```ts
const browserService = new BrowserService(() => mainWindow);
gateway.setHostHandler(async (method, params) => {
  if (method === "browser.exec") {
    return browserService.exec(
      String(params.taskId),
      String(params.tool),
      (params.args as Record<string, unknown>) ?? {},
    );
  }
  if (method === "browser.destroy") {
    await browserService.destroy(String(params.taskId));
    return { ok: true };
  }
  throw new Error(`Unknown host method ${method}`);
});
```

Register IPC for renderer (Task 6 can own preload; main handlers can land here):

```ts
ipcMain.handle("grokdesk:browser:status", (_e, taskId: string) =>
  browserService.getStatus(taskId),
);
ipcMain.handle("grokdesk:browser:setBounds", (_e, taskId: string, bounds) => {
  browserService.setBounds(taskId, bounds);
  return { ok: true };
});
ipcMain.handle("grokdesk:browser:setVisible", (_e, taskId: string, visible: boolean) => {
  browserService.setVisible(taskId, visible);
  return { ok: true };
});
// push status:
browserService.onStatus((s) => {
  mainWindow?.webContents.send("grokdesk:browser:status", s);
});
```

- [ ] **Step 4: Run main package tests**

Run: `pnpm --filter @grokdesk/desktop test -- src/main/browser-service.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/browser-service.ts apps/desktop/src/main/browser-service.test.ts apps/desktop/src/main/index.ts apps/desktop/src/main/gateway-process.ts
git commit -m "feat(desktop): BrowserService with isolated partitions (open/read/screenshot)"
```

---

### Task 6: Runner executes browser tools + lifecycle

**Files:**
- Create: `packages/gateway/src/services/browser-session.ts`
- Modify: `packages/gateway/src/services/runner.ts`
- Modify: `packages/gateway/src/services/runner.test.ts`
- Modify: `packages/engine-grok/src/fake-engine.ts` (optional `FakeBrowserEngine` scenario)

- [ ] **Step 1: Browser session store**

```ts
// packages/gateway/src/services/browser-session.ts
import type { BrowserPolicySession } from "@grokdesk/shared";

export class BrowserSessionStore {
  private map = new Map<string, BrowserPolicySession>();

  get(taskId: string): BrowserPolicySession {
    let s = this.map.get(taskId);
    if (!s) {
      s = { approvedOrigins: new Set(), elevatedNetwork: false };
      this.map.set(taskId, s);
    }
    return s;
  }

  delete(taskId: string): void {
    this.map.delete(taskId);
  }
}
```

- [ ] **Step 2: Failing runner test with custom engine**

```ts
class BrowserOpenEngine implements EngineAdapter {
  readonly executesOwnTools = false;
  async cancel(): Promise<void> {}
  async run(options: EngineRunOptions): Promise<void> {
    await options.onEvent({
      type: "tool_request",
      id: "b1",
      tool: "browser_open",
      meta: { url: "https://example.com" },
    });
    await options.onEvent({
      type: "done",
      summary: "opened",
    });
  }
}

it("runs browser_open through host bridge under autopilot", async () => {
  const calls: unknown[] = [];
  const host: HostBridge = {
    async browserExec(req) {
      calls.push(req);
      return { ok: true, output: "loaded", url: "https://example.com" };
    },
    async browserDestroy() {},
  };
  runner = new TaskRunner(tasks, audit, new BrowserOpenEngine(), { hostBridge: host });
  const t = tasks.create({
    goal: "Browse",
    workspaceRoots: [ws],
    approvalMode: "autopilot",
  });
  await runner.start(t.id);
  expect(calls).toHaveLength(1);
  expect(tasks.get(t.id)?.status).toBe("done");
  const events = tasks.listEvents(t.id); // use real API
  expect(events.some((e) => e.kind === "tool_result")).toBe(true);
});
```

Use the real `TaskService` event listing method (inspect `tasks.ts` — if only via DB, query events the same way other tests do).

- [ ] **Step 3: Implement runner branch**

In `tool_request` case, before generic policy:

```ts
if (event.tool.startsWith("browser_")) {
  const session = this.browserSessions.get(taskId);
  const url = String(event.meta?.url ?? "");
  const decision = evaluateBrowserToolRequest(
    task.policySnapshot,
    {
      tool: event.tool as BrowserToolName,
      url,
      submit: event.meta?.submit === true,
    },
    session,
  );
  // audit + deny / needs_approval same as existing pattern
  // on allow (or after approve):
  if (event.tool === "browser_open" && url) {
    rememberApprovedOrigin(session, url);
  }
  const result = await this.hostBridge.browserExec({
    taskId,
    tool: event.tool as BrowserExecArgs["tool"],
    args: (event.meta ?? {}) as Record<string, unknown>,
  });
  this.tasks.appendEvent(taskId, "tool_result", {
    id: event.id,
    ok: result.ok,
    output: result.output,
    url: result.url,
    screenshot: result.screenshot,
  });
  return "continue";
}
```

On task terminal status (`done` / `failed` / `cancelled`) in runner finally block:

```ts
await this.hostBridge.browserDestroy(taskId);
this.browserSessions.delete(taskId);
```

- [ ] **Step 4: Run gateway tests**

Run: `pnpm --filter @grokdesk/gateway test -- src/services/runner.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/browser-session.ts packages/gateway/src/services/runner.ts packages/gateway/src/services/runner.test.ts packages/gateway/src/index.ts
git commit -m "feat(gateway): policy-gated browser tool execution via host bridge"
```

---

### Task 7: P1 tools — click, type, scroll

**Files:**
- Modify: `apps/desktop/src/main/browser-service.ts`
- Modify: `packages/gateway/src/services/runner.test.ts` (optional)
- Modify: `packages/shared/src/browser-policy.test.ts` (already covers submit)

- [ ] **Step 1: Implement executeJavaScript helpers**

```js
// click by selector
const el = document.querySelector(selector);
if (!el) throw new Error("Selector not found");
el.scrollIntoView({ block: "center" });
el.click();

// click by coordinates (viewport)
// use document.elementFromPoint(x, y)?.click()

// type
el.focus();
el.value = text; // or InputEvent sequence
if (submit) el.form?.requestSubmit?.() || el.dispatchEvent(new KeyboardEvent(...))

// scroll
window.scrollBy(0, dy) // or el.scrollBy
```

Validate args in main: require `selector` **or** (`x` and `y`) for click; require `text` for type; `dy` or `y` for scroll.

- [ ] **Step 2: Manual smoke (dev)**

Run Desk, force FakeEngine browser scenario or unit-level `browserService.exec` with a public page (if CI lacks display, keep unit-only).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/browser-service.ts
git commit -m "feat(desktop): browser click/type/scroll tools"
```

---

### Task 8: Renderer globe + split pane (minimal UI)

**Files:**
- Create: `apps/desktop/src/renderer/lib/browser-ui.ts`
- Create: `apps/desktop/src/renderer/lib/browser-ui.test.ts`
- Create: `apps/desktop/src/renderer/components/browser-globe.tsx`
- Create: `apps/desktop/src/renderer/components/browser-pane-slot.tsx`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/lib/api.ts`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`

**Pure UI state rules (`browser-ui.ts`):**

```ts
export type BrowserUiState = {
  open: boolean;
  pinned: boolean;
  keepClosed: boolean;
};

export function reduceBrowserUi(
  state: BrowserUiState,
  event:
    | { type: "agent_browser_activity" }
    | { type: "user_toggle" }
    | { type: "user_collapse" }
    | { type: "user_pin"; pinned: boolean },
): BrowserUiState {
  switch (event.type) {
    case "agent_browser_activity":
      if (state.keepClosed) return state;
      if (state.open) return state;
      return { ...state, open: true };
    case "user_toggle":
      if (state.open) {
        return { ...state, open: false, keepClosed: true, pinned: false };
      }
      return { ...state, open: true, keepClosed: false };
    case "user_collapse":
      return { ...state, open: false, keepClosed: true, pinned: false };
    case "user_pin":
      return { ...state, pinned: event.pinned, open: event.pinned ? true : state.open };
  }
}
```

- [ ] **Step 1: Tests for reduceBrowserUi**

Cover: first activity opens; keepClosed blocks auto-open; toggle open→closed sets keepClosed; toggle closed→open clears keepClosed.

- [ ] **Step 2: Preload + api**

```ts
// preload
browser: {
  getStatus: (taskId: string) => ipcRenderer.invoke("grokdesk:browser:status", taskId),
  setBounds: (taskId: string, bounds: unknown) =>
    ipcRenderer.invoke("grokdesk:browser:setBounds", taskId, bounds),
  setVisible: (taskId: string, visible: boolean) =>
    ipcRenderer.invoke("grokdesk:browser:setVisible", taskId, visible),
  onStatus: (cb: (s: unknown) => void) => {
    const listener = (_: unknown, s: unknown) => cb(s);
    ipcRenderer.on("grokdesk:browser:status", listener);
    return () => ipcRenderer.removeListener("grokdesk:browser:status", listener);
  },
},
```

- [ ] **Step 3: BrowserGlobe component**

- Lucide `Globe` icon button
- Active dot when `status?.active || loading`
- `aria-label="Agent browser"`
- No text label

- [ ] **Step 4: BrowserPaneSlot**

Empty `div` with `ref`, `className="h-full w-1/2 min-w-0 border-l border-border/60"`, ResizeObserver → `setBounds` in **window coordinates** (use `getBoundingClientRect` + window position; main converts via `BrowserWindow.getContentBounds()` / `webContents.getOwnerBrowserWindow()`).

Main `setBounds` must translate renderer content coordinates correctly:

```ts
const win = getMainWindow();
if (!win || !bounds) { view.setVisible(false); return; }
const content = win.getContentBounds();
// If renderer sends getBoundingClientRect relative to viewport:
view.setBounds({
  x: Math.round(bounds.x),
  y: Math.round(bounds.y),
  width: Math.round(bounds.width),
  height: Math.round(bounds.height),
});
```

Electron `WebContentsView.setBounds` is relative to the window content view — `getBoundingClientRect` from the renderer matches content coordinates when not scaled oddly; verify on retina.

- [ ] **Step 5: Task workspace integration**

- Track browser UI state per `task.id` (reset on task change)
- Detect agent activity: events where `kind === "tool_request" && String(payload.tool).startsWith("browser_")`
- Header: render `<BrowserGlobe />` near existing action buttons (minimal)
- Layout: when `open`, flex row stream | pane slot ~50%
- On open/close, call `setVisible`
- On unmount / task switch, `setVisible(false)` for previous task (do not destroy — gateway owns lifecycle)

- [ ] **Step 6: Run renderer unit tests**

Run: `pnpm --filter @grokdesk/desktop test -- src/renderer/lib/browser-ui.test.ts`

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/preload/index.ts apps/desktop/src/renderer/lib/api.ts apps/desktop/src/renderer/lib/browser-ui.ts apps/desktop/src/renderer/lib/browser-ui.test.ts apps/desktop/src/renderer/components/browser-globe.tsx apps/desktop/src/renderer/components/browser-pane-slot.tsx apps/desktop/src/renderer/components/views/task-workspace-view.tsx
git commit -m "feat(desktop): globe control and half-pane agent browser shell"
```

---

### Task 9: desk-browser MCP for Grok Build

**Files:**
- Create: `apps/desktop/src/main/browser-host-server.ts`
- Create: `apps/desktop/resources/browser-mcp-server.mjs` (or `packages/desk-browser-mcp/`)
- Modify: `packages/gateway/src/index.ts` / engine MCP injection to always include desk-browser when host server is up
- Modify: `apps/desktop/src/main/index.ts` (start host server, pass port/token to gateway env)

**Why:** `GrokBuildEngine.executesOwnTools = true` — Grok must call an MCP that hits main’s BrowserService.

- [ ] **Step 1: Loopback HTTP server in main**

```ts
// POST /exec { taskId, tool, args } + header token
// POST /destroy { taskId }
// GET /health
```

Bind `127.0.0.1` only. Token = `randomBytes(24).toString("hex")`.

- [ ] **Step 2: MCP stdio server script**

Minimal MCP tools: `browser.open`, `browser.click`, `browser.type`, `browser.scroll`, `browser.screenshot`, `browser.read`.

Each tool POSTs to host server. Read `GROKDESK_BROWSER_URL` + `GROKDESK_BROWSER_TOKEN` from env.

Use `@modelcontextprotocol/sdk` if already a dependency; otherwise implement a **tiny JSON-RPC stdio MCP** subset matching what Grok expects (verify against an existing preset). Prefer reusing patterns from connector presets (command + args + env).

Example MCP config entry (written by gateway into project config):

```toml
# conceptual — match writeProjectMcpConfig shape
[mcp_servers.desk-browser]
command = "node"
args = ["<absolute path to browser-mcp-server.mjs>"]
```

Env expansion at spawn:

```
GROKDESK_BROWSER_URL=http://127.0.0.1:PORT
GROKDESK_BROWSER_TOKEN=...
```

- [ ] **Step 3: Gateway env from main**

When starting gateway child:

```ts
GROKDESK_BROWSER_URL: url,
GROKDESK_BROWSER_TOKEN: token,
GROKDESK_BROWSER_MCP_PATH: pathToMcpScript,
```

Gateway merges a built-in MCP server `desk-browser` into the engine’s mcpServers list (enabled by default).

- [ ] **Step 4: Skill hint**

In `skills/desk-defaults/SKILL.md` add 3–5 lines: for live page interaction prefer `desk-browser` / `browser.*` tools so the user can watch via the globe.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/browser-host-server.ts apps/desktop/resources/browser-mcp-server.mjs packages/gateway/src/index.ts apps/desktop/src/main/index.ts skills/desk-defaults/SKILL.md
git commit -m "feat: desk-browser MCP bridge for Grok-driven agent browser"
```

---

### Task 10: Subagent HUD (P2)

**Files:**
- Create: `apps/desktop/src/renderer/lib/subagent-hud.ts`
- Create: `apps/desktop/src/renderer/lib/subagent-hud.test.ts`
- Create: `apps/desktop/src/renderer/components/subagent-hud.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (pass sibling tasks / chat turns if needed)

- [ ] **Step 1: Pure aggregation tests**

```ts
import { buildSubagentHud } from "./subagent-hud.js";

it("hides when no children", () => {
  const hud = buildSubagentHud({
    rootId: "r",
    tasks: [{ id: "r", parentTaskId: null, status: "running", title: "Main", goal: "g" }],
    latestEventsByTaskId: {},
  });
  expect(hud).toBeNull();
});

it("counts active children and exposes current step from latest tool", () => {
  const hud = buildSubagentHud({
    rootId: "r",
    tasks: [
      { id: "r", parentTaskId: null, status: "running", title: "Main", goal: "g" },
      { id: "c1", parentTaskId: "r", status: "running", title: "Research", goal: " dig" },
      { id: "c2", parentTaskId: "r", status: "done", title: " cop", goal: "x" },
    ],
    latestEventsByTaskId: {
      c1: { kind: "tool_request", payload: { tool: "browser_open" } },
    },
  });
  expect(hud?.activeCount).toBe(1);
  expect(hud?.items).toHaveLength(2); // show non-parent children only
  expect(hud?.items[0]?.currentStep).toMatch(/browser/i);
});
```

Implement `currentStep` as:

- tool_request → tool name (humanized)
- step → title
- message assistant → truncated
- else status label

Active statuses: `queued | running | waiting_approval | waiting_user | blocked`

- [ ] **Step 2: UI component**

- If `hud == null`, render nothing
- Else small numeric badge button next to globe
- Popover/dropdown list: title · status · step
- Click row → `onFocusTask(taskId)` callback (App selects that task / scrolls stream)

Keep visual weight **below** the globe; no “3 agents running” prose.

- [ ] **Step 3: Wire data**

From `App` / workspace: for open chat, `chat.turns` may only be follow-ups, not true subagents. Prefer `tasks.filter(t => t.parentTaskId === root.id || …)` from full task list:

True subagents: `parentTaskId` points at any turn in the chat **and** goal/mode indicates parallel work. For v1, **all tasks with `parentTaskId` in the thread except pure sequential follow-ups**.

**Heuristic locked for v1:** Show children where `parentTaskId === latest.id || parentTaskId === root.id` and `id !== latest.id` of sequential follow-ups that the UI already chains.

Looking at App follow-up creation — follow-ups set `parentTaskId: base?.id`. That means **every follow-up looks like a child**. HUD would be noisy.

**Revised rule (must implement):**

```ts
/** Subagents = tasks that are running concurrently under the chat root,
 *  not sequential follow-up turns. */
export function isLikelySubagent(task: Task, siblings: Task[]): boolean {
  if (!task.parentTaskId) return false;
  // Concurrent if status is active while another sibling is also active, OR
  // title/role pack marks specialist — simplest v1:
  // Treat as subagent only if status is active AND parent is also active.
  const parent = siblings.find((s) => s.id === task.parentTaskId);
  if (!parent) return false;
  const active = new Set(["queued", "running", "waiting_approval", "waiting_user", "blocked"]);
  return active.has(task.status) && active.has(parent.status);
}
```

Also include recently finished children completed within the last 2 minutes while parent still active (optional). Document this heuristic in a code comment so it can be replaced when engine emits real subagent ids.

- [ ] **Step 4: Tests + commit**

```bash
git add apps/desktop/src/renderer/lib/subagent-hud.ts apps/desktop/src/renderer/lib/subagent-hud.test.ts apps/desktop/src/renderer/components/subagent-hud.tsx apps/desktop/src/renderer/components/views/task-workspace-view.tsx apps/desktop/src/renderer/App.tsx
git commit -m "feat(desktop): lightweight subagent HUD"
```

---

### Task 11: Stream surfacing for browser tools + i18n/aria

**Files:**
- Modify: `apps/desktop/src/renderer/lib/stream-view.ts` (label browser tools)
- Modify: `apps/desktop/src/renderer/components/task-stream.tsx` (Globe icon for browser tools if useful)
- Modify: `apps/desktop/src/renderer/lib/labels.ts` if tool labels centralized

- [ ] **Step 1: Ensure Work log shows `browser_open` as friendly “Open page”**

Map in existing tool label helpers:

| tool | label |
|------|--------|
| browser_open | Open page |
| browser_click | Click |
| browser_type | Type |
| browser_scroll | Scroll |
| browser_screenshot | Screenshot |
| browser_read | Read page |

- [ ] **Step 2: If screenshot data URL in tool_result, show inline like artifacts (optional stretch — skip if hard; stream text is enough for v1)**

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/lib/stream-view.ts apps/desktop/src/renderer/components/task-stream.tsx
git commit -m "feat(desktop): friendly labels for browser tool stream rows"
```

---

### Task 12: Integration smoke + docs

**Files:**
- Modify: `docs/superpowers/specs/2026-07-11-agent-browser-subagent-hud-design.md` (status: Implemented / partial — only if accurate)
- Create: `apps/desktop/src/main/browser-integration.smoke.test.ts` **or** document manual checklist in plan (no new md unless needed)
- Modify: `README.md` only if user-facing setup needed (usually no)

- [ ] **Step 1: Automated checks**

```bash
pnpm --filter @grokdesk/shared test
pnpm --filter @grokdesk/engine-grok test
pnpm --filter @grokdesk/gateway test
pnpm --filter @grokdesk/desktop test
pnpm --filter @grokdesk/desktop typecheck
```

Expected: all PASS

- [ ] **Step 2: Manual checklist (dev)**

1. Launch Desk with FakeEngine browser scenario or MCP mock  
2. Trigger `browser_open` → globe shows active → pane auto-opens ~50%  
3. Click globe → closes; further tools do not auto-reopen (keep closed)  
4. Click globe → opens again  
5. Cancel task → view destroyed  
6. `file://` open denied in events  
7. With two concurrent parent+child running tasks, HUD count appears  

- [ ] **Step 3: Final commit if any fixes**

```bash
git commit -m "test: agent browser and subagent HUD verification"
```

---

## Spec coverage checklist

| Spec requirement | Task(s) |
|------------------|---------|
| Agent cockpit (A) | 5–9 |
| Path to user drive (C later) | BrowserService keeps real WebContents (P4 not built) |
| Globe-only chrome | 8 |
| ~50% live pane, hybrid open | 8 (`browser-ui` reducer) |
| Isolated partition | 5 |
| Tools open/screenshot/read | 5–6 |
| Tools click/type/scroll | 7 |
| Policy Strict/Balanced/Autopilot | 2, 6 |
| Block file/private net | 1, 5 will-navigate |
| Audit via existing AuditService | 6 |
| Host execution in main | 4–5 |
| Grok MCP path | 9 |
| Subagent HUD lightweight | 10 |
| Task destroy wipe | 5–6 |
| Stream still works pane closed | 6, 11 |

## Out of plan (P3/P4)

- Tabs, wait-for, upload, multi-frame  
- User typing into the live page  
- Shared real Chrome profile  
- Per-subagent browser panes  

---

## Execution notes

- Prefer **TDD** on pure modules (Tasks 1–2, 8, 10) before UI/Electron glue.  
- BrowserService Electron APIs are awkward in CI without a display — keep pure helpers tested; smoke manually.  
- Do not expand UI chrome beyond globe + optional numeric HUD badge.  
- Path ownership for parallel agents: `shared` → `engine-grok` → `gateway` → `desktop-main` → `desktop-ui`.
