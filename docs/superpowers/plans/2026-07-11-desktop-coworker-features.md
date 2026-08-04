# Desktop Coworker Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Grok Desk feel like a seamless SuperGrok desktop coworker—usage, voice, privacy, healthy long tasks, memory automation, and Imagine deliverables—without any CLI slash-command UX.

**Architecture:** SuperGrok “rails” (billing, privacy, STT, token access) live in `packages/engine-grok` and Electron main only; tokens never enter the renderer. Gateway owns durable task/memory/schedule state. Renderer gets typed IPC + polish UI (Account usage, recovery banners, mic, chat overflow, artifacts). Prefer automation with soft toasts over power-user rituals.

**Tech Stack:** TypeScript monorepo, Electron main/preload/renderer, React, Zod IPC (`packages/shared`), gateway SQLite services, Grok Build SuperGrok session (`~/.grok/auth.json`), Vitest, i18n locale JSON.

**Product brief:** Conversation plan (usage/voice/port matrix + desktop-first ideation).  
**Related:** `docs/superpowers/specs/2026-07-10-grok-desk-design.md`

**Out of scope for this plan:** TUI-only chrome (`/vim-mode`, `/theme`, …), skill-as-slash parser, public session share (Phase 6 optional), rewriting the agent loop outside Grok Build.

---

## File structure (create / modify as phases progress)

```
packages/shared/src/
  types.ts                         # UsageSnapshot, PrivacyState, Dictation*, RecoveryKind
  ipc.ts                           # auth.usage, auth.privacy.*, dictation via main channels
  error-taxonomy.ts                # NEW: map engine error strings → RecoveryKind
  error-taxonomy.test.ts           # NEW
  settings-schema.ts               # optional prefs: autoCompact, voiceLang, endTaskRemember

packages/engine-grok/src/
  auth-bridge.ts                   # existing SuperGrok session metadata
  super-grok-token.ts              # NEW: read access token for main-only HTTP (never log)
  super-grok-token.test.ts         # NEW
  billing-client.ts                # NEW: fetch usage / open manage URL helpers
  billing-client.test.ts           # NEW
  privacy-client.ts                # NEW: get/set retention if API known; else stub + fixture
  privacy-client.test.ts           # NEW
  stt-client.ts                    # NEW: Grok STT websocket client (Phase 2)
  stt-client.test.ts               # NEW
  events.ts                        # classify error events with taxonomy hints
  events.test.ts                   # extend

packages/gateway/src/
  services/tasks.ts                # export transcript, fork metadata if needed
  services/memory.ts               # remember-from-text helper
  dispatch.ts                      # wire new IPC methods
  services/chat-export.ts          # NEW: markdown export of task events
  services/chat-export.test.ts     # NEW

apps/desktop/src/main/
  index.ts                         # mic permission handlers; NSMicrophone later
  ipc-bridge.ts                    # main-only methods: usage, privacy, dictation, openExternal
  dictation-service.ts             # NEW: owns STT session + IPC events to renderer
  super-grok-http.ts               # NEW: thin fetch with bearer from token helper

apps/desktop/src/preload/index.ts  # expose usage/privacy/dictation APIs + events

apps/desktop/src/renderer/
  lib/api.ts                       # typed wrappers
  lib/error-recovery.ts            # NEW: UI copy + CTA from RecoveryKind
  lib/error-recovery.test.ts       # NEW
  hooks/use-dictation.ts           # NEW
  components/dictation-button.tsx  # NEW
  components/usage-meter.tsx       # NEW
  components/recovery-banner.tsx   # NEW
  components/chat-actions-menu.tsx # NEW: export, compact, fork, rewind, remember
  components/command-palette.tsx   # extend with Usage, Export, Memory…
  components/views/settings/account-tab.tsx
  components/views/settings/preferences-tab.tsx  # privacy, auto-compact, voice
  components/views/home-view.tsx   # mic, soft usage when critical
  components/views/task-workspace-view.tsx       # recovery, context, actions, follow-up modes
  i18n/locales/*.json              # all new strings
  App.tsx                          # wire state + banners

apps/desktop/electron-builder.yml  # NSMicrophoneUsageDescription
apps/desktop/src/renderer/index.html  # CSP connect-src for STT/billing if ever from renderer
                                     # (prefer main-process fetch → no CSP change)

docs/superpowers/specs/
  2026-07-11-desktop-coworker-features.md  # optional: freeze product brief as spec
```

---

## Phase map

