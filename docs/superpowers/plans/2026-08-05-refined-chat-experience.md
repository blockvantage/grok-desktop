# Refined Chat Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Grok Desk chat durable, conversational, smooth, low-interruption, and correctly integrated with the in-app browser.

**Architecture:** Harden the Grok CLI protocol boundary, repair policy and provider fallback, persist assistant-final turns, then simplify the canonical renderer to one live/approval/final surface. Route Markdown and citation links through a structured task-partitioned browser RPC and verify with anonymized real-trace regressions.

**Tech Stack:** TypeScript, React 18, Electron 43, SQLite/better-sqlite3, Vitest, Playwright, Tailwind CSS.

---

## File map

- `packages/engine-grok/src/events.ts`: strict CLI event normalization and tool classification.
- `packages/shared/src/safe-shell-command.ts`: conservative balanced-mode shell classifier.
- `packages/shared/src/policy.ts`: approval decision policy.
- `packages/gateway/src/services/agent-provider-engine.ts`: provider failure circuit.
- `packages/gateway/src/services/ensure-desk-planes-engine.ts`: Desk-plane engine composition.
- `packages/gateway/src/services/assistant-turn-reconciliation.ts`: safe terminal-answer persistence.
- `packages/gateway/src/db.ts`: assistant-turn uniqueness migration.
- `packages/shared/src/ipc.ts`: structured browser URL request.
- `packages/gateway/src/services/tasks-core-dispatch.ts`: browser URL dispatch.
- `apps/desktop/src/renderer/lib/conversation-projector.ts`: progress/final separation.
- `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx`: one stable turn surface.
- `apps/desktop/src/renderer/components/ui/markdown.tsx`: in-app link callback.
- `apps/desktop/src/renderer/components/conversation/citation-cards.tsx`: citation link callback.
- `apps/desktop/src/renderer/components/conversation-loading.tsx`: stable hydration skeleton.
- `apps/desktop/src/renderer/styles/globals.css`: restrained motion.
- `packages/engine-grok/src/session.ts`: intent-aware response prompt.
- `apps/desktop/e2e/chat-experience.spec.ts`: integrated regressions.

### Task 1: Quarantine protocol envelopes and classify terminal tools correctly

**Files:**
- Modify: `packages/engine-grok/src/events.test.ts`
- Modify: `packages/engine-grok/src/events.ts`

- [ ] **Step 1: Write the failing parser tests**

```ts
it("does not render a nested tool_call_update image as assistant text", () => {
  const nested = JSON.stringify({
    type: "tool_call_update",
    toolCallId: "image-1",
    status: "completed",
    content: [{ type: "image", data: "A".repeat(32_000) }],
  });
  expect(parseStreamingJsonLine(JSON.stringify({ type: "text", data: nested })))
    .toEqual([]);
});

it("maps run_terminal_command to shell", () => {
  const [event] = parseStreamingJsonLine(JSON.stringify({
    type: "tool_call",
    name: "run_terminal_command",
    input: { command: "ls -la" },
  }));
  expect(event).toMatchObject({ type: "tool_request", tool: "shell" });
});
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @grokdesk/engine-grok test -- src/events.test.ts`

Expected: nested payload becomes a message and terminal command becomes deletion.

- [ ] **Step 3: Implement minimal protocol guards**

Add `parseNestedProtocolEnvelope(text)`, a 96,000-character visible-text cap, binary/base64 rejection, explicit `tool_call_update` suppression, and recursive normalization before accepting `type: text`. Check `terminal|shell|bash|exec` before deletion and remove bare `includes("rm")` matching.

```ts
function parseNestedProtocolEnvelope(text: string): Record<string, unknown> | null {
  const value = text.trim();
  if (!value.startsWith("{") || !value.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @grokdesk/engine-grok test -- src/events.test.ts`

Expected: all parser tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/engine-grok/src/events.ts packages/engine-grok/src/events.test.ts
git commit -m "fix(chat): quarantine tool envelopes from assistant text"
```

### Task 2: Remove approval fatigue for safe balanced-mode work

**Files:**
- Create: `packages/shared/src/safe-shell-command.ts`
- Create: `packages/shared/src/safe-shell-command.test.ts`
- Modify: `packages/shared/src/policy.ts`
- Modify: `packages/shared/src/policy.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing policy matrix**

