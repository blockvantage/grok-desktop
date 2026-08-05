# Refined Chat Adversarial Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close every reproduced policy, protocol, fallback, persistence, projection, conversational-intent, and navigation-test defect from the adversarial review.

**Architecture:** Normalize provider data into a complete fail-closed request before policy evaluation, and keep execution ownership explicit across fallback. Reconcile assistant turns from a complete, fenced event snapshot with stable chronology, then project safe text as one lossless final response. Each boundary change is introduced by a failing regression test.

**Tech Stack:** TypeScript, Vitest, SQLite/better-sqlite3, React, Electron, Playwright, pnpm.

---

### Task 1: Fail-closed tool and shell authorization

**Files:**
- Modify: `packages/engine-grok/src/events.ts`
- Test: `packages/engine-grok/src/events.test.ts`
- Modify: `packages/shared/src/policy.ts`
- Test: `packages/shared/src/policy.test.ts`
- Modify: `packages/shared/src/safe-shell-command.ts`
- Test: `packages/shared/src/safe-shell-command.test.ts`

- [x] **Step 1: Write failing normalization and policy tests**

```ts
expect(parseTool({ name: "write_file", input: { path: "/outside/x" } })).toMatchObject({ path: "/outside/x" });
expect(parseTool({ name: "exec", input: { command: "rm -rf build" } })).toMatchObject({ tool: "shell" });
expect(evaluateToolRequest(balanced, { tool: "other" }).decision).not.toBe("allow");
```

- [x] **Step 2: Write failing shell-classifier tests**

```ts
for (const command of ["cat ~/.ssh/id_rsa", "git branch --unset-upstream"]) {
  expect(classifyBalancedShellCommand(command, roots).safe).toBe(false);
}
```

- [x] **Step 3: Run focused tests and confirm RED**

Run: `pnpm --filter @grokdesk/engine-grok test -- src/events.test.ts && pnpm --filter @grokdesk/shared test -- src/policy.test.ts src/safe-shell-command.test.ts`

Expected: failures show missing nested paths, `exec -> other`, default allow, and unsafe shell reads.

- [x] **Step 4: Implement complete normalization and fail-closed policy**

Extract `path` and `command` from the normalized input object, map command aliases to `shell`, require approval for `other`, reject home expansion and mutation flags, and require verification scripts to remain explicitly classifiable.

- [x] **Step 5: Run focused tests and confirm GREEN**

Run the Task 1 command and expect all selected tests to pass.

### Task 2: Protocol quarantine and fallback ownership

**Files:**
- Modify: `packages/engine-grok/src/events.ts`
- Test: `packages/engine-grok/src/events.test.ts`
- Modify: `packages/gateway/src/services/agent-provider-engine.ts`
- Test: `packages/gateway/src/services/agent-provider-engine.test.ts`
- Modify: `packages/gateway/src/services/runner.ts`
- Test: `packages/gateway/src/services/runner.test.ts`

- [x] **Step 1: Write failing parser tests**

```ts
expect(parse({ type: "tool_result", content: "secret" })[0]?.type).toBe("tool_result");
expect(parse({ type: "error", text: "failed" })[0]?.type).toBe("error");
expect(parse(fourNestedToolEnvelopes)).toEqual([]);
```

- [x] **Step 2: Write a failing fallback-ownership test**

Create a mediated provider whose session creation fails and a self-executing fallback that emits a write request; assert the runner does not host-execute the fallback event.

- [x] **Step 3: Run focused tests and confirm RED**

Run: `pnpm --filter @grokdesk/engine-grok test -- src/events.test.ts && pnpm --filter @grokdesk/gateway test -- src/services/agent-provider-engine.test.ts src/services/runner.test.ts`

- [x] **Step 4: Dispatch protocol types before generic text and expose active execution ownership**

Drop protocol-shaped envelopes at the nesting limit. Make the provider wrapper report fallback execution ownership while fallback is active and make runner host execution consult the run engine’s current contract.

- [x] **Step 5: Run focused tests and confirm GREEN**

Run the Task 2 command and expect all selected tests to pass.

### Task 3: Durable, ordered, lossless assistant turns