| Phase | Theme | Ships when |
|-------|--------|------------|
| **0** | SuperGrok rails foundation | Token helper + usage DTO + error taxonomy + IPC skeleton; tests green |
| **1** | Trust & recovery | Account usage UI, manage billing, limit recovery, privacy, reauth polish, export, copy |
| **2** | Speak & start fast | Dictation mic, permissions, packaging, palette entries, follow-up labels |
| **3** | Healthy long tasks | Context meter, compact, rewind, fork, rename polish |
| **4** | Coworker memory | Remember chip, end-task takeaways, background dream |
| **5** | Grok deliverables | Imagine → artifacts, plan-first, role packs polish |
| **6** | Help & migration | Feedback, docs, release notes, Claude import, tray capture |

Each phase is independently shippable. Do not start Phase N+1 until Phase N acceptance criteria pass.

---

## Phase 0 — SuperGrok rails foundation

### Task 0.1: Error taxonomy (pure)

**Files:**
- Create: `packages/shared/src/error-taxonomy.ts`
- Create: `packages/shared/src/error-taxonomy.test.ts`
- Modify: `packages/shared/src/index.ts` (export)

- [ ] **Step 1: Write failing tests**

```ts
// packages/shared/src/error-taxonomy.test.ts
import { describe, it, expect } from "vitest";
import { classifyEngineError } from "./error-taxonomy.js";

describe("classifyEngineError", () => {
  it("detects usage pool exhausted", () => {
    expect(classifyEngineError("usage_pool_exhausted: no credits")).toEqual({
      kind: "usage_exhausted",
      retryable: false,
    });
  });
  it("detects rate limit", () => {
    expect(classifyEngineError("Rate limited, try again")).toMatchObject({
      kind: "rate_limited",
      retryable: true,
    });
  });
  it("detects reauth", () => {
    expect(classifyEngineError("please log in / unauthorized")).toMatchObject({
      kind: "needs_reauth",
    });
  });
  it("defaults to generic", () => {
    expect(classifyEngineError("something weird")).toMatchObject({
      kind: "generic",
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @grokdesk/shared test -- src/error-taxonomy.test.ts
```

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/error-taxonomy.ts
export type RecoveryKind =
  | "usage_exhausted"
  | "usage_limit"
  | "rate_limited"
  | "needs_reauth"
  | "context_pressure"
  | "generic";

export interface ClassifiedError {
  kind: RecoveryKind;
  retryable: boolean;
}

export function classifyEngineError(message: string): ClassifiedError {
  const m = message.toLowerCase();
  if (/usage_pool_exhausted|out of (credits|balance)|no credits|credit limit/i.test(m)) {
    return { kind: "usage_exhausted", retryable: false };
  }
  if (/usage_limit_reached|spending cap|monthly limit/i.test(m)) {
    return { kind: "usage_limit", retryable: false };
  }
  if (/rate.?limit|too many requests|429/i.test(m)) {
    return { kind: "rate_limited", retryable: true };
  }
  if (/not logged|please\s+log\s*in|unauthorized|invalid.?token|reauth|401/i.test(m)) {
    return { kind: "needs_reauth", retryable: false };
  }
  if (/context (window|length)|maximum context|prompt too long|compact/i.test(m)) {
    return { kind: "context_pressure", retryable: true };
  }
  return { kind: "generic", retryable: false };
}
```

- [ ] **Step 4: Export from `packages/shared/src/index.ts`**

```ts
export * from "./error-taxonomy.js";
```

- [ ] **Step 5: Run tests — expect PASS; commit**

```bash
pnpm --filter @grokdesk/shared test -- src/error-taxonomy.test.ts
git add packages/shared/src/error-taxonomy.ts packages/shared/src/error-taxonomy.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): classify engine errors for desktop recovery UX"
```

---

### Task 0.2: Usage types + Zod

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/ipc.test.ts`

- [ ] **Step 1: Add types to `types.ts`**

```ts
/** SuperGrok credit/usage snapshot (Build /usage rails). Not Desk license. */
export interface UsageSnapshot {
  fetchedAt: string; // ISO
  creditUsagePercent: number | null;
  includedUsed: number | null;
  totalUsed: number | null;
  monthlyLimit: number | null;
  onDemandEnabled: boolean | null;
  onDemandUsed: number | null;
  onDemandCap: number | null;
  prepaidBalance: number | null;
  subscriptionTier: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  /** True when UI should surface a soft warning (e.g. ≥70%). */
  warnLevel: "none" | "soft" | "hard";
  rawAvailable: boolean;
}

export interface PrivacyState {
  /** Whether xAI may retain coding session data (Build /privacy). */
  codingDataSharing: boolean | null;
  /** Human label for UI */
  summary: string;
  fetchedAt: string;
}
```

