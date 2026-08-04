# CLI Feature Port Wave ("Sticky + Magic") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port 13 Grok Build CLI capabilities into Grok Desk per `docs/superpowers/specs/2026-07-15-cli-feature-port-design.md`: ACP-default engine, session resume, sleep/wake auth safety, honest effort/permission flags (Phase A); plan-first, nudge-while-working, context meter, undo-turn (Phase B); media artifacts, citation cards, mermaid, weekly recap (Phase C).

**Architecture:** The gateway flips its default engine from headless `grok -p` spawn to the ACP path (`grok agent stdio`) whenever the CLI probe supports it, with per-task headless fallback. ACP gives structured `session/update` events (`tool_call`, `plan`) and `session/request_permission`, which feed the existing parked-approval pipeline and the calm-stream conversation UI that landed with conversation-orchestration. New `NormalizedEngineEvent` variants (`session_meta`, `plan_update`, `usage`, `citations`) carry the new signals from provider → runner → renderer projector.

**Tech Stack:** TypeScript pnpm monorepo, vitest, Electron (`apps/desktop`), gateway daemon (`packages/gateway`), engine adapter (`packages/engine-grok`), ACP provider (`packages/provider-grok`), shared contracts (`packages/shared`). CLI reference clone at `/tmp/grok-build` (re-clone with `git clone --depth 1 https://github.com/xai-org/grok-build.git /tmp/grok-build` if missing).

---

## Current state (verified 2026-07-16 on main)

| Spec item | Status today | Evidence |
|---|---|---|
| A1 ACP default | DONE (opt-in via `GROKDESK_PROVIDER_ENGINE=1` + `GROKDESK_ACP=1`) | `packages/gateway/src/services/engine-selection.ts:48-55` |
| A2 Session resume | DONE (DB columns + `resumeSession()` exist; never called; headless `end` event dropped) | `packages/gateway/src/services/agent-provider-engine.ts:158-172`, `packages/engine-grok/src/events.ts:46-54` |
| A3 Sleep/wake | DONE | no `powerMonitor` usage in `apps/desktop/src/main/` |
| A4 Effort/model | DONE (3-level effort; `models-list.ts` live endpoint exists) | `packages/shared/src/policy-to-grok-flags.ts:7-11` |
| A5 Strict semantics | DONE (`strict` → `--permission-mode plan`) | `packages/shared/src/policy-to-grok-flags.ts:64-66` |
| B1-B4 | DONE (core) | zero matches for plan mode / interject / compact / rewind |
| C1 Media | DONE (artifact harvest ready; no media tool detection) | `packages/gateway/src/services/runner.ts:1333-1354` |
| C2 Citations, C3 Mermaid | DONE | zero matches |
| C4 Weekly recap | DEFERRED (stretch) (`packages/shared/src/takeaways.ts` foundation) | no scheduler wiring |
| Worker events / calm stream | DONE (orchestration landed) | `packages/shared/src/types.ts:85-100`, `apps/desktop/src/renderer/lib/conversation-projector.ts` |
| Commerce program | No conflict (entitlements gate app access, not model/effort) | `docs/superpowers/specs/2026-07-16-commerce-entitlements-runtime-updates-design.md` |

## Key protocol facts (from `/tmp/grok-build`)

- Headless `streaming-json` emits only `text`, `thought`, `end`, `error`. The `end` event carries `sessionId` and `usage`/`modelUsage`. Resume with `-r/--resume <id>`.
- ACP `session/update` carries `sessionUpdate`: `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`.
- Plan mode over ACP is a **session mode**: `session/set_mode` with mode id `"plan"` / `"default"` (also ext `x.ai/toggle_plan_mode {sessionId}`). Exit arrives as an `exit_plan_mode` tool permission request; plan file lives at `~/.grok/sessions/<encoded-cwd>/<session-id>/plan.md`.
- Extension methods (discover actual set from `initialize` response; treat as non-exhaustive): `x.ai/session/interjection`, `x.ai/interject`, `x.ai/queue/interject {sessionId,id,expectedVersion,newText?}`, `x.ai/compact_conversation`, `x.ai/rewind/points`, `x.ai/rewind/execute`, `x.ai/models/update` (notification), `x.ai/memory/flush`, `x.ai/recap`.
- Permission rules: `--allow` / `--deny` with `ToolPrefix(glob)` syntax — prefixes `Bash(...)`, `Edit(...)`, `Write(...)`, `Read(...)`, `WebFetch(...)`. Tool removal: `--tools` (allowlist) / `--disallowed-tools` (denylist), comma-separated internal tool ids — shell is `run_terminal_cmd`, web is `web_search,web_fetch`. Deny beats allow; `--disallowed-tools` beats `--tools`.
- Effort canonical levels: `none, minimal, low, medium, high, xhigh, max` (`max` = alias of `xhigh`).

---

## File structure

**Created:**

| Path | Responsibility |
|---|---|
| `packages/gateway/src/services/acp-transport-factory.ts` | Build live `grok agent stdio` transport factory from binary discovery + probe |
| `packages/gateway/src/services/power-state.ts` | Pure suspend/resume state machine gating scheduler + auth refresh |
| `apps/desktop/src/main/power-monitor.ts` | Electron `powerMonitor` wiring → gateway power-state |
| `packages/gateway/src/services/weekly-recap.ts` | Build recap inbox item from takeaways/memory (stretch) |
| `apps/desktop/src/renderer/components/conversation/plan-card.tsx` | Plan review card (Approve / Request changes / Run anyway) |
| `apps/desktop/src/renderer/components/context-meter.tsx` | Thin context-usage meter + "Summarize so far" chip |
| `apps/desktop/src/renderer/components/conversation/citation-cards.tsx` | Answer-footer source cards |
| `apps/desktop/src/renderer/components/ui/mermaid-block.tsx` | Mermaid fence → inline SVG (sanitized) with source toggle |

**Modified (main ones):** `packages/shared/src/types.ts` (effort levels, task planFirst, event payload types), `packages/shared/src/policy-to-grok-flags.ts`, `packages/engine-grok/src/types.ts` (event union), `packages/engine-grok/src/events.ts`, `packages/engine-grok/src/session.ts` (`--resume`), `packages/provider-grok/src/acp-session.ts` (plan/interject/compact/rewind/citations), `packages/provider-grok/src/acp-transport.ts` (spawn gate), `packages/gateway/src/services/engine-selection.ts` (default flip), `packages/gateway/src/services/agent-provider-engine.ts` (resume + fallback + new event mapping), `packages/gateway/src/provider-composition.ts`, `packages/gateway/src/index.ts` (composition), `packages/gateway/src/services/runner.ts` (persist session id / usage / citations), `packages/gateway/src/services/tasks-core-dispatch.ts` (new RPCs), `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx`, `apps/desktop/src/renderer/components/ui/markdown.tsx`, `apps/desktop/src/renderer/components/views/task-workspace-view.tsx` (composer), i18n locales.

**Task order & dependencies:** 1 → 2 (independent of 3-5) ; 3 → 4 → 5 ; 6 independent ; 7 → 8 ; 9, 10, 11 need 4 ; 12, 13 need 4 ; 14 independent ; 15 needs takeaways only ; 16 last. Phase B (7-11) and Phase C (12-15) can run in parallel once 4 lands.

---

## Phase A — Invisible reliability

### Task 1: Effort catalog — add `max` level

**Files:**
- Modify: `packages/shared/src/types.ts:43`
- Modify: `packages/shared/src/policy-to-grok-flags.ts:7-11`
- Test: `packages/shared/src/policy-to-grok-flags.test.ts`
- Modify: `apps/desktop/src/renderer/i18n/locales/*.json` (7 files)

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/policy-to-grok-flags.test.ts` (mirror the existing effort case style in that file):

```ts
it("maps max effort to xhigh reasoning", () => {
  const args = policyToGrokArgs({
    policy: {
      version: "1",
      approvalMode: "balanced",
      workspaceRoots: ["/w"],
      allowShell: true,
      allowNetworkTools: true,
    } as PolicySnapshot,
    effort: "max",
    primaryCwd: "/w",
  });
  const i = args.indexOf("--reasoning-effort");
  expect(i).toBeGreaterThan(-1);
  expect(args[i + 1]).toBe("xhigh");
});
```

If the existing tests build `PolicySnapshot` through a helper, reuse that helper instead of the inline literal.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @grokdesk/shared test -- policy-to-grok-flags`
Expected: FAIL — TS error `'"max"' is not assignable to type 'EffortLevel'` (compile-time failure counts).

- [ ] **Step 3: Implement**

`packages/shared/src/types.ts:43`:

```ts
export const EFFORT_LEVELS = ["fast", "normal", "heavy", "max"] as const;
```

`packages/shared/src/policy-to-grok-flags.ts:7-11`:

```ts
const EFFORT_TO_REASONING: Record<EffortLevel, string> = {
  fast: "low",
  normal: "medium",
  heavy: "high",
  max: "xhigh",
};
```

- [ ] **Step 4: Run shared + gateway + desktop tests to catch exhaustiveness breaks**