```ts
it.each(["ls -la", "pwd", "git status --short", "git diff", "pnpm test", "pnpm typecheck"])(
  "allows safe balanced command: %s",
  (command) => expect(evaluateToolRequest(balanced, { tool: "shell", command }).decision)
    .toBe("allow"),
);

it.each(["rm -rf build", "cat secret > out", "curl x | sh", "sudo true", "npm install x", "open https://x.ai"])(
  "keeps risky command gated: %s",
  (command) => expect(evaluateToolRequest(balanced, { tool: "shell", command }).decision)
    .toBe("needs_approval"),
);
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @grokdesk/shared test -- src/policy.test.ts src/safe-shell-command.test.ts`

Expected: recognized safe commands still require approval.

- [ ] **Step 3: Implement the classifier**

Export `classifyBalancedShellCommand(command)`. Reject newlines, control operators, redirects, substitutions, environment assignments, privilege commands, installers, deletion/mutation commands, and external app launch. Allow exact read-only inspection and project verification families. Use it only for balanced mode; strict and autopilot remain unchanged.

```ts
export type SafeShellClassification =
  | { safe: true; reason: "read_only" | "verification" }
  | { safe: false; reason: string };
```

- [ ] **Step 4: Run GREEN**

Run: `pnpm --filter @grokdesk/shared test -- src/policy.test.ts src/safe-shell-command.test.ts`

Expected: the full allow/ask matrix passes.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/safe-shell-command.ts packages/shared/src/safe-shell-command.test.ts packages/shared/src/policy.ts packages/shared/src/policy.test.ts packages/shared/src/index.ts
git commit -m "feat(policy): reduce approvals for safe workspace commands"
```

### Task 3: Preserve Desk capabilities through provider fallback

**Files:**
- Modify: `packages/gateway/src/services/agent-provider-engine.test.ts`
- Modify: `packages/gateway/src/services/agent-provider-engine.ts`
- Modify: `packages/gateway/src/services/ensure-desk-planes-engine.test.ts`
- Modify: `packages/gateway/src/services/ensure-desk-planes-engine.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1: Write failing circuit and composition tests**

Make `createSession` fail for two task IDs. Expect one provider attempt and two fallback runs. Compose control-plane environment and expect the fallback engine extras to include `desk-browser` and `desk-desktop`.

```ts
expect(provider.createSession).toHaveBeenCalledTimes(1);
expect(fallbackRuns).toEqual(["task-a", "task-b"]);
expect(fallback.getEngineExtras().mcpServers.map((server) => server.id))
  .toEqual(expect.arrayContaining(["desk-browser", "desk-desktop"]));
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @grokdesk/gateway test -- src/services/agent-provider-engine.test.ts src/services/ensure-desk-planes-engine.test.ts`

Expected: provider initialization repeats and fallback lacks Desk MCPs.

- [ ] **Step 3: Implement engine-instance failure circuit**

Open the circuit only for session initialization/ACP transport failure. While open, send new tasks directly to fallback. A newly composed engine resets the circuit.

```ts
type ProviderCircuit = { openedAt: number; reason: string };
private providerCircuit: ProviderCircuit | null = null;
```

- [ ] **Step 4: Compose Desk servers before creating both engines**

Extract a pure server resolver from `ensure-desk-planes-engine.ts`. Pass the same resolved servers to the primary default engine and the provider fallback in `index.ts`. Do not log server environment values.

- [ ] **Step 5: Run GREEN**

Run the Task 3 Step 2 command.