- [ ] **Step 2: Add IPC methods to `IpcRequestSchema` in `ipc.ts`**

```ts
z.object({
  id: z.string(),
  method: z.literal("auth.usage"),
  params: z.object({ force: z.boolean().optional() }).default({}),
}),
z.object({
  id: z.string(),
  method: z.literal("auth.privacy.get"),
  params: z.object({}).default({}),
}),
z.object({
  id: z.string(),
  method: z.literal("auth.privacy.set"),
  params: z.object({ codingDataSharing: z.boolean() }),
}),
z.object({
  id: z.string(),
  method: z.literal("auth.openBilling"),
  params: z.object({}).default({}),
}),
z.object({
  id: z.string(),
  method: z.literal("chats.exportMarkdown"),
  params: z.object({
    taskId: z.string(),
    // root of chat thread preferred; gateway expands follow-ups
  }),
}),
```

- [ ] **Step 3: Extend `ipc.test.ts` with parse cases for `auth.usage` and `auth.openBilling`**

- [ ] **Step 4: Run shared tests; commit**

```bash
pnpm --filter @grokdesk/shared test
git add packages/shared/src/types.ts packages/shared/src/ipc.ts packages/shared/src/ipc.test.ts
git commit -m "feat(shared): SuperGrok usage/privacy IPC contracts"
```

---

### Task 0.3: SuperGrok token reader (main/engine only)

**Files:**
- Create: `packages/engine-grok/src/super-grok-token.ts`
- Create: `packages/engine-grok/src/super-grok-token.test.ts`
- Modify: `packages/engine-grok/src/index.ts`

**Security rules (non-negotiable):**
- Never return token to renderer, logs, or gateway RPC results.
- Prefer refresh-aware access: if access expired and refresh exists, call CLI refresh path or document “use CLI-refreshed key field after models probe.”
- Unit tests use temp home dirs with fixture `auth.json` only.

- [ ] **Step 1: Failing test — reads key from fixture auth.json**

```ts
// packages/engine-grok/src/super-grok-token.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readSuperGrokAccessToken } from "./super-grok-token.js";

describe("readSuperGrokAccessToken", () => {
  let home: string;
  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), "grokdesk-auth-"));
    await fs.mkdir(path.join(home, ".grok"), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  it("returns access token from key field", async () => {
    await fs.writeFile(
      path.join(home, ".grok", "auth.json"),
      JSON.stringify({
        user: {
          email: "a@b.com",
          key: "test-access-token",
          refresh_token: "refresh",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      }),
    );
    const t = await readSuperGrokAccessToken(home);
    expect(t?.accessToken).toBe("test-access-token");
    expect(t?.signedIn).toBe(true);
  });

  it("returns null when missing", async () => {
    const t = await readSuperGrokAccessToken(home);
    expect(t).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `readSuperGrokAccessToken`** (reuse ranking logic from `auth-bridge.ts` `readAuthFileMetadata` — extract shared entry picker if needed to avoid drift).

- [ ] **Step 3: Export; run tests; commit**

```bash
pnpm --filter @grokdesk/engine-grok test -- src/super-grok-token.test.ts
git commit -m "feat(engine-grok): read SuperGrok access token for main-only rails"
```

---

### Task 0.4: Billing client (usage fetch)

**Files:**
- Create: `packages/engine-grok/src/billing-client.ts`
- Create: `packages/engine-grok/src/billing-client.test.ts`

**Discovery step (do first in this task):**
- Inspect live Build billing request (proxy, or document from binary strings): path `/billing?format=credits`, headers `Authorization: Bearer …`, `x-grok-client-version`.
- Record **exact base URL** in a constant with env override `GROKDESK_BILLING_BASE_URL` for tests.
- If live endpoint is unstable, implement parser against **fixture JSON** first; live fetch behind interface `BillingHttp`.

- [ ] **Step 1: Fixture parser tests**

```ts
// billing-client.test.ts
import { describe, it, expect } from "vitest";
import { parseBillingCreditsResponse, warnLevelFromPercent } from "./billing-client.js";