Run: `pnpm --filter @grokdesk/shared test && pnpm --filter @grokdesk/gateway test && pnpm --filter @grokdesk/desktop test`
Expected: PASS, except any `Record<EffortLevel, …>` or switch over `EFFORT_LEVELS` that now misses `max` — fix each site the compiler/tests flag by adding a `max` entry (label: "Max").

- [ ] **Step 5: Add UI labels**

Run: `grep -rn '"heavy"' apps/desktop/src/renderer/i18n/locales/en.json`
Expected: one hit inside an effort-labels object. Add a sibling `"max"` key to the same object in all 7 locales:

en `"Max"` · de `"Max"` · es `"Máx"` · fr `"Max"` · ja `"最大"` · pt `"Máx"` · zh `"最大"`

Then run: `grep -rn "EFFORT_LEVELS" apps/desktop/src/renderer/ --include="*.tsx" -l` and open each hit to confirm the effort selector iterates `EFFORT_LEVELS` (renders the 4th option automatically). If any site hard-codes three options, extend it the same way the other three are declared.

- [ ] **Step 6: Live model catalog (spec A4, second half)**

Confirm the renderer picker is fed by the gateway RPC, not a hard-coded list:

Run: `grep -rn "models.list\|modelsList\|buildModelsListResponse" apps/desktop/src/renderer/lib/api.ts packages/gateway/src/services/license-meta-dispatch.ts`
Expected: `license-meta-dispatch.ts:52` builds the response from auth-session state (live list with `grok-4.5` fallback — `packages/gateway/src/services/models-list.ts`), and the renderer api exposes it. If the renderer picker instead reads a local constant, switch it to the RPC result.

Then align the provider stub: `GrokAgentProvider.listModels()` (`packages/provider-grok/src/provider.ts:75-90`) hard-codes two models. Add an optional `models?: () => Promise<ModelDescriptor[]>` to `GrokAgentProviderOptions`, return it when supplied, keep the hard-coded pair as offline fallback, and pass a source backed by the same auth-session list from the gateway composition root (where `createDefaultProviderRegistry` is called). Test: provider returns injected list; falls back when the source throws.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src packages/provider-grok packages/gateway apps/desktop/src/renderer
git commit -m "feat(engine): add max effort level mapped to xhigh, live model catalog"
```

### Task 2: Honest permission flags (strict semantics fix)

**Files:**
- Modify: `packages/shared/src/policy-to-grok-flags.ts:53-79`
- Test: `packages/shared/src/policy-to-grok-flags.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("strict maps to default mode with side-effect deny rules (not plan mode)", () => {
  const args = policyToGrokArgs({
    policy: strictPolicy(), // reuse/adjust existing helper; approvalMode: "strict"
    primaryCwd: "/w",
  });
  expect(args).not.toContain("plan");
  const i = args.indexOf("--permission-mode");
  expect(args[i + 1]).toBe("default");
  expect(args.join(" ")).toContain('--deny Write');
  expect(args.join(" ")).toContain('--deny Edit');
  expect(args.join(" ")).toContain('--deny Bash');
});