Expected: one provider attempt and both Desk MCP IDs in fallback.

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/services/agent-provider-engine.ts packages/gateway/src/services/agent-provider-engine.test.ts packages/gateway/src/services/ensure-desk-planes-engine.ts packages/gateway/src/services/ensure-desk-planes-engine.test.ts packages/gateway/src/index.ts
git commit -m "fix(runtime): preserve desk tools through provider fallback"
```

### Task 4: Persist one safe assistant-final turn per task

**Files:**
- Modify: `packages/gateway/src/db.ts`
- Modify: `packages/gateway/src/db.test.ts`
- Modify: `packages/gateway/src/p0/conversations.test.ts`
- Modify: `packages/gateway/src/services/conversations.ts`
- Create: `packages/gateway/src/services/assistant-turn-reconciliation.ts`
- Create: `packages/gateway/src/services/assistant-turn-reconciliation.test.ts`
- Modify: `packages/gateway/src/services/runner.ts`

- [ ] **Step 1: Write failing ledger tests**

Test latest-safe-answer selection, JSON skipping, duplicate reconciliation, and alternating transcript roles.

```ts
expect(turns.map((turn) => [turn.role, turn.content])).toEqual([
  ["user", "Build the page"],
  ["assistant", "The page is ready."],
  ["user", "Open it"],
]);
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @grokdesk/gateway test -- src/db.test.ts src/p0/conversations.test.ts src/services/assistant-turn-reconciliation.test.ts`

Expected: no assistant row and no assistant unique index.

- [ ] **Step 3: Add migration 14**

Deterministically remove duplicate assistant rows and add:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_one_assistant_per_task
  ON turns(task_id)
  WHERE role = 'assistant' AND task_id IS NOT NULL;
```

Set `CURRENT_SCHEMA_VERSION` to `14`.

- [ ] **Step 4: Implement idempotent reconciliation**

Create `selectSafeAssistantFinal(events)` and `reconcileAssistantTurn(input)`. Select the latest nonblank, non-noise, non-protocol assistant text under the visible limit. Make `appendTurn` return the existing assistant row when uniqueness rejects a duplicate.

- [ ] **Step 5: Wire successful completion and startup reconciliation**

Reconcile after final provider output and before publishing terminal completion. On startup, repair completed tasks with a conversation ID but no assistant turn.

- [ ] **Step 6: Run GREEN**

Run the Task 4 Step 2 command.

Expected: exactly one assistant turn and bounded alternating transcript.

- [ ] **Step 7: Commit**

```bash
git add packages/gateway/src/db.ts packages/gateway/src/db.test.ts packages/gateway/src/p0/conversations.test.ts packages/gateway/src/services/conversations.ts packages/gateway/src/services/assistant-turn-reconciliation.ts packages/gateway/src/services/assistant-turn-reconciliation.test.ts packages/gateway/src/services/runner.ts
git commit -m "feat(chat): persist durable assistant final turns"
```

### Task 5: Unify live, approval, and final turn presentation

**Files:**
- Modify: `apps/desktop/src/renderer/lib/conversation-projector.test.ts`
- Modify: `apps/desktop/src/renderer/lib/conversation-projector.ts`
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.test.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation/live-work-card.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`

- [ ] **Step 1: Write failing projection and rendering tests**

Test that short future-tense narration is progress, terminal safe text is final, and one workspace contains exactly one approval action surface and one approve button.

```ts
expect(count(html, "data-approval-actions")).toBe(1);
expect(count(html, "data-approve-action")).toBe(1);
expect(projected.answer?.text).toBe("The implementation is ready.");
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @grokdesk/desktop test -- src/renderer/lib/conversation-projector.test.ts src/renderer/components/conversation/conversation-turn.test.tsx`

Expected: progress replaces answer or duplicate approval surfaces remain.

- [ ] **Step 3: Add `liveSummary` and stable final selection**

Extend projected turns with `liveSummary: string | null`. Keep operational narration in that field. Terminal turns select the latest safe assistant text. Streaming prose retains one response slot identity.

- [ ] **Step 4: Render one morphing state surface**

Replace separate live-work and approval blocks with one branch keyed by `turn.id`. Inline approval owns decision buttons. Workspace header becomes a passive jump link only. Remove repeated approval entrance animation on status changes.

- [ ] **Step 5: Run GREEN**

Run: `pnpm --filter @grokdesk/desktop test -- src/renderer/lib/conversation-projector.test.ts src/renderer/components/conversation/conversation-turn.test.tsx src/renderer/ui-structure.test.ts`

Expected: one approval surface and stable final response.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/lib/conversation-projector.ts apps/desktop/src/renderer/lib/conversation-projector.test.ts apps/desktop/src/renderer/components/conversation/conversation-turn.tsx apps/desktop/src/renderer/components/conversation/conversation-turn.test.tsx apps/desktop/src/renderer/components/conversation/live-work-card.tsx apps/desktop/src/renderer/components/views/task-workspace-view.tsx
git commit -m "fix(chat): unify live approval and final turn states"
```