const FIXTURE = {
  creditUsagePercent: 72,
  includedUsed: 720,
  totalUsed: 720,
  monthlyLimit: 1000,
  on_demand_enabled: false,
  onDemandUsed: 0,
  onDemandCap: null,
  prepaidBalance: 0,
  subscription_tier: "supergrok",
  billingPeriodStart: "2026-07-01",
  billingPeriodEnd: "2026-08-01",
};

describe("parseBillingCreditsResponse", () => {
  it("maps fixture to UsageSnapshot", () => {
    const snap = parseBillingCreditsResponse(FIXTURE, "2026-07-11T00:00:00.000Z");
    expect(snap.creditUsagePercent).toBe(72);
    expect(snap.warnLevel).toBe("soft");
    expect(snap.rawAvailable).toBe(true);
  });
});

describe("warnLevelFromPercent", () => {
  it("thresholds", () => {
    expect(warnLevelFromPercent(10)).toBe("none");
    expect(warnLevelFromPercent(70)).toBe("soft");
    expect(warnLevelFromPercent(95)).toBe("hard");
    expect(warnLevelFromPercent(null)).toBe("none");
  });
});
```

- [ ] **Step 2: Implement parse + `fetchUsageSnapshot(http, token)`**

```ts
export const BILLING_MANAGE_URL = "https://grok.com/?_s=usage";

export function warnLevelFromPercent(p: number | null): UsageSnapshot["warnLevel"] {
  if (p == null || Number.isNaN(p)) return "none";
  if (p >= 90) return "hard";
  if (p >= 70) return "soft";
  return "none";
}

export function parseBillingCreditsResponse(
  raw: Record<string, unknown>,
  fetchedAt: string,
): UsageSnapshot {
  const num = (k: string) => {
    const v = raw[k] ?? raw[snake(k)];
    return typeof v === "number" ? v : v == null ? null : Number(v);
  };
  // implement snake/camel tolerant reads for fields listed in types
  const creditUsagePercent = num("creditUsagePercent");
  return {
    fetchedAt,
    creditUsagePercent,
    includedUsed: num("includedUsed"),
    totalUsed: num("totalUsed"),
    monthlyLimit: num("monthlyLimit"),
    onDemandEnabled: bool(raw, "onDemandEnabled", "on_demand_enabled"),
    onDemandUsed: num("onDemandUsed"),
    onDemandCap: num("onDemandCap"),
    prepaidBalance: num("prepaidBalance"),
    subscriptionTier: str(raw, "subscriptionTier", "subscription_tier"),
    billingPeriodStart: str(raw, "billingPeriodStart", "billingPeriodStart"),
    billingPeriodEnd: str(raw, "billingPeriodEnd", "billingPeriodEnd"),
    warnLevel: warnLevelFromPercent(creditUsagePercent),
    rawAvailable: true,
  };
}
```

- [ ] **Step 3: `fetchUsageSnapshot` with injectable `fetch`** — unit test with mock fetch returning FIXTURE.

- [ ] **Step 4: Commit**

```bash
pnpm --filter @grokdesk/engine-grok test -- src/billing-client.test.ts
git commit -m "feat(engine-grok): SuperGrok billing usage client"
```

---

### Task 0.5: Wire usage through main IPC (not gateway)

Usage needs the SuperGrok bearer → **main process**, not the gateway child (gateway must not hold tokens).

**Files:**
- Create: `apps/desktop/src/main/super-grok-http.ts`
- Modify: `apps/desktop/src/main/ipc-bridge.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/lib/api.ts`

- [ ] **Step 1: In `ipc-bridge.ts`, intercept before gateway:**

```ts
if (method === "auth.usage") {
  const snap = await fetchUsageForUi(Boolean(params.force));
  return { ok: true, result: snap };
}
if (method === "auth.openBilling") {
  await shell.openExternal(BILLING_MANAGE_URL);
  return { ok: true, result: { opened: true } };
}
```

- [ ] **Step 2: Cache usage 60s in main module scope; `force: true` bypasses.**

- [ ] **Step 3: Preload already routes `request()` — ensure methods work via existing `grokdesk.request`.**

- [ ] **Step 4: Add renderer helpers:**

```ts
// api.ts
export async function getUsage(force = false) {
  return request<UsageSnapshot>("auth.usage", { force });
}
export async function openBilling() {
  return request<{ opened: boolean }>("auth.openBilling", {});
}
```

- [ ] **Step 5: Manual smoke: sign in SuperGrok, call from DevTools or a temporary Settings button.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(desktop): auth.usage and openBilling via main SuperGrok rails"
```