it("disallows real CLI tool ids instead of provisional deny tokens", () => {
  const args = policyToGrokArgs({
    policy: { ...balancedPolicy(), allowShell: false, allowNetworkTools: false },
    primaryCwd: "/w",
  });
  expect(args.join(" ")).not.toContain("--deny shell");
  expect(args.join(" ")).not.toContain("--deny network");
  const i = args.indexOf("--disallowed-tools");
  expect(args[i + 1]).toBe("run_terminal_cmd,web_search,web_fetch");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @grokdesk/shared test -- policy-to-grok-flags`
Expected: FAIL — strict still yields `plan`; deny tokens still `shell`/`network`.

- [ ] **Step 3: Implement**

Replace the `switch` + deny block in `policy-to-grok-flags.ts`:

```ts
  switch (policy.approvalMode) {
    case "autopilot":
      // Never pass --always-approve when shell is disallowed — would override deny intent.
      if (policy.allowShell) {
        args.push("--always-approve");
      }
      args.push("--permission-mode", "bypassPermissions");
      break;
    case "balanced":
      args.push("--permission-mode", "default");
      break;
    case "strict":
      // Headless cannot prompt, so strict = read-only research mode: deny all
      // side-effect tool invocations outright. The ACP path replaces this with
      // broker-mediated ask-per-request (see provider-grok acp-session).
      args.push("--permission-mode", "default");
      args.push("--deny", "Write", "--deny", "Edit", "--deny", "Bash");
      break;
  }

  const disallowedTools: string[] = [];
  if (!policy.allowShell) disallowedTools.push("run_terminal_cmd");
  if (!policy.allowNetworkTools) disallowedTools.push("web_search", "web_fetch");
  if (disallowedTools.length) {
    args.push("--disallowed-tools", disallowedTools.join(","));
  }
```

Update the file's doc comment: delete the `strict → plan` caveat lines (17-28) and replace with the strict-headless-is-read-only note above.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @grokdesk/shared test && pnpm --filter @grokdesk/engine-grok test`
Expected: PASS. If any engine-grok test asserts the old `--permission-mode plan` or `--deny shell` argv, update those assertions to the new flags — they encoded the dishonest mapping.

- [ ] **Step 5: Commit**

```bash
git add packages/shared packages/engine-grok
git commit -m "fix(policy): honest strict semantics — deny rules, not plan mode"
```

### Task 3: Live ACP stdio transport factory

**Files:**
- Modify: `packages/provider-grok/src/acp-transport.ts:106-124` (spawn gate)
- Create: `packages/gateway/src/services/acp-transport-factory.ts`
- Test: `packages/gateway/src/services/acp-transport-factory.test.ts`

- [ ] **Step 1: Relax the env-only spawn gate to an explicit opt-in param**

In `acp-transport.ts`, change `spawnAcpLineTransport`:

```ts
export function spawnAcpLineTransport(opts: {
  binary: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Composition roots that verified probe support pass true; otherwise env-gated. */
  allowSpawn?: boolean;
}): AcpLineTransport {
  if (!opts.allowSpawn && process.env.GROKDESK_ACP !== "1") {
    throw new Error(
      "ACP stdio not enabled — set GROKDESK_ACP=1, pass allowSpawn, or inject a test transport factory",
    );
  }
  // …rest unchanged
```

Run: `pnpm --filter @grokdesk/provider-grok test`
Expected: PASS (default behavior unchanged for existing callers).

- [ ] **Step 2: Write the failing factory test**

`packages/gateway/src/services/acp-transport-factory.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createLiveAcpTransportFactory } from "./acp-transport-factory.js";

describe("createLiveAcpTransportFactory", () => {
  it("returns null when binary discovery fails", async () => {
    const factory = await createLiveAcpTransportFactory({
      findBinary: async () => null,
      probe: async () => {
        throw new Error("unreachable");
      },
    });
    expect(factory).toBeNull();
  });

  it("returns null when probe lacks agent stdio", async () => {
    const factory = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => ({ supportsAgentStdio: false }),
    });
    expect(factory).toBeNull();
  });

  it("returns a factory bound to the discovered binary when stdio is supported", async () => {
    const factory = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => ({ supportsAgentStdio: true }),
      spawn: (opts) => {
        expect(opts.binary).toBe("/usr/local/bin/grok");
        expect(opts.allowSpawn).toBe(true);
        return { writeLine() {}, onLine: () => () => {}, close: async () => {} };
      },
    });
    expect(factory).not.toBeNull();
    await factory!({ cwd: "/w" } as never);
  });
});
```

Run: `pnpm --filter @grokdesk/gateway test -- acp-transport-factory`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/gateway/src/services/acp-transport-factory.ts`:

```ts
/**
 * Live `grok agent stdio` transport factory (composition root only).
 * Returns null unless the CLI is discovered AND probe confirms agent stdio,
 * so callers can fall back to headless without try/catch.
 */
import type { SessionInput } from "@grokdesk/agent-runtime";
import {
  spawnAcpLineTransport,
  type AcpLineTransport,
} from "@grokdesk/provider-grok";
import {
  findGrokBinary,
  probeGrokCli,
  envWithGrokPath,
} from "@grokdesk/engine-grok";

export type AcpTransportFactory = (
  input: SessionInput,
) => AcpLineTransport | Promise<AcpLineTransport>;

export async function createLiveAcpTransportFactory(deps?: {
  findBinary?: () => Promise<string | null>;
  probe?: (binary: string) => Promise<{ supportsAgentStdio: boolean }>;
  spawn?: typeof spawnAcpLineTransport;
}): Promise<AcpTransportFactory | null> {
  const findBinary = deps?.findBinary ?? (() => findGrokBinary());
  const probe = deps?.probe ?? ((b: string) => probeGrokCli(b));
  const spawn = deps?.spawn ?? spawnAcpLineTransport;

  const binary = await findBinary();
  if (!binary) return null;
  try {
    const p = await probe(binary);
    if (!p.supportsAgentStdio) return null;
  } catch {
    return null;
  }
  return (input) =>
    spawn({
      binary,
      args: ["agent", "stdio"],
      cwd: input.cwd,
      env: envWithGrokPath(process.env),
      allowSpawn: true,
    });
}
```

Check exports: `grep -n "findGrokBinary\|probeGrokCli\|envWithGrokPath" packages/engine-grok/src/index.ts` — if `probeGrokCli`/`envWithGrokPath` are not re-exported, add them to `packages/engine-grok/src/index.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @grokdesk/gateway test -- acp-transport-factory`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/provider-grok packages/gateway packages/engine-grok
git commit -m "feat(acp): live agent-stdio transport factory gated by probe"
```

### Task 4: ACP-preferred engine selection with per-task headless fallback

**Files:**
- Modify: `packages/gateway/src/services/engine-selection.ts:33-67`
- Modify: `packages/gateway/src/services/agent-provider-engine.ts:112-217`
- Modify: `packages/gateway/src/index.ts:345-390` (composition)
- Tests: `packages/gateway/src/services/engine-selection.test.ts`, `packages/gateway/src/services/agent-provider-engine.test.ts` (check exact test file names with `ls packages/gateway/src/services/*.test.ts`; create if missing)

- [ ] **Step 1: Write failing selection tests**

```ts
it("defaults to agent-provider + ACP when probe reports agent stdio", () => {
  const sel = resolveEngineSelection({ env: {}, acpAvailable: true });
  expect(sel.mode).toBe("agent-provider");
  expect(sel.preferAcp).toBe(true);
  expect(sel.reasons).toContain("default:agent-provider(acp-available)");
});

it("GROKDESK_FORCE_HEADLESS=1 wins over everything", () => {
  const sel = resolveEngineSelection({
    env: { GROKDESK_FORCE_HEADLESS: "1", GROKDESK_PROVIDER_ENGINE: "1" },
    acpAvailable: true,
  });
  expect(sel.mode).toBe("engine-grok");
  expect(sel.reasons).toContain("GROKDESK_FORCE_HEADLESS=1");
});

it("stays headless-default when ACP is unavailable and nothing opted in", () => {
  const sel = resolveEngineSelection({ env: {}, acpAvailable: false });
  expect(sel.mode).toBe("engine-grok");
});
```

Run: `pnpm --filter @grokdesk/gateway test -- engine-selection` — Expected: FAIL (unknown option `acpAvailable`).

- [ ] **Step 2: Implement selection change**

In `resolveEngineSelection`, add to the input type: `acpAvailable?: boolean;` and insert before the existing `if (!envProvider && !settingsPrefer)` block:

```ts
  if (envTruthy(env.GROKDESK_FORCE_HEADLESS)) {
    reasons.push("GROKDESK_FORCE_HEADLESS=1");
    return { mode: "engine-grok", providerId: "grok", preferAcp: false, reasons };
  }
```

and replace the headless-default return with:

```ts
  if (!envProvider && !settingsPrefer) {
    if (input.acpAvailable) {
      reasons.push("default:agent-provider(acp-available)");
      return { mode: "agent-provider", providerId: "grok", preferAcp: true, reasons };
    }
    reasons.push("default:engine-grok");
    return { mode: "engine-grok", providerId: "grok", preferAcp, reasons };
  }
```

Update the file header comment: the cutover condition is now "probe supports agent stdio", rollback is `GROKDESK_FORCE_HEADLESS=1`.

Run: `pnpm --filter @grokdesk/gateway test -- engine-selection` — Expected: PASS.

- [ ] **Step 3: Write failing fallback test for AgentProviderEngine**

```ts
it("falls back to the injected headless engine when ACP session creation fails", async () => {
  const events: string[] = [];
  const fallback: EngineAdapter = {
    executesOwnTools: true,
    run: async (o) => {
      await o.onEvent({ type: "done", summary: "headless-ran" });
    },
    cancel: async () => {},
  };
  const provider = {
    id: "grok",
    getCapabilities: async () => ({ toolMediation: "provider-permission-rpc", policyEnforceable: true }),
    createSession: async () => {
      throw new Error("acp spawn failed");
    },
  } as never;
  const engine = createAgentProviderEngine(provider, { fallbackEngine: fallback });
  await engine.run({
    task: fakeTask(), // reuse the existing task fixture in this test file
    systemPreamble: "",
    onEvent: async (e) => {
      events.push(e.type === "run_progress" ? e.message : e.type);
      return "continue";
    },
  });
  expect(events.some((m) => m.includes("falling back"))).toBe(true);
  expect(events).toContain("done");
});
```

Run: `pnpm --filter @grokdesk/gateway test -- agent-provider-engine` — Expected: FAIL.

- [ ] **Step 4: Implement fallback**

In `agent-provider-engine.ts`:

```ts
export interface AgentProviderEngineOptions {
  provider: AgentProvider;
  resolveExecutesOwnTools?: boolean;
  executesOwnTools?: boolean;
  /** Headless engine used per-task when provider session creation fails. */
  fallbackEngine?: EngineAdapter;
}
```

In `run()`, wrap session creation; track fallen-back tasks so `cancel` routes correctly:

```ts
  private fellBack = new Set<string>();

  // inside run(), replacing the bare createSession call:
    let session = this.sessions.get(task.id);
    if (!session) {
      try {
        session = await this.opts.provider.createSession({
          ref: { providerId: this.opts.provider.id, modelId: task.model },
          cwd,
          workspaceRoots: task.policySnapshot.workspaceRoots,
          policy,
          systemPreamble,
          inheritUserConfig: options.isolateGrokHome === false,
        });
        this.sessions.set(task.id, session);
      } catch (e) {
        if (this.opts.fallbackEngine) {
          this.fellBack.add(task.id);
          await onEvent({
            type: "run_progress",
            message: `ACP unavailable (${e instanceof Error ? e.message : String(e)}) — falling back to headless engine for this task.`,
          });
          return this.opts.fallbackEngine.run(options);
        }
        throw e;
      }
    }
```

And in `cancel()` add before the session lookup:

```ts
    if (this.fellBack.has(taskId)) {
      this.fellBack.delete(taskId);
      await this.opts.fallbackEngine?.cancel(taskId);
      return;
    }
```

Also: a task that fell back once must keep using the fallback for follow-up turns — add at the top of `run()`:

```ts
    if (this.fellBack.has(task.id) && this.opts.fallbackEngine) {
      return this.opts.fallbackEngine.run(options);
    }
```

Run: `pnpm --filter @grokdesk/gateway test -- agent-provider-engine` — Expected: PASS.

- [ ] **Step 5: Wire composition in `Gateway.start` (`packages/gateway/src/index.ts:345-390`)**

Before `resolveEngineSelection`, build the live factory; pass availability + factory + fallback:

```ts
    const acpFactory = this.engineOverride
      ? null
      : await createLiveAcpTransportFactory();
    const engineSelection = resolveEngineSelection({
      env: process.env,
      preferProviderEngine: this.settings.getAll().preferProviderEngine,
      acpAvailable: acpFactory !== null,
    });
    this.providers = createDefaultProviderRegistry({
      includeFake: Boolean(this.engineOverride),
      preferAcp: engineSelection.preferAcp,
      acpTransportFactory: acpFactory ?? undefined,
      onAuthorizationReceipt: /* unchanged */,
    });
```

In the `mode === "agent-provider"` branch, build the headless fallback with the same settings the headless default uses today:

```ts
      const s = this.settings.getAll();
      const fallbackEngine = await createDefaultEngine({
        forceFake: s.forceFakeEngine,
        preferReal: !s.forceFakeEngine,
        mcpServers: this.settings.getMcpServersResolved(),
        skillsPaths: this.settings.getEffectiveSkillsPaths(),
      });
      this.engine = createAgentProviderEngine(provider, { fallbackEngine });
```

Import `createLiveAcpTransportFactory` at the top of `index.ts`. Check `createDefaultProviderRegistry` in `packages/gateway/src/provider-composition.ts:21-44` constructs `GrokAgentProvider` with `mode: "acp"` when `preferAcp && acpTransportFactory` — if it still keys off `process.env.GROKDESK_ACP` (line 46), make the explicit factory take precedence over the env check.

- [ ] **Step 6: Full gateway test run + manual smoke**

Run: `pnpm --filter @grokdesk/gateway test`
Expected: PASS. Then manual smoke (real CLI installed): `pnpm dev`, create a task, confirm the run log/receipts show ACP mediation (operation receipts appear), then `GROKDESK_FORCE_HEADLESS=1 pnpm dev` and confirm headless still works.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway
git commit -m "feat(engine): default to ACP when probe supports it, per-task headless fallback"
```

### Task 5: Session id persistence + resume

**Files:**
- Modify: `packages/engine-grok/src/types.ts` (event union + run options)
- Modify: `packages/engine-grok/src/events.ts:46-54`
- Modify: `packages/engine-grok/src/session.ts:316-350`
- Modify: `packages/gateway/src/services/agent-provider-engine.ts` (resume path)
- Modify: `packages/gateway/src/services/runner.ts` (persist + thread session id)
- Tests: `packages/engine-grok/src/events.test.ts`, `packages/gateway/src/services/agent-provider-engine.test.ts`

- [ ] **Step 1: Failing test — headless `end` yields session metadata event**

In `packages/engine-grok/src/events.test.ts`:

```ts
it("emits session_meta from end events instead of dropping the session id", () => {
  const evs = parseStreamingJsonLine(
    '{"type":"end","stopReason":"EndTurn","sessionId":"abc123","usage":{"input_tokens":10,"output_tokens":5}}',
  );
  expect(evs).toContainEqual({
    type: "session_meta",
    providerSessionId: "abc123",
  });
});
```

Run: `pnpm --filter @grokdesk/engine-grok test -- events` — Expected: FAIL (empty array returned).

- [ ] **Step 2: Add the event variant and emit it**

`packages/engine-grok/src/types.ts` — append to `NormalizedEngineEvent`:

```ts
  /** Engine session identity for resume; never user-visible. */
  | { type: "session_meta"; providerSessionId: string }
```

`packages/engine-grok/src/events.ts` — in the terminal-metadata block (lines 46-54), special-case `end` before returning `[]`:

```ts
  if (type === "end") {
    const sid = typeof obj.sessionId === "string" ? obj.sessionId : null;
    return sid ? [{ type: "session_meta", providerSessionId: sid }] : [];
  }
  if (type === "max_turns_reached" || type === "session" || type === "heartbeat") {
    return [];
  }
```

Run: `pnpm --filter @grokdesk/engine-grok test -- events` — Expected: PASS.

- [ ] **Step 3: Thread resume id into the headless spawn**

`packages/engine-grok/src/types.ts` — add to `EngineRunOptions`:

```ts
  /** Prior engine session to resume (headless --resume / ACP session load). */
  priorProviderSessionId?: string;
```

`packages/engine-grok/src/session.ts` — where argv is assembled (around line 346, next to `"-p"`), add:

```ts
    if (options.priorProviderSessionId) {
      args.push("--resume", options.priorProviderSessionId);
    }
```

Add a spawn-args unit test in the same style as existing session tests: assert `--resume abc123` present when `priorProviderSessionId: "abc123"` and absent otherwise.

Run: `pnpm --filter @grokdesk/engine-grok test` — Expected: PASS.

- [ ] **Step 4: Persist and supply the id in the runner**

In `packages/gateway/src/services/runner.ts`:

1. Locate the engine-event switch that already handles `worker_*` (around lines 1333-1362). Add a `session_meta` case that stores `providerSessionId` on the current run attempt. Find the store API with `grep -n "provider_session_id\|providerSessionId" packages/gateway/src/services/*.ts packages/gateway/src/db.ts` — the column exists on `task_run_attempts` (added by orchestration migration); if no setter exists yet, add `setProviderSessionId(attemptId, id)` to the run-attempts store following its existing update methods.
2. Where the runner builds `EngineRunOptions` for a follow-up turn on an existing task, read the most recent attempt's `provider_session_id` for that task and pass it as `priorProviderSessionId`.
3. `session_meta` must NOT be persisted as a task event (transcript noise) — treat like `run_progress`.

Add a runner test (mirror an existing runner test that drives a fake engine): fake engine emits `session_meta` then `done` on turn 1; assert turn 2's `EngineRunOptions.priorProviderSessionId` equals the id.

Run: `pnpm --filter @grokdesk/gateway test -- runner` — Expected: PASS.

- [ ] **Step 5: ACP resume in AgentProviderEngine**

Failing test first:

```ts
it("resumes a prior provider session instead of creating a fresh one", async () => {
  const calls: string[] = [];
  const provider = {
    id: "grok",
    getCapabilities: async () => ({ toolMediation: "provider-permission-rpc", policyEnforceable: true }),
    createSession: async () => {
      calls.push("create");
      return fakeSession();
    },
    resumeSession: async (binding: { providerSessionId: string }) => {
      calls.push(`resume:${binding.providerSessionId}`);
      return fakeSession();
    },
  } as never;
  const engine = createAgentProviderEngine(provider);
  await engine.run({
    task: fakeTask(),
    systemPreamble: "",
    priorProviderSessionId: "sess-9",
    onEvent: async () => "continue",
  });
  expect(calls).toEqual(["resume:sess-9"]);
});
```

Implementation in `run()` — before the `createSession` block:

```ts
    let session = this.sessions.get(task.id);
    if (!session && options.priorProviderSessionId) {
      try {
        session = await this.opts.provider.resumeSession({
          providerId: this.opts.provider.id,
          providerSessionId: options.priorProviderSessionId,
          modelId: task.model,
          createdAt: new Date().toISOString(),
        });
        this.sessions.set(task.id, session);
      } catch {
        session = undefined; // fall through to fresh create
      }
    }
```

Also fix `GrokAgentProvider.resumeSession` (`packages/provider-grok/src/provider.ts:139-189`): it currently fabricates a balanced-policy `SessionInput`. Extend the signature to `resumeSession(binding, input?: SessionInput)` in `@grokdesk/agent-runtime`'s `AgentProvider` interface (optional param — non-breaking), pass the real input from `AgentProviderEngine` (same object as `createSession` uses), and use it instead of the fabricated one when provided.

Run: `pnpm --filter @grokdesk/gateway test && pnpm --filter @grokdesk/provider-grok test` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages
git commit -m "feat(engine): persist session ids and resume follow-up turns"
```

### Task 6: Sleep/wake token + scheduler safety

**Files:**
- Create: `packages/gateway/src/services/power-state.ts`
- Test: `packages/gateway/src/services/power-state.test.ts`
- Create: `apps/desktop/src/main/power-monitor.ts`
- Modify: `apps/desktop/src/main/` gateway bootstrap (find with `grep -rn "Gateway\b" apps/desktop/src/main/*.ts | grep -i "new\|start" | head -3`)
- Modify: `packages/gateway/src/index.ts` (expose `setPowerState`)

- [ ] **Step 1: Failing pure-logic test**

`packages/gateway/src/services/power-state.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { PowerStateGate } from "./power-state.js";

describe("PowerStateGate", () => {
  it("suspend pauses dispatch; resume refreshes auth before releasing", async () => {
    const order: string[] = [];
    const gate = new PowerStateGate({
      pauseDispatch: () => order.push("pause"),
      resumeDispatch: () => order.push("resume"),
      refreshAuth: async () => {
        order.push("refresh");
      },
    });
    gate.setState("suspended");
    expect(gate.state).toBe("suspended");
    await gate.setState("active");
    expect(order).toEqual(["pause", "refresh", "resume"]);
  });

  it("is idempotent for repeated same-state signals", async () => {
    const pause = vi.fn();
    const gate = new PowerStateGate({
      pauseDispatch: pause,
      resumeDispatch: () => {},
      refreshAuth: async () => {},
    });
    gate.setState("suspended");
    gate.setState("suspended");
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("still resumes dispatch when auth refresh fails", async () => {
    const order: string[] = [];
    const gate = new PowerStateGate({
      pauseDispatch: () => order.push("pause"),
      resumeDispatch: () => order.push("resume"),
      refreshAuth: async () => {
        throw new Error("offline");
      },
    });
    gate.setState("suspended");
    await gate.setState("active");
    expect(order).toEqual(["pause", "resume"]);
  });
});
```

Run: `pnpm --filter @grokdesk/gateway test -- power-state` — Expected: FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
/**
 * Suspend/resume gate: pause scheduler dispatch on sleep, refresh auth
 * BEFORE releasing queued work on wake (prevents stale-token task failures).
 */
export type PowerState = "active" | "suspended";

export class PowerStateGate {
  private current: PowerState = "active";

  constructor(
    private hooks: {
      pauseDispatch: () => void;
      resumeDispatch: () => void;
      refreshAuth: () => Promise<void>;
    },
  ) {}

  get state(): PowerState {
    return this.current;
  }

  async setState(next: PowerState): Promise<void> {
    if (next === this.current) return;
    this.current = next;
    if (next === "suspended") {
      this.hooks.pauseDispatch();
      return;
    }
    try {
      await this.hooks.refreshAuth();
    } catch {
      // Wake must never wedge dispatch; auth errors surface via needs_reauth path.
    }
    this.hooks.resumeDispatch();
  }
}
```

Run: `pnpm --filter @grokdesk/gateway test -- power-state` — Expected: PASS.

- [ ] **Step 3: Wire gateway hooks**

In `packages/gateway/src/index.ts`, construct the gate after scheduler + auth are ready and expose a public method:

```ts
    this.powerGate = new PowerStateGate({
      pauseDispatch: () => this.scheduler?.pause(),
      resumeDispatch: () => this.scheduler?.resume(),
      refreshAuth: () => this.refreshAuthSession(),
    });

  /** Called from Electron main powerMonitor. */
  async setPowerState(state: PowerState): Promise<void> {
    await this.powerGate?.setState(state);
  }
```

Anchors: `grep -n "pause\|resume" packages/gateway/src/services/scheduler.ts | head` — if the scheduler exposes different names (e.g. the global Pause-all path), call those; if it has none, add `pause()`/`resume()` that gate the 30s tick callback (skip occurrence dispatch while paused; do NOT skip occurrence *tracking*, so missed-run policy still applies). `grep -rn "refresh" packages/gateway/src/index.ts | grep -i auth | head` for the existing auth refresh entry point; reuse it, do not write a new refresh.

- [ ] **Step 4: Electron main wiring**

`apps/desktop/src/main/power-monitor.ts`:

```ts
import { powerMonitor } from "electron";

export function wirePowerMonitor(onState: (s: "active" | "suspended") => void): () => void {
  const suspend = () => onState("suspended");
  const resume = () => onState("active");
  powerMonitor.on("suspend", suspend);
  powerMonitor.on("resume", resume);
  const lockCapable = process.platform === "darwin" || process.platform === "win32";
  if (lockCapable) {
    // macOS/Windows lock/unlock behaves like short sleeps for token rotation.
    powerMonitor.on("lock-screen", suspend);
    powerMonitor.on("unlock-screen", resume);
  }
  return () => {
    powerMonitor.off("suspend", suspend);
    powerMonitor.off("resume", resume);
    if (lockCapable) {
      powerMonitor.off("lock-screen", suspend);
      powerMonitor.off("unlock-screen", resume);
    }
  };
}
```

In the main bootstrap where the gateway instance is created (found via the grep in Files above), after gateway start: `wirePowerMonitor((s) => void gateway.setPowerState(s));`

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @grokdesk/gateway test && pnpm --filter @grokdesk/desktop test`
Expected: PASS. Manual: `pnpm dev`, sleep the laptop 2+ minutes with a scheduled rule due, wake — the run fires after wake with fresh auth (check gateway log ordering: refresh before dispatch).

```bash
git add packages/gateway apps/desktop/src/main
git commit -m "feat(power): pause dispatch on sleep, refresh auth before wake release"
```

---

## Phase B — Sticky daily UX

### Task 7: Plan mode — contracts + engine plumbing

**Files:**
- Modify: `packages/shared/src/types.ts` (Task field + event payload)
- Modify: `packages/engine-grok/src/types.ts` (event union + run options)
- Modify: `packages/provider-grok/src/acp-session.ts`
- Modify: `packages/gateway/src/services/agent-provider-engine.ts` (map plan events)
- Modify: `packages/gateway/src/services/runner.ts` (persist `plan_update`)
- Tests: `packages/provider-grok/src/acp-session.test.ts`, `packages/gateway/src/services/agent-provider-engine.test.ts`

- [ ] **Step 1: Contracts**

`packages/shared/src/types.ts` — on the `Task` type (line ~69 area, next to `effort`): add

```ts
  /** Draft-a-plan-first: session starts in plan mode; run gated on approval. */
  planFirst?: boolean;
```

`packages/engine-grok/src/types.ts` — event union gets:

```ts
  | {
      type: "plan_update";
      /** Markdown plan content (full document, latest revision). */
      content: string;
      status: "drafting" | "awaiting_approval";
    }
```

and `EngineRunOptions` gets `planFirst?: boolean;`.

`@grokdesk/agent-runtime` `RuntimeEvent` union gets a matching `{ type: "plan"; content: string; status: "drafting" | "awaiting_approval" }` variant (find the union: `grep -rn "type: \"usage\"" packages/agent-runtime/src | head -1` and add alongside).

Run: `pnpm --filter @grokdesk/shared test` — Expected: types compile, tests pass.

- [ ] **Step 2: Failing ACP session test — plan mode set + plan updates surfaced**

In `packages/provider-grok/src/acp-session.test.ts`, using the existing fake-agent harness (`attachFakeAcpAgent` in `acp-jsonrpc.ts:351`):

```ts
it("requests plan session mode when the session starts planFirst", async () => {
  const { transport, state } = makeFakePeer(); // existing helper in this test file
  const session = new AcpMediatedSession({ transport, policy: balancedPolicy(), binding: b() });
  await session.start("/w", { planFirst: true });
  expect(state.requests.map((r) => r.method)).toContain("session/set_mode");
  const req = state.requests.find((r) => r.method === "session/set_mode");
  expect(req?.params).toMatchObject({ modeId: "plan" });
});

it("sinks plan session updates as plan events", async () => {
  // drive a runTurn while the fake agent pushes:
  // {method:"session/update", params:{sessionId, update:{sessionUpdate:"plan", content:"# Plan", status:"awaiting_approval"}}}
  // assert sink received {type:"plan", content:"# Plan", status:"awaiting_approval"}
});
```

Adapt helper names to what the existing tests in this file actually use (`grep -n "attachFakeAcpAgent\|MemoryLineDuplex" packages/provider-grok/src/acp-session.test.ts`). Run — Expected: FAIL.

- [ ] **Step 3: Implement in `AcpMediatedSession`**

1. `start(cwd, opts?: { planFirst?: boolean })`: after `session/new` succeeds, when `opts?.planFirst`, send request `session/set_mode` with `{ sessionId, modeId: "plan" }`. If the agent rejects with method-not-found, fall back to ext request `x.ai/toggle_plan_mode` with `{ sessionId }`.
2. In the `runTurn` notification handler (the `session/update` branch at `acp-session.ts:159-170`), add:

```ts
        if (u?.sessionUpdate === "plan") {
          void sink({
            type: "plan",
            content: String((u as { content?: unknown }).content ?? ""),
            status:
              (u as { status?: string }).status === "awaiting_approval"
                ? "awaiting_approval"
                : "drafting",
          });
          return;
        }
```

3. In the `session/request_permission` handler (line 63): when the requested tool call is `exit_plan_mode` (inspect `toolCall.title`/`toolCall.kind`/tool name fields — log the raw request once against the real CLI to confirm the field, expected `title: "exit_plan_mode"` or `kind: "ExitPlan"`), do NOT auto-resolve via the policy broker; instead forward it as a permission event with `meta: { planReview: true, planContent }` so the gateway parks it as a user approval. `planContent` comes from the last `plan` update seen this turn (keep it on a private field).

4. `runTurn` input: thread `planFirst` from `EngineRunOptions` → `AgentProviderEngine.run` passes `options.planFirst` to `createSession`'s session start (only on first turn of the task).

- [ ] **Step 4: Bridge + runner mapping**

`agent-provider-engine.ts` `runtimeEventToNormalized`: add

```ts
    case "plan":
      return {
        type: "plan_update",
        content: event.content,
        status: event.status,
      };
```

`runner.ts`: persist `plan_update` as a task event (same append path as `step`), and route the `planReview` permission request through the existing parked-approval builder so it lands in `pending-approvals` with kind `plan_review` (extend the approval record's kind union — find it via `grep -n "kind" packages/gateway/src/services/host-parked-approval.ts | head`). Resolving that approval with **allow** answers the ACP permission (plan approved → agent proceeds to execute); **deny** sends the agent back to planning.

Tests: bridge unit test (plan → plan_update), runner test (plan_update persisted; planReview parks approval).

Run: `pnpm --filter @grokdesk/gateway test && pnpm --filter @grokdesk/provider-grok test` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages
git commit -m "feat(plan): plan-first session mode, plan events, plan-review approvals"
```

### Task 8: Plan mode — composer toggle + plan card UI

**Files:**
- Create: `apps/desktop/src/renderer/components/conversation/plan-card.tsx`
- Test: `apps/desktop/src/renderer/components/conversation/plan-card.test.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx` (approval area, anchor lines 185-230)
- Modify: `apps/desktop/src/renderer/lib/conversation-projector.ts` (surface latest plan per turn)
- Modify: composer in `apps/desktop/src/renderer/components/views/task-workspace-view.tsx` (planFirst toggle on new-task composer only)
- Modify: `apps/desktop/src/renderer/i18n/locales/*.json`

- [ ] **Step 1: Projector — failing test**

In the projector test file (`apps/desktop/src/renderer/lib/conversation-projector.test.ts` — confirm name with `ls`), add: feeding a `plan_update` event (drafting then awaiting_approval) attaches `turn.plan = { content, status }` to the active turn, and a resolved `plan_review` approval clears `status` to `"approved"`. Follow the existing worker-event test shape in that file. Run — Expected: FAIL.

- [ ] **Step 2: Projector implementation**

Add to the turn model in `conversation-projector.ts`:

```ts
export type TurnPlan = {
  content: string;
  status: "drafting" | "awaiting_approval" | "approved";
};
```

and reduce `plan_update` events onto the current turn (last write wins), flipping to `"approved"` when the turn's `plan_review` approval resolves allow. Run tests — Expected: PASS.

- [ ] **Step 3: PlanCard component (test-first)**

`plan-card.test.tsx`:

```tsx
it("renders plan markdown and fires approve / request-changes / run-anyway", async () => {
  const on = { approve: vi.fn(), requestChanges: vi.fn(), runAnyway: vi.fn() };
  render(
    <PlanCard
      plan={{ content: "# Plan\n- step", status: "awaiting_approval" }}
      busy={false}
      onApprove={on.approve}
      onRequestChanges={on.requestChanges}
      onRunAnyway={on.runAnyway}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: /approve/i }));
  expect(on.approve).toHaveBeenCalled();
});
```

`plan-card.tsx` — follow the visual language of `live-work-card.tsx` (same card container classes):

```tsx
import { Markdown } from "../ui/markdown";
import type { TurnPlan } from "../../lib/conversation-projector";

export function PlanCard(props: {
  plan: TurnPlan;
  busy: boolean;
  onApprove: () => void;
  onRequestChanges: () => void;
  onRunAnyway: () => void;
}) {
  const { plan, busy } = props;
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label="Proposed plan">
      <header className="mb-2 text-sm font-medium text-muted-foreground">
        {plan.status === "drafting" ? "Drafting a plan…" : "Plan ready for review"}
      </header>
      <div className="max-h-80 overflow-y-auto">
        <Markdown content={plan.content} />
      </div>
      {plan.status === "awaiting_approval" && (
        <footer className="mt-3 flex gap-2">
          <button disabled={busy} onClick={props.onApprove} className="btn-primary">
            Approve &amp; start
          </button>
          <button disabled={busy} onClick={props.onRequestChanges} className="btn-secondary">
            Request changes
          </button>
          <button disabled={busy} onClick={props.onRunAnyway} className="btn-ghost">
            Run without plan
          </button>
        </footer>
      )}
    </section>
  );
}
```

Match real button/utility class names to the approve/reject buttons already in `conversation-turn.tsx:185-230` (copy their classes; the names above are stand-ins for whatever those use). Wire i18n keys the same way neighboring buttons do.

- [ ] **Step 4: Mount + actions**

In `conversation-turn.tsx`, render `<PlanCard>` above the approval controls when `turn.plan` exists. Actions:
- **Approve** → resolve the turn's `plan_review` parked approval with allow (same `approval-action.ts` path the existing buttons use).
- **Request changes** → focus the composer with a quoted hint ("Describe what to change about the plan…"); on send, resolve the approval with deny and submit the message as the next prompt (the deny returns the agent to planning; the message steers the revision).
- **Run without plan** → resolve allow — identical to Approve at the protocol level; the label communicates intent for users who want to skip plan iteration.

New-task composer: add a small toggle ("Draft a plan first") beside the existing effort/model controls in `task-workspace-view.tsx`; it sets `planFirst: true` on `tasks.create` payload (thread through `desktop-task-dispatch.ts` → task row; find the create payload type via `grep -n "planFirst\|tasks.create" packages/gateway/src/services/desktop-task-dispatch.ts`). Disable the toggle with tooltip "Requires the ACP engine path" when the gateway reports headless mode.

- [ ] **Step 5: Verify + commit**

Run: `pnpm --filter @grokdesk/desktop test && pnpm --filter @grokdesk/gateway test`
Expected: PASS. Manual: create a task with the toggle on → plan card streams in → Approve → execution proceeds; Request changes loops.

```bash
git add apps/desktop packages/gateway
git commit -m "feat(plan): draft-a-plan-first toggle and plan review card"
```

### Task 9: Nudge while working (interjection)

**Files:**
- Modify: `packages/provider-grok/src/acp-session.ts` (`interject`)
- Modify: `@grokdesk/agent-runtime` `AgentSession` interface (optional `interject`)
- Modify: `packages/engine-grok/src/types.ts` (`EngineAdapter.interject?`)
- Modify: `packages/gateway/src/services/agent-provider-engine.ts`
- Modify: `packages/gateway/src/services/tasks-core-dispatch.ts` (RPC `task.interject`)
- Modify: `apps/desktop/src/renderer/hooks/use-workspace-queue.ts` + `apps/desktop/src/renderer/components/conversation/queued-message-row.tsx`
- Tests: alongside each

- [ ] **Step 1: Provider — failing test**

Use the same fake-peer harness as Task 7 (`makeFakePeer` / `attachFakeAcpAgent` — adapt to the file's actual helper). Configure the peer to reject unknown methods with JSON-RPC error code `-32601`:

```ts
it("interjects via x.ai/session/interjection, falling back to x.ai/interject", async () => {
  const { transport, state } = makeFakePeer({
    respond: (method) => {
      if (method === "x.ai/interject") return {}; // second choice accepted
      throw { code: -32601, message: "method not found" }; // first choice rejected
    },
  });
  const session = new AcpMediatedSession({ transport, policy: balancedPolicy(), binding: b() });
  await session.start("/w");
  await expect(session.interject("also check errors")).resolves.toBe(true);
  const tried = state.requests.map((r) => r.method).filter((m) => m.includes("interject"));
  expect(tried).toEqual(["x.ai/session/interjection", "x.ai/interject"]);
});

it("returns false when no interjection ext is supported", async () => {
  const { transport } = makeFakePeer({
    respond: () => {
      throw { code: -32601, message: "method not found" };
    },
  });
  const session = new AcpMediatedSession({ transport, policy: balancedPolicy(), binding: b() });
  await session.start("/w");
  await expect(session.interject("hi")).resolves.toBe(false);
});
```

If the existing harness has no `respond` hook, add one (a per-method responder map) — Tasks 10 and 11 need the same rejection shape for `compact`/`rewind` tests.

- [ ] **Step 2: Implement `AcpMediatedSession.interject`**

```ts
  /** Deliver an aside into the live turn. Returns false when unsupported. */
  async interject(text: string): Promise<boolean> {
    const sessionId = this.sessionId; // existing private field from start()
    if (!sessionId) return false;
    for (const method of ["x.ai/session/interjection", "x.ai/interject"]) {
      try {
        await this.client.request(method, { sessionId, text });
        return true;
      } catch (e) {
        if (isMethodNotFound(e)) continue; // -32601 → try next
        throw e;
      }
    }
    return false;
  }
```

(`isMethodNotFound`: check the JSON-RPC error code field on the error the client throws — see `AcpJsonRpcClient` reject shape in `acp-jsonrpc.ts:124+`. Add the helper once in `acp-session.ts`; Tasks 10-11 reuse it.) Add `interject?(text: string): Promise<boolean>` to the `AgentSession` interface in agent-runtime.

- [ ] **Step 3: Engine + RPC plumbing**

`EngineAdapter` (engine-grok `types.ts`): add `interject?(taskId: string, text: string): Promise<boolean>;`
`AgentProviderEngine`: implement by looking up `this.sessions.get(taskId)?.interject?.(text) ?? false` (and `false` for fallen-back tasks).
`tasks-core-dispatch.ts`: register `task.interject { taskId, text }` next to the existing task methods (anchor: `grep -n '"task\.' packages/gateway/src/services/tasks-core-dispatch.ts | head`). On success append a task event: reuse the message event with `meta.interjection = true` if the persisted message payload supports meta; otherwise add a `channel: "interjection"` literal to the message event type in shared types (single source: check `packages/shared/src/types.ts` message event shape). Return `{ delivered: boolean }`; `false` → renderer falls back to normal queueing.

Test: dispatch-level test mirroring an existing `tasks-core-dispatch.test.ts` case.

- [ ] **Step 4: Renderer**

`use-workspace-queue.ts`: add `interjectNow(queuedId)` — calls `api.taskInterject(taskId, text)`; on `delivered: true` remove from queue and rely on the appended event; on `false` leave queued (tooltip "Will send when the current run finishes").
`queued-message-row.tsx`: add a "Send now" button when the task is running (row already knows queue status). The projector renders interjection messages as a compact "noted while working" line inside the turn's work area (extend `conversation-turn.tsx` where user messages render).
Composer: while a run is active, keep it enabled (verify current gating: `grep -n "disabled" apps/desktop/src/renderer/components/views/task-workspace-view.tsx | head`) and set placeholder "Nudge Grok while it works — or queue a follow-up".

- [ ] **Step 5: Verify + commit**

Run: `pnpm -r test` (workspace-wide). Manual: start a long task, type a nudge, confirm it lands mid-run (ACP) and queues gracefully under `GROKDESK_FORCE_HEADLESS=1`.

```bash
git add packages apps/desktop
git commit -m "feat(chat): nudge-while-working interjections over ACP"
```

### Task 10: Context meter + "Summarize so far"

**Files:**
- Modify: `packages/engine-grok/src/types.ts` (+`usage` variant), `packages/engine-grok/src/events.ts` (parse usage off `end`)
- Modify: `packages/gateway/src/services/agent-provider-engine.ts:77-79` (stop dropping `usage`)
- Modify: `packages/gateway/src/services/runner.ts` (persist last usage per run attempt — new nullable `last_usage_json` column, NOT a task event)
- Modify: `packages/provider-grok/src/acp-session.ts` (`compact()` via `x.ai/compact_conversation`)
- Create: `apps/desktop/src/renderer/components/context-meter.tsx` (+ test)
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx` (mount near model/effort controls)

- [ ] **Step 1: Event plumbing (test-first)**

events.test.ts: `end` with `usage:{"input_tokens":8000,"output_tokens":2000}` and `modelUsage:{"grok-4.5":{"context_window":256000}}` emits — in addition to `session_meta` — a usage event (contextWindow omitted when absent). Variant:

```ts
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      contextWindow?: number;
    }
```

Bridge: replace the `case "usage": return null;` at `agent-provider-engine.ts:77-79` with a mapping to the same shape (agent-runtime's `usage` RuntimeEvent already exists — check its fields with `grep -n -A6 '"usage"' packages/agent-runtime/src/*.ts | head -12` and map field names exactly).

- [ ] **Step 2: Persistence + RPC**

Runner: on `usage`, update the current run attempt (`last_usage_json`, new nullable TEXT column — add a migration following the `revision_of_task_id` migration pattern in `packages/gateway/src/db.ts`). Expose `task.contextUsage { taskId } → { inputTokens, outputTokens, contextWindow } | null` and `task.compact { taskId } → { ok }` in `tasks-core-dispatch.ts`. `task.compact` → `AcpMediatedSession.compact()`:

```ts
  async compact(): Promise<boolean> {
    if (!this.sessionId) return false;
    try {
      await this.client.request("x.ai/compact_conversation", { sessionId: this.sessionId });
      return true;
    } catch (e) {
      if (isMethodNotFound(e)) return false;
      throw e;
    }
  }
```

Headless path: return `false` (compact is ACP-only; the chip hides).

- [ ] **Step 3: Meter UI**

`context-meter.tsx`: props `{ usage: { inputTokens: number; outputTokens: number; contextWindow?: number } | null; onCompact: () => void; compactAvailable: boolean }`. Render nothing when `usage?.contextWindow` is falsy. Fill ratio = `(inputTokens + outputTokens) / contextWindow`. A 64px-wide 3px bar + tooltip "Context 42% used". At ≥70%: show chip "Long conversation — summarize so far?" firing `onCompact` (chip hidden when `!compactAvailable`). Poll `task.contextUsage` alongside whatever cadence the workspace already polls task state (reuse that hook — do not add a new timer). Test: renders nothing without window; shows chip at 75%.

- [ ] **Step 4: Verify + commit**

Run: `pnpm -r test`. Manual: long task shows meter climbing; chip triggers compact; stream shows the CLI's auto-compact notification as normal progress.

```bash
git add packages apps/desktop
git commit -m "feat(chat): context usage meter with one-tap compaction"
```

### Task 11: Undo last turn (rewind)

**Files:**
- Modify: `packages/provider-grok/src/acp-session.ts` (`rewindPoints()` / `rewindTo()`)
- Modify: `packages/gateway/src/services/tasks-core-dispatch.ts` (`task.rewindPoints`, `task.rewind`)
- Modify: `packages/gateway/src/services/runner.ts` or tasks service (mark truncated turns superseded — reuse the edit-and-rerun superseded mechanism, anchor `grep -rn "superseded" packages/gateway/src/services/*.ts | head`)
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx` (per-turn overflow menu item + confirm dialog)
- Tests: alongside each

- [ ] **Step 1: Provider methods (test-first with fake peer)**

```ts
  async rewindPoints(): Promise<Array<{ id: string; label?: string; files?: string[] }> | null> {
    if (!this.sessionId) return null;
    try {
      const res = await this.client.request("x.ai/rewind/points", { sessionId: this.sessionId });
      return Array.isArray((res as { points?: unknown[] })?.points)
        ? ((res as { points: never[] }).points as never)
        : null;
    } catch (e) {
      if (isMethodNotFound(e)) return null;
      throw e;
    }
  }

  async rewindTo(pointId: string): Promise<boolean> {
    if (!this.sessionId) return false;
    try {
      await this.client.request("x.ai/rewind/execute", { sessionId: this.sessionId, pointId });
      return true;
    } catch (e) {
      if (isMethodNotFound(e)) return false;
      throw e;
    }
  }
```

**First implementation step before trusting field names:** run the real CLI once (`GROKDESK_ACP=1`, send `x.ai/rewind/points` after a two-turn session) and print the raw response; adjust `points`/`pointId`/`files` field names to the observed shape and encode them in the fake-peer test. Rewind points are per user prompt (one per turn) per CLI docs `17-sessions.md:123-140`.

- [ ] **Step 2: Gateway RPCs + event truncation**

`task.rewindPoints { taskId }` → provider points, mapped to Desk turns by order (most recent N turns ↔ most recent N points). `task.rewind { taskId, pointId, turnId }` → on provider success, mark that turn and everything after it superseded (same mechanism edit-and-rerun uses so the projector already hides them), and append a `status_change`-style event noting "Rewound to before this message" (visible as a calm one-liner). Capability: only ACP-backed running/resumable tasks — `task.rewindPoints` returns null otherwise and the menu item hides.

- [ ] **Step 3: UI**

Per-turn overflow menu (the turn header area in `conversation-turn.tsx`): item "Undo this turn" shown when a `rewindPoints` entry maps to it. Clicking opens a confirm dialog listing `files` from the point ("These files will be restored: …" — or "No file changes to restore" when empty) with warning copy: "Changes made after this point are lost unless committed to git." Confirm → `task.rewind`. Reuse the app's existing dialog primitive (`grep -rln "Dialog\|confirm" apps/desktop/src/renderer/components/ui/ | head -3`).

- [ ] **Step 4: Verify + commit**

Run: `pnpm -r test`. Manual: 3-turn task with file writes → undo turn 2 → files restored, turns 2-3 hidden, follow-up prompt continues from turn 1 context.

```bash
git add packages apps/desktop
git commit -m "feat(chat): undo-last-turn via ACP rewind with file confirmation"
```

---

## Phase C — Grok magic

### Task 12: Media tools → inline artifacts

**Files:**
- Modify: `packages/gateway/src/services/agent-provider-engine.ts:85-110` (`mapToolName`)
- Modify: `packages/engine-grok/src/types.ts` (add `"media"` to tool union)
- Modify: `packages/provider-grok/src/acp-session.ts` (tool_call_update completed → artifact events for media outputs)
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-parts.tsx` (video preview support if image-only today)
- Tests: bridge unit tests + provider fake-peer test

- [ ] **Step 1: Failing bridge test**

```ts
it("maps media generation tools to the media tool id", () => {
  for (const t of ["image_gen", "image_edit", "image_to_video", "reference_to_video"]) {
    const ev = runtimeEventToNormalized({ type: "tool_call", id: "1", tool: t } as never);
    expect(ev).toMatchObject({ type: "tool_request", tool: "media" });
  }
});
```

- [ ] **Step 2: Implement mapping**

`mapToolName` — insert before the browser branch:

```ts
  if (
    t === "image_gen" ||
    t === "image_edit" ||
    t === "image_to_video" ||
    t === "reference_to_video" ||
    t.includes("imagine")
  )
    return "media";
```

Add `"media"` to the `tool_request.tool` union in `packages/engine-grok/src/types.ts:15-27`.

- [ ] **Step 3: Artifact emission**

In `AcpMediatedSession` `runTurn`, on `tool_call_update` with `status === "completed"` for a media tool, extract output file paths (log one real `image_gen` completion against the live CLI to confirm the output field — expected under `content`/`output` with a workspace path) and sink `{ type: "artifact", title, path, kind: "media" }` per file. The runner already persists artifact events (`runner.ts:1333-1354` prefers declared artifacts — these count as declared).

- [ ] **Step 4: Renderer check**

`task-workspace-parts.tsx` deliverable rows + `media-lightbox.tsx` already preview media; verify video: `grep -n "mp4\|video" apps/desktop/src/renderer/components/media-lightbox.tsx apps/desktop/src/renderer/components/views/task-workspace-parts.tsx`. If image-only, add a `<video controls>` branch keyed by extension (`.mp4`, `.webm`, `.mov`) in both, mirroring the image branch.

- [ ] **Step 5: Verify + commit**

Run: `pnpm -r test`. Manual: ask a task "generate an image of …" → artifact card with inline preview appears beside the answer; file saved under the task workspace.

```bash
git add packages apps/desktop
git commit -m "feat(magic): imagine image/video outputs land as inline media artifacts"
```

### Task 13: Web/X search citation cards

**Files:**
- Modify: `packages/engine-grok/src/types.ts` (+`citations` variant)
- Modify: `packages/provider-grok/src/acp-session.ts` (collect search completions)
- Modify: `packages/gateway/src/services/agent-provider-engine.ts` + `runner.ts` (persist)
- Modify: `apps/desktop/src/renderer/lib/conversation-projector.ts` (attach to turn)
- Create: `apps/desktop/src/renderer/components/conversation/citation-cards.tsx` (+ test)
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx` (answer footer)

- [ ] **Step 1: Contract**

```ts
  | {
      type: "citations";
      items: Array<{
        url: string;
        title?: string;
        source: "web" | "x";
      }>;
    }
```

(engine event union; mirror a `citations` RuntimeEvent in agent-runtime and a persisted task-event payload in shared types, following how `worker_activity` payloads are declared there.)

- [ ] **Step 2: Collection (test-first with fake peer)**

In `AcpMediatedSession.runTurn`: accumulate from `tool_call_update` completions where the tool is `web_search`/`x_search`/`web_fetch` — pull result URLs/titles from the update payload (log one live `web_search` completion to pin the field names; expected an array with `url` + `title`). De-dupe by URL. On turn end (before resolving), sink one `{ type: "citations", items }` when non-empty. `x_search` results → `source: "x"`.

- [ ] **Step 3: Persist + project**

Bridge maps it 1:1; runner appends as task event (not transient). Projector: attach `turn.citations` from the event to the enclosing turn (test alongside the worker-event projector tests).

- [ ] **Step 4: UI**

`citation-cards.tsx`:

```tsx
import { useState } from "react";

export function CitationCards({
  items,
}: {
  items: Array<{ url: string; title?: string; source: "web" | "x" }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? items : items.slice(0, 4);
  if (!items.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2" aria-label="Sources">
      {visible.map((c) => (
        <a
          key={c.url}
          href={c.url}
          target="_blank"
          rel="noreferrer"
          className="flex max-w-56 items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs hover:bg-accent"
        >
          <span aria-hidden className="text-muted-foreground">
            {c.source === "x" ? "𝕏" : "🌐"}
          </span>
          <span className="truncate">{c.title ?? safeHostname(c.url)}</span>
        </a>
      ))}
      {items.length > 4 && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground"
        >
          +{items.length - 4} sources
        </button>
      )}
    </div>
  );
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
```

Glyphs, not remote favicons: the renderer CSP should not open a third-party favicon fetch per citation (verify current CSP with `grep -rn "Content-Security-Policy" apps/desktop/src -l`; keep it closed). Ensure external links route through the app's existing safe-open handler (`grep -rn "openExternal" apps/desktop/src/main | head` — links must not navigate the Electron window). Render under the answer block in `conversation-turn.tsx` when `turn.citations?.length`.

- [ ] **Step 5: Verify + commit**

Run: `pnpm -r test`. Manual: research task → source cards under answer; links open in the default browser.

```bash
git add packages apps/desktop
git commit -m "feat(magic): web/X search citations render as source cards"
```

### Task 14: Mermaid diagrams in-thread

**Files:**
- Add dependencies: `mermaid`, `dompurify` in `apps/desktop/package.json`
- Create: `apps/desktop/src/renderer/components/ui/mermaid-block.tsx`
- Test: `apps/desktop/src/renderer/components/ui/mermaid-block.test.tsx`
- Modify: `apps/desktop/src/renderer/components/ui/markdown.tsx` (fence branch)

- [ ] **Step 1: Install**

Run: `pnpm --filter @grokdesk/desktop add mermaid dompurify`
Expected: added to dependencies (bundled locally — no CDN, works offline).

- [ ] **Step 2: Component (test-first)**

Test: renders the source in a `<pre>` fallback when mermaid fails (feed invalid syntax; mock `mermaid.render` rejection), and toggles between diagram and source.

Security note: the SVG string is derived from **agent-authored content**. Two layers are mandatory: mermaid's `securityLevel: "strict"` AND DOMPurify sanitization of the produced SVG before it touches the DOM. Never render the raw string.

```tsx
import { useEffect, useId, useState } from "react";
import DOMPurify from "dompurify";

export function MermaidBlock({ code }: { code: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
        const { svg } = await mermaid.render(`m${id}`, code);
        const clean = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["foreignObject"],
        });
        if (alive) setSvg(clean);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [code, id]);

  if (failed || !svg) {
    return <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{code}</pre>;
  }
  return (
    <figure className="my-2 rounded-lg border border-border bg-card p-3">
      {showSource ? (
        <pre className="overflow-x-auto text-xs">{code}</pre>
      ) : (
        <div
          className="overflow-x-auto [&_svg]:max-w-full"
          // Sanitized above with DOMPurify (svg profile, foreignObject stripped).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
      <figcaption className="mt-1 text-right">
        <button
          className="text-xs text-muted-foreground hover:underline"
          onClick={() => setShowSource((s) => !s)}
        >
          {showSource ? "View diagram" : "View source"}
        </button>
      </figcaption>
    </figure>
  );
}
```

Add a test asserting sanitization: feed a diagram whose label attempts `<script>`/event-handler injection and assert the rendered container has no `script` element and no `on*` attributes.

- [ ] **Step 3: Markdown integration**

In `ui/markdown.tsx`, find the code-block render path (`grep -n "code" apps/desktop/src/renderer/components/ui/markdown.tsx | head`). Route `language === "mermaid"` fences to `<MermaidBlock code={…}/>`; all other fences unchanged. If the markdown pipeline is the lazy variant (`markdown-lazy.tsx`), apply in whichever module owns the code renderer.

- [ ] **Step 4: Verify + commit**

Run: `pnpm --filter @grokdesk/desktop test`. Manual: ask "diagram this repo's architecture as mermaid" → inline diagram with working source toggle; invalid mermaid degrades to a code block.

```bash
git add apps/desktop
git commit -m "feat(magic): render mermaid fences as sanitized inline diagrams"
```

### Task 15 (stretch — cut first if the wave runs long): Weekly recap

**Files:**
- Create: `packages/gateway/src/services/weekly-recap.ts` (+ test)
- Modify: scheduler seeding (find rule creation: `grep -rn "scheduleRule\|schedule_rules" packages/gateway/src/services/scheduler.ts | head`)
- Modify: `apps/desktop/src/renderer/components/inbox-panel.tsx` (recap item type with accept/edit)

- [ ] **Step 1: Recap builder (pure, test-first)**

`weekly-recap.ts`: `buildWeeklyRecap({ takeaways, memoryItems, now })` → `{ title: "What I learned this week", lines: Array<{ text: string; suggestedMemory: string | null }> } | null` (null when nothing happened — no empty inbox spam). Compose from `packages/shared/src/takeaways.ts` output for tasks completed in the trailing 7 days plus memory items touched in that window. Tests: empty week → null; two takeaways → two lines.

- [ ] **Step 2: Schedule + inbox wiring**

Seed one built-in weekly rule (Monday 09:00 local, `quietHoursRespect: true`, guarded by settings flag `weeklyRecapEnabled`, default true, toggle in Settings). On fire, instead of spawning an engine task, call the recap builder and append an inbox item kind `recap` (extend the inbox item union next to existing kinds — `grep -n "kind" packages/gateway/src/services/*inbox* packages/shared/src/types.ts | grep -i inbox | head`).

- [ ] **Step 3: Inbox UI**

`inbox-panel.tsx`: recap items render lines with per-line "Remember" (writes `suggestedMemory` via the existing memory-add RPC) and "Dismiss". Reuse the panel's existing action-button pattern.

- [ ] **Step 4: Verify + commit**

Run: `pnpm -r test`. Manual: temporarily set the rule to fire in 1 minute; confirm inbox item + accept writes memory.

```bash
git add packages apps/desktop
git commit -m "feat(memory): weekly recap inbox item with per-line remember"
```

---

### Task 16: Wave QA, docs, status ledger

**Files:**
- Modify: `to_add.md` (status table)
- Modify: `docs/superpowers/specs/2026-07-15-cli-feature-port-design.md` (status header)
- Create: `docs/analysis/2026-07-16-cli-port-wave-qa.md`

- [ ] **Step 1: Full matrix**

Run: `pnpm -r test`
Expected: all packages PASS. Then the cross-cutting manual matrix (record results in the QA doc):

| Scenario | Expected |
|---|---|
| ACP default, CLI present | task runs mediated; receipts logged |
| `GROKDESK_FORCE_HEADLESS=1` | headless path; ACP-only affordances degrade honestly (nudge queues with tooltip, no meter chip, no undo menu, plan toggle disabled with tooltip) |
| ACP spawn fails mid-fleet | that task falls back to headless with the progress note; other tasks unaffected |
| Kill gateway mid-task, restart | follow-up resumes engine session (spawn count doesn't double) |
| Laptop sleep 5 min with due schedule | run fires post-wake, no reauth wall |
| Plan-first task | draft → approve → run; request-changes loops |
| Nudge mid-run | aside lands without killing the run |
| Long conversation | meter climbs; compact chip works |
| Undo turn with file writes | files restored, turns hidden |
| Imagine, citations, mermaid | inline artifacts / cards / diagrams |
| Strict-mode headless task | side-effect tools denied, task completes read-only |

- [ ] **Step 2: Update ledgers**

`to_add.md` bottom status table: set `Plan / goal / interject` → partial/done as landed, `Rewind / hunks` → partial (rewind done, hunks not), add rows `ACP default: done`, `Session resume: done`, `Media artifacts: done`, `Citations: done`, `Mermaid: done`. Spec status header → `Implemented (wave 1)` with date.

- [ ] **Step 3: Final commit**

```bash
git add to_add.md docs
git commit -m "docs: CLI port wave QA matrix and status ledger update"
```

---

## Risks and guardrails (carry into every task)

1. **ACP protocol drift** — every ext-method call must tolerate `-32601` method-not-found and degrade (return null/false, hide the affordance). Pin a known-good CLI version in the QA doc; the probe result gates everything.
2. **No silent policy weakening** — Task 2 must land before Task 4 flips the default, so strict semantics are honest on both paths from day one of ACP-default.
3. **Rollback** — `GROKDESK_FORCE_HEADLESS=1` restores today's behavior globally at any point after Task 4.
4. **Transcript purity** — `session_meta`, `usage`, `run_progress` never persist as conversation events; `plan_update` and `citations` do.
5. **Agent-authored content is untrusted** — mermaid SVG must pass DOMPurify; citation links open externally via the safe-open handler; no remote favicon fetches.
6. **Commerce branches** — do not touch `license-*`, `entitlement*`, or `managed-runtime*` files; the entitlements program owns them on separate lanes (`docs/superpowers/plans/2026-07-16-ownership-ledger.md`).

## Success signals (from the spec, measure post-ship)

- Engine spawn count per task drops (resume working).
- Zero post-sleep reauth failures in dogfood week one.
- % of tasks started plan-first; interjections per active user; media artifacts/week; session length after citations ship.