### Task 6: Route Markdown and citation links into Desk browser

**Files:**
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/ipc.test.ts`
- Modify: `packages/gateway/src/services/tasks-core-dispatch.ts`
- Modify: `packages/gateway/src/services/tasks-core-dispatch.test.ts`
- Modify: `packages/gateway/src/services/runner.ts`
- Modify: `apps/desktop/src/renderer/components/ui/markdown.tsx`
- Modify: `apps/desktop/src/renderer/components/ui/markdown-security.test.ts`
- Modify: `apps/desktop/src/renderer/components/conversation/citation-cards.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation/citation-cards.test.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx`
- Modify: `apps/desktop/src/renderer/components/task-stream.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`

- [ ] **Step 1: Write failing RPC and link tests**

Parse a safe `browser.openUrl`, reject `javascript:`, and render Markdown/citations with `onOpenUrl`. Clicking must call the callback without `_blank`.

```ts
expect(parseIpcRequest({
  id: "1",
  method: "browser.openUrl",
  params: { taskId: "11111111-1111-4111-8111-111111111111", url: "https://example.com" },
}).method).toBe("browser.openUrl");
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @grokdesk/shared test -- src/ipc.test.ts && pnpm --filter @grokdesk/gateway test -- src/services/tasks-core-dispatch.test.ts && pnpm --filter @grokdesk/desktop test -- src/renderer/components/ui/markdown-security.test.ts src/renderer/components/conversation/citation-cards.test.tsx`

Expected: new method is rejected and links still target `_blank`.

- [ ] **Step 3: Implement `browser.openUrl`**

Add a schema accepting only credential-free HTTP(S) URLs. Delegate to `TaskRunner.openUrlInAgentBrowser(taskId, url)` through existing host/browser policy and task partition. Return `{ ok, output }` like `browser.openHtml`.

- [ ] **Step 4: Thread `onOpenUrl` through chat components**

```tsx
<a href={safe} onClick={(event) => {
  if (!onOpenUrl) return;
  event.preventDefault();
  onOpenUrl(safe);
}}>{children}</a>
```

On success reveal the right browser pane without changing chat scroll; on failure show one retryable toast. Fragments remain local and unsupported schemes remain inert.

- [ ] **Step 5: Run GREEN**

Run the Task 6 Step 2 command.

Expected: safe links use Desk browser callback and RPC; unsafe links remain inert.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/ipc.ts packages/shared/src/ipc.test.ts packages/gateway/src/services/tasks-core-dispatch.ts packages/gateway/src/services/tasks-core-dispatch.test.ts packages/gateway/src/services/runner.ts apps/desktop/src/renderer/components/ui/markdown.tsx apps/desktop/src/renderer/components/ui/markdown-security.test.ts apps/desktop/src/renderer/components/conversation/citation-cards.tsx apps/desktop/src/renderer/components/conversation/citation-cards.test.tsx apps/desktop/src/renderer/components/conversation/conversation-turn.tsx apps/desktop/src/renderer/components/task-stream.tsx apps/desktop/src/renderer/components/views/task-workspace-view.tsx
git commit -m "feat(browser): open chat links inside desk"
```

### Task 7: Smooth loading and direct conversational responses

**Files:**
- Modify: `apps/desktop/src/renderer/components/conversation-loading.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx`
- Modify: `apps/desktop/src/renderer/lib/motion-system.ts`
- Modify: `apps/desktop/src/renderer/lib/motion-system.test.ts`
- Modify: `apps/desktop/src/renderer/styles/globals.css`
- Modify: `apps/desktop/src/renderer/ui-structure.test.ts`
- Modify: `packages/engine-grok/src/build-run-prompt.test.ts`
- Modify: `packages/engine-grok/src/session.ts`

- [ ] **Step 1: Write failing motion and prompt tests**

Assert no infinite sheen/pulse in main transcript, stable `data-turn-response-slot`, reduced-motion coverage, direct-answer prompt text, no universal final-file requirement, and citation guidance for current research.