**Phase 0 acceptance:** Shared taxonomy + usage types tests pass; fixture billing parse works; signed-in app can fetch usage without crashing when offline (return `rawAvailable: false` + empty fields).

---

## Phase 1 — Trust & recovery

### Task 1.1: Usage meter + Account tab

**Files:**
- Create: `apps/desktop/src/renderer/components/usage-meter.tsx`
- Modify: `apps/desktop/src/renderer/components/views/settings/account-tab.tsx`
- Modify: `apps/desktop/src/renderer/components/views/settings-view.tsx` (load usage)
- Modify: `apps/desktop/src/renderer/i18n/locales/en.json` (+ other locales with English fallback ok initially, then translate)

- [ ] **Step 1: `UsageMeter` presentational component** — percent bar, “72% of monthly credits”, Manage button, Refresh.

- [ ] **Step 2: Account tab** — if signed in, show meter; if `rawAvailable === false`, “Usage unavailable — open billing on the web”; never show Desk license here.

- [ ] **Step 3: i18n keys** under `settings.usage*` and `settings.manageBilling`.

- [ ] **Step 4: Manual test both signed-out and signed-in.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(desktop): SuperGrok usage meter on Account settings"
```

---

### Task 1.2: Recovery banner in workspace

**Files:**
- Create: `apps/desktop/src/renderer/lib/error-recovery.ts`
- Create: `apps/desktop/src/renderer/lib/error-recovery.test.ts`
- Create: `apps/desktop/src/renderer/components/recovery-banner.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (pass handlers)

- [ ] **Step 1: Map `RecoveryKind` → title, body, CTAs**

```ts
export function recoveryCopy(kind: RecoveryKind, t: TFunction): {
  title: string;
  body: string;
  primary?: { label: string; action: "openBilling" | "signIn" | "retry" | "export" };
  secondary?: { label: string; action: "openUsage" | "dismiss" };
} { /* ... */ }
```

- [ ] **Step 2: When latest task error classifies non-generic, show `RecoveryBanner` above follow-up.**

- [ ] **Step 3: Wire CTAs to `openBilling`, `auth.signIn`, reload usage.**

- [ ] **Step 4: Unit test copy mapping; commit**

```bash
git commit -m "feat(desktop): in-app recovery for usage and reauth failures"
```

---

### Task 1.3: Privacy settings

**Files:**
- Create: `packages/engine-grok/src/privacy-client.ts` (+ tests with mock HTTP)
- Modify: main IPC intercept `auth.privacy.get` / `auth.privacy.set`
- Modify: `preferences-tab.tsx` or new section under Account / Security

- [ ] **Step 1: Spike live `/privacy` API shape from Build (same discovery as billing).**  
  If only TUI-local for now: store preference in Desk `settings` as `codingDataSharing` **and** document “sync to Build when API available”; do not fake server success.

- [ ] **Step 2: UI toggle with plain language** (not “ZDR” jargon). Default leave server value unchanged until user toggles.

- [ ] **Step 3: Tests + commit**

```bash
git commit -m "feat(desktop): privacy / coding data sharing control"
```

---

### Task 1.4: Reauth banner (app-level)

**Files:**
- Modify: `App.tsx` or topbar
- Use existing `auth.needsReauth` / `engineStatus`

- [ ] **Step 1: Persistent but dismissible banner when `needsReauth`:** “Sign in again to keep working.”

- [ ] **Step 2: Primary → `auth.signIn`; do not clear running task list on reauth.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(desktop): reauth banner with one-click SuperGrok sign-in"
```

---

### Task 1.5: Export chat markdown

**Files:**
- Create: `packages/gateway/src/services/chat-export.ts`
- Create: `packages/gateway/src/services/chat-export.test.ts`
- Modify: `packages/gateway/src/dispatch.ts` — handle `chats.exportMarkdown`
- Modify: renderer chat actions + reveal file

- [ ] **Step 1: Pure export function**

```ts
export function eventsToMarkdown(opts: {
  title: string;
  goal: string;
  events: Array<{ type: string; payload: Record<string, unknown>; createdAt: string }>;
}): string {
  // # title, goal, then chronological user/assistant text channels only
}
```

- [ ] **Step 2: Gateway writes under task workspace `exports/chat-<id>-<date>.md` or user Downloads via main dialog — prefer workspace for coworker model.

- [ ] **Step 3: UI: ⋯ menu “Save conversation…” → export → `reveal` path.

- [ ] **Step 4: Tests with fixture events; commit**

```bash
git commit -m "feat(gateway): export chat thread to markdown"
```

---

### Task 1.6: Copy last assistant answer

**Files:**
- Modify: `task-stream.tsx` / stream block components
- Use `navigator.clipboard.writeText`

- [ ] **Step 1: Hover action on assistant text blocks: Copy.**

- [ ] **Step 2: Toast “Copied”.**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(desktop): copy assistant message blocks"
```