**Files:**
- Modify: `packages/gateway/src/services/assistant-turn-reconciliation.ts`
- Test: `packages/gateway/src/services/assistant-turn-reconciliation.test.ts`
- Modify: `packages/gateway/src/services/conversations.ts`
- Test: `packages/gateway/src/p0/conversations.test.ts`
- Modify: `packages/gateway/src/services/runner.ts`
- Test: `packages/gateway/src/services/runner-multi-instance.test.ts`
- Modify: `packages/gateway/src/index.ts`
- Test: `packages/gateway/src/db.test.ts`

- [x] **Step 1: Write failing assembly, pagination, chronology, and lease-race tests**

```ts
expect(selectSafeAssistantFinal([paragraph1, citations, paragraph2])).toBe("Paragraph 1\n\nParagraph 2");
expect(backfilledTurns.map((turn) => turn.role)).toEqual(["user", "assistant", "user", "assistant"]);
expect(staleAttemptAssistantRows).toHaveLength(0);
```

- [x] **Step 2: Run focused gateway tests and confirm RED**

Run: `pnpm --filter @grokdesk/gateway test -- src/services/assistant-turn-reconciliation.test.ts src/p0/conversations.test.ts src/services/runner-multi-instance.test.ts src/db.test.ts`

- [x] **Step 3: Implement complete event scanning and deterministic assistant upsert**

Paginate task events to exhaustion, assemble safe message groups without losing text across non-message metadata, carry the selected event timestamp into the turn, and update the existing assistant row when reconciliation produces a newer authoritative result.

- [x] **Step 4: Fence persistence to successful completion ownership**

Move reconciliation behind or into successful run-attempt completion so a stale lease cannot publish the durable assistant row.

- [x] **Step 5: Run focused gateway tests and confirm GREEN**

Run the Task 3 command and expect all selected tests to pass.

### Task 4: Final projection, conversational intent, and browser proof

**Files:**
- Modify: `apps/desktop/src/renderer/lib/conversation-projector.ts`
- Test: `apps/desktop/src/renderer/lib/conversation-projector.test.ts`
- Modify: `packages/engine-grok/src/session.ts`
- Test: `packages/engine-grok/src/build-run-prompt.test.ts`
- Modify: `apps/desktop/e2e/chat-experience.spec.ts`
- Modify: `apps/desktop/e2e/fixtures/scenarios.ts`

- [x] **Step 1: Write failing projection and intent tests**

```ts
expect(projectDone("I’ll explain the tradeoffs directly.").answer?.text).toBe("I’ll explain the tradeoffs directly.");
expect(promptFor("Please explain how to fix this error")).not.toContain("Create the requested deliverables");
```

- [x] **Step 2: Run focused tests and confirm RED**

Run: `pnpm --filter @grokdesk/desktop test -- src/renderer/lib/conversation-projector.test.ts && pnpm --filter @grokdesk/engine-grok test -- src/build-run-prompt.test.ts`

- [x] **Step 3: Promote terminal-safe narration and prioritize explanatory intent**

Keep narration transient only while live; on terminal state, preserve it as the answer when no stronger final exists. Normalize polite prefixes before explanatory-intent classification.

- [x] **Step 4: Strengthen Electron link assertions**

Assert a successful `browser_open` receipt and the expected destination URL after clicking Markdown/citation links; pane visibility alone is insufficient.

- [x] **Step 5: Run focused tests and confirm GREEN**

Run the Task 4 unit command, then the chat-experience E2E spec.

### Task 5: Full verification and review

**Files:**
- Verify all modified files

- [x] **Step 1: Run formatting and diff checks**

Run: `git diff --check`

- [x] **Step 2: Run typecheck and complete workspace tests**

Run: `pnpm typecheck && pnpm test`

- [x] **Step 3: Run production build and release QA**

Run: `pnpm build && pnpm --filter @grokdesk/desktop release-qa`

- [x] **Step 4: Run chat E2E and visual QA**

Use the repository’s existing `test:e2e:chat` and visual-QA commands with the required Node/Electron environment.

- [x] **Step 5: Inspect the final diff and report residual risk**

Confirm every adversarial finding has a regression test, no credential-vault implementation changed, and no unrelated user work was overwritten.