```ts
expect(loader).not.toMatch(/conversation-loading-sheen|animate-pulse/);
expect(turn).toMatch(/data-turn-response-slot/);
expect(prompt).toContain("Answer conversational questions directly");
expect(prompt).not.toContain("When finished, always write");
```

- [ ] **Step 2: Run RED**

Run: `pnpm --filter @grokdesk/desktop test -- src/renderer/lib/motion-system.test.ts src/renderer/ui-structure.test.ts && pnpm --filter @grokdesk/engine-grok test -- src/build-run-prompt.test.ts`

Expected: indefinite sheen and universal report instructions remain.

- [ ] **Step 3: Implement spatial stability and restrained motion**

Keep static transcript geometry, remove looping scan/pulse/bounce from main chat, reserve the response region, use a single 140–220 ms transform/opacity entrance, crossfade semantic progress only, and disable motion under `prefers-reduced-motion`.

- [ ] **Step 4: Make fallback prompt intent-aware**

Questions answer directly without files. Build/edit tasks produce deliverables. App actions use one structured browser attempt. Current research requires citations. Prohibit repetitive process narration and preserve media instructions only for media intent.

- [ ] **Step 5: Run GREEN**

Run the Task 7 Step 2 command plus `pnpm --filter @grokdesk/desktop test -- src/renderer/components/conversation/conversation-turn.test.tsx`.

Expected: stable motion and intent-aware prompt tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/renderer/components/conversation-loading.tsx apps/desktop/src/renderer/components/conversation/conversation-turn.tsx apps/desktop/src/renderer/lib/motion-system.ts apps/desktop/src/renderer/lib/motion-system.test.ts apps/desktop/src/renderer/styles/globals.css apps/desktop/src/renderer/ui-structure.test.ts packages/engine-grok/src/session.ts packages/engine-grok/src/build-run-prompt.test.ts
git commit -m "feat(chat): smooth and humanize conversation flow"
```

### Task 8: Add integrated real-trace coverage and run release gates

**Files:**
- Create: `apps/desktop/e2e/chat-experience.spec.ts`
- Modify: `apps/desktop/e2e/fixtures/scenarios.ts`
- Modify: `packages/agent-runtime/src/fake-provider.ts`
- Modify: `apps/desktop/e2e/playwright.config.ts`

- [ ] **Step 1: Add anonymized trace fixtures**

Include a nested image tool update, safe terminal inspection, one destructive command, progress narration, final answer with citation, and Markdown link.

- [ ] **Step 2: Write E2E assertions**

```ts
await expect(page.locator("[data-assistant-answer]")).not.toContainText("tool_call_update");
await expect(page.locator("[data-approval-actions]")).toHaveCount(1);
await page.getByRole("link", { name: /source/i }).click();
await expect(page.locator("[data-browser-open='true']")).toBeVisible();
```

- [ ] **Step 3: Run focused E2E**

Run: `pnpm --filter @grokdesk/desktop e2e -- e2e/chat-experience.spec.ts`

Expected: every new scenario passes.

- [ ] **Step 4: Run package verification**

```bash
pnpm --filter @grokdesk/engine-grok test
pnpm --filter @grokdesk/shared test
pnpm --filter @grokdesk/gateway test
pnpm --filter @grokdesk/desktop test
```

Expected: zero failures.

- [ ] **Step 5: Run full release verification**

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @grokdesk/desktop release-qa
pnpm --filter @grokdesk/desktop e2e:chat
pnpm --filter @grokdesk/desktop bundle-budget
```

Expected: every command exits 0 and bundle remains below the enforced ceiling.

- [ ] **Step 6: Inspect final scope and credential boundary**

```bash
git diff main...HEAD --check
git diff main...HEAD --stat
rg -n "keytar|safeStorage|Keychain|Credential Manager" packages apps --glob '!*.test.ts'
```

Expected: no whitespace errors, changes stay in chat/runtime scope, and no new credential storage implementation exists.

- [ ] **Step 7: Commit E2E coverage**

```bash
git add apps/desktop/e2e/chat-experience.spec.ts apps/desktop/e2e/fixtures/scenarios.ts apps/desktop/e2e/playwright.config.ts packages/agent-runtime/src/fake-provider.ts
git commit -m "test(chat): cover refined delivery experience"
```