**Phase 1 acceptance:** User can see usage, open billing, recover from limit/reauth in UI, export a chat, copy answers—without CLI.

---

## Phase 2 — Speak & start fast

### Task 2.1: Mic permissions + packaging

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/electron-builder.yml`

- [ ] **Step 1: Permission handlers**

```ts
session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
  if (permission === "media" || permission === "mediaKeySystem") {
    callback(true);
    return;
  }
  callback(false);
});
session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
  return permission === "media";
});
```

- [ ] **Step 2: macOS `extendInfo.NSMicrophoneUsageDescription`**

```yaml
# electron-builder.yml under mac.extendInfo
NSMicrophoneUsageDescription: Grok Desk uses the microphone for voice dictation of goals and follow-ups.
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(desktop): microphone permissions and macOS usage description"
```

---

### Task 2.2: STT client (Grok rails)

**Files:**
- Create: `packages/engine-grok/src/stt-client.ts`
- Create: `packages/engine-grok/src/stt-client.test.ts`
- Create: `apps/desktop/src/main/dictation-service.ts`

**Discovery:** From Build `xai-grok-voice`: `VoiceConfig`, `stt_ws_path`, events `Partial` / `Done` / `Error`, PCM format/rate. Document constants in `stt-client.ts` header comment. Env override for endpoint in tests.

- [ ] **Step 1: Protocol unit tests with mock WebSocket** (partial → final).

- [ ] **Step 2: `DictationSession` API:**

```ts
interface DictationSession {
  start(opts: { language: string }): Promise<void>;
  pushPcm(chunk: Buffer): void;
  stop(): Promise<string>; // final transcript
  onPartial(cb: (text: string) => void): void;
  onError(cb: (err: Error) => void): void;
}
```

- [ ] **Step 3: Main `dictation-service` IPC:**

```
dictation:start → { ok }
dictation:stop → { text }
event dictation:partial { text }
event dictation:state { state: 'idle'|'listening'|'error', message? }
```

- [ ] **Step 4: Renderer captures mic via `getUserMedia`, downsamples/encodes to required PCM, sends chunks via IPC (or capture in main if using native addon later—start with renderer capture + IPC chunks).

- [ ] **Step 5: SuperGrok gate — if not signed in, UI prompts sign-in (mirror `/voice requires SuperGrok`).

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(desktop): Grok STT dictation session (main + client)"
```

---

### Task 2.3: Dictation UI on composers

**Files:**
- Create: `apps/desktop/src/renderer/hooks/use-dictation.ts`
- Create: `apps/desktop/src/renderer/components/dictation-button.tsx`
- Modify: `home-view.tsx`, `task-workspace-view.tsx`
- i18n strings

- [ ] **Step 1: Hook** — start/stop, append transcript to controlled value with spacing rules.

- [ ] **Step 2: Button states** — idle / listening (pulse) / denied / unsupported.

- [ ] **Step 3: Place on Home compose toolbar and follow-up row.**

- [ ] **Step 4: Manual test on macOS; Windows smoke if available.**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(desktop): voice dictation on Home and follow-up composers"
```

---

### Task 2.4: Command palette + follow-up clarity

**Files:**
- Modify: `command-palette.tsx`
- Modify: follow-up chrome in `task-workspace-view.tsx`

- [ ] **Step 1: Palette actions:** Open usage, Manage billing, New task, Memory, Export current chat, Toggle dictation (if focused).

- [ ] **Step 2: When task running, label follow-up:** “Add a note (continues after)” vs cancel—use existing follow-up semantics; improve copy only.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(desktop): command palette SuperGrok actions and clearer follow-ups"
```

**Phase 2 acceptance:** Mic → text in goal box while signed in; denied/unsigned states are clear; no token leakage in renderer DevTools network (STT from main).

---

## Phase 3 — Healthy long tasks

### Task 3.1: Chat actions menu shell

**Files:**
- Create: `apps/desktop/src/renderer/components/chat-actions-menu.tsx`
- Wire on workspace header

Actions: Save conversation, Make room (compact), Continue from message (rewind—Phase 3.3), Try another approach (fork), Rename.

- [ ] Implement menu + i18n; export already wired. Commit.

---

### Task 3.2: Context health + auto-compact preference

**Files:**
- Extend engine event parsing if Build emits context %; else heuristic from event count / char budget.
- Settings: `autoCompactEnabled` default true in `settings-schema.ts` + gateway settings service.
- Soft toast when compact runs (if engine auto-compacts, detect `auto_compact_*` stream types already ignored—surface as status toast instead of silence).

- [ ] **Step 1: Prefer real signals; document fallback heuristic.**

- [ ] **Step 2: Small indicator in workspace chrome when warn.**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(desktop): context health indicator and auto-compact preference"
```

---

### Task 3.3: Manual compact

**Depends on:** Grok Build exposing compact for headless/session. If only TUI:

- Option A: spawn one-shot CLI compact for session id if supported.
- Option B: Desk-side “summarize earlier events into memory + trim UI history” without engine compact (label honestly: “Summarize thread in Desk”).

- [ ] Spike first; implement the path that does not corrupt engine session.

- [ ] Commit with spike notes in PR body.

---

### Task 3.4: Rewind

**Files:**
- Gateway: mark events after seq as discarded; prevent follow-up from including discarded turns in engine resume if applicable.
- UI: “Continue from here” on user message.

- [ ] **Step 1: Data model** — `events.discarded` or soft-delete after seq; tests.

- [ ] **Step 2: Confirm dialog once.**

- [ ] **Step 3: New follow-up task rooted after rewind point (simplest correct model: create follow-up with goal = selected user text + note, and hide discarded in UI).

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): rewind chat to a prior user turn"
```

---

### Task 3.5: Fork chat

**Files:**
- Gateway: `chats.fork` copies event prefix to new root task id + new workspace copy policy.
- UI: “Try another approach”.

- [ ] Tests for fork isolation (parent unchanged).

- [ ] Commit

```bash
git commit -m "feat(gateway): fork chat thread from shared history prefix"
```

---

### Task 3.6: Rename polish

**Already have `tasks.setTitle`.** Ensure double-click title + menu rename; auto-title only when user never renamed.

- [ ] Commit if gaps fixed.

**Phase 3 acceptance:** Long chat can be exported, forked, rewound, and shows context pressure without CLI.

---

## Phase 4 — Coworker memory automation

### Task 4.1: Remember chip

**Files:**
- Modify stream blocks + `memory.create` IPC (existing)
- “Remember” on assistant block → prefill Memory add with selection

- [ ] One-click save with optional edit dialog.

- [ ] Commit

```bash
git commit -m "feat(desktop): remember chip on assistant answers"
```

---

### Task 4.2: End-of-task takeaways

**Files:**
- On task `done`, if duration/events above threshold, modal or bottom sheet: “Save takeaways?” with 2–3 LLM or heuristic bullets.
- Prefer gateway job using lightweight summary via engine **or** extract last assistant summary paragraph if no extra call desired for v1.

- [ ] Default: show for tasks > N tool events; Settings to disable.

- [ ] Commit

```bash
git commit -m "feat(desktop): optional end-of-task memory takeaways"
```

---

### Task 4.3: Background organize (dream)

**Files:**
- Gateway proactivity or scheduled internal job when idle + setting on.
- Deduplicate memory titles; no user modal required; inbox item “Memories organized” optional.

- [ ] Commit

```bash
git commit -m "feat(gateway): background memory consolidation when enabled"
```

**Phase 4 acceptance:** User can grow memory without opening Memory view every time.

---

## Phase 5 — Grok deliverables & plan

### Task 5.1: Imagine as artifact action

**Files:**
- UI: “Create image” from Home idea or workspace action → creates task goal template: `Generate an image: … Save to ./artifacts/`
- Or dedicated IPC if Build has non-agent Imagine API — prefer agent goal for consistency with tools.

- [ ] Ensure artifacts view picks up media (existing filters).

- [ ] Commit

```bash
git commit -m "feat(desktop): Imagine entry points that produce workspace artifacts"
```

---

### Task 5.2: Imagine video

- Same as 5.1 with longer-running messaging + notification on complete (`notifyNeedsYou` / tray).

- [ ] Commit

```bash
git commit -m "feat(desktop): short video generation as long-running deliverable"
```

---

### Task 5.3: Plan-first mode

- When goal length/complexity heuristic high **or** user toggles “Plan first”, start task with plan-mode system preamble / engine flag if available.
- Show plan card in rail; Approve → continue.

- [ ] Spike engine plan support; degrade to “ask Grok to write a plan first” goal rewrite.

- [ ] Commit

```bash
git commit -m "feat(desktop): plan-first flow for large goals"
```

---

### Task 5.4: Role packs polish

**Files:** already `role-packs.ts` — ensure Home/Settings one-click applies skills + defaults without jargon.

- [ ] Commit if UX gaps remain.

**Phase 5 acceptance:** Non-CLI user can produce image/video deliverables and optional plans from the desk UI.

---

## Phase 6 — Help, migration, tray

### Task 6.1: Help menu

- Docs → `https://docs.x.ai/build/overview` via `shell.openExternal`
- What’s new → local markdown or release notes URL
- Send feedback → mailto or Build feedback endpoint if documented

- [ ] Commit

```bash
git commit -m "feat(desktop): help docs feedback and release notes entry points"
```

---

### Task 6.2: Import Claude connectors (optional)

- Read `~/.claude` MCP config; map into Desk connector presets (user confirms).

- [ ] Commit

```bash
git commit -m "feat(desktop): import MCP connectors from Claude config"
```

---

### Task 6.3: Tray quick dictate (optional)

- Tray menu “Dictate a goal…” → floating mini composer + STT → `tasks.create`

- [ ] Commit

```bash
git commit -m "feat(desktop): tray quick voice capture for new goals"
```

---

## Cross-cutting standards (every phase)

### Security
- Tokens only in main / engine-grok helpers; never in renderer state, never in gateway logs.
- Redact Authorization headers in any debug logging (`redact.ts` patterns).

### i18n
- All user strings in `en.json` first; other locales: copy English then translate in a dedicated pass per phase.

### Testing
- Unit tests for pure parsers/taxonomy/export.
- Component tests optional; prefer vitest for logic.
- Manual checklist per phase on macOS (Windows for mic/permissions when packaging).

### Packaging
- Re-run `apps/desktop` packaging smoke tests after electron-builder.yml changes.
- `pnpm test` at repo root before phase merge.

### Commits
- Conventional commits: `feat(desktop)|feat(gateway)|feat(engine-grok)|feat(shared)|fix:…`
- One logical feature per commit where practical.

---

## Suggested execution order (first sprint)

1. Tasks **0.1 → 0.5** (foundation)  
2. Tasks **1.1 → 1.2 → 1.4 → 1.5 → 1.6** (usage + recovery + export + copy)  
3. Task **1.3** privacy when API confirmed  
4. Tasks **2.1 → 2.3** voice  

That first sprint alone delivers the “desktop instead of CLI” feel for account health and input.

---

## Acceptance criteria (whole program)

A user who never uses the terminal can:

1. See SuperGrok usage and manage billing in Settings.  
2. Recover from credit/reauth failures inside the task UI.  
3. Dictate goals and follow-ups with Grok STT.  
4. Export and copy work; rewind/fork long chats.  
5. Grow memory with Remember / takeaways.  
6. Produce Imagine artifacts from the UI.  
7. Never need to know `/usage`, `/voice`, `/export`, or `/compact`.

---

## Self-review checklist

| Spec theme | Tasks |
|------------|--------|
| Usage + manage billing | 0.2–0.5, 1.1–1.2 |
| Voice / Grok STT | 2.1–2.3 |
| Privacy | 1.3 |
| Error recovery | 0.1, 1.2, 1.4 |
| Export / copy | 1.5, 1.6 |
| Context / compact | 3.2, 3.3 |
| Rewind / fork | 3.4, 3.5 |
| Remember / flush / dream | 4.1–4.3 |
| Imagine / video / plan | 5.1–5.3 |
| Help / import / tray | 6.x |
| No slash-command UX | Enforced throughout (palette labels only) |
| Token safety | 0.3, 0.5, 2.2 security notes |

**Open spikes (must resolve before coding dependent tasks):**
- Exact billing HTTP URL + response schema (0.4)  
- Privacy API availability (1.3)  
- STT websocket URL + PCM format (2.2)  
- Headless compact/rewind engine support (3.3–3.4)

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-11-desktop-coworker-features.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

**Which approach?** Start with Phase 0 Task 0.1 unless you want a short product spec doc frozen first (`docs/superpowers/specs/2026-07-11-desktop-coworker-features.md`).
