# Conversation orchestration QA

Executed on 2026-07-16 against commit `f0861c1` on macOS arm64.

## Release decision

PASS for the conversation, queue, worker, approval, task-lifecycle, and in-app browser scope in the implementation plan. The final blocker-only audit found no remaining Critical or Important issues. The signed packaged app opened local HTML in the native browser pane without showing the external-browser fallback.

The browser row below is packaged-app end-to-end evidence. The other matrix rows are deterministic renderer, gateway, and shared-database integration evidence. They are labelled accordingly; they were not represented as manual packaged click-throughs.

## Verification summary

- `git diff --check`: passed.
- `pnpm typecheck`: passed across the workspace.
- `pnpm test`: passed, 1,649 tests total.
  - shared: 207
  - gateway: 566
  - desktop: 694
  - agent runtime: 4
  - license: 16
  - remote relay: 4
  - mobile: 40
  - Grok engine: 90
  - echo provider: 3
  - Grok provider: 25
- `pnpm --filter @grokdesk/desktop dist:mac`: passed.
- `codesign --verify --deep --strict --verbose=2`: valid on disk and satisfies its Designated Requirement.
- macOS notarization: skipped because notarization options/credentials were not configured.

Final artifact checksums:

```text
539b950e227491067dd187bd5d04db7779acb84e7e5bbc9e987b9e5fce415cc5  Grok Desk-0.1.2-arm64.dmg
6da30f5b8273d199f61d538afd47466bbbd082b7c7480e66bf5821d38b0fa6de  Grok Desk-0.1.2-arm64-mac.zip
```

## QA matrix

| # | Scenario | Result | Evidence |
|---|---|---|---|
| 1 | Two-sentence answer has no redundant thought row | PASS — integration | Conversation projection retains provider noise only as diagnostic work; the completed-turn component renders the final Markdown answer with work closed. |
| 2 | Long read-only run has one meaningful live card and a complete final answer | PASS — integration | Conversation-turn tests assert exactly one calm live-work card, controlled work details, and a complete final answer. |
| 3 | One follow-up queued during a run creates exactly one accepted task | PASS — integration | Queue remount tests reuse one `clientMutationId`; atomic acceptance tests retain one task, one run attempt, one mutation receipt, and one submit receipt. |
| 4 | Editing a queued item runs only the edited text | PASS — integration | Workspace queue tests assert atomic edited-text submission and reject stale lease completion. |
| 5 | Two concurrent workers retain independent state and connected results | PASS — integration | Projector and conversation-turn tests assert worker labels/counts, worker-specific filtering, isolated event buckets, and stable turn identity. |
| 6 | A failed worker does not prevent a successful primary run | PASS — integration | Projector coverage contains worker failure while the primary remains actionable and derives a turn-level failure only from the primary task. |
| 7 | Approval shows one decision surface and cannot race cancellation | PASS — integration | Conversation-turn coverage asserts the only approval controls live in the affected turn. Shared-database runner tests prove remote cancellation drains pending approval, stale approval cannot revive the task, write a file, call the host, or record an executed receipt. |
| 8 | Browser activity opens in-app and appears as connected work | PASS — packaged end-to-end | The signed app created a real task, reported browser capability ready/active, opened workspace HTML through `browser.openHtml`, mounted the native pane, marked the globe active, and showed no “In-app browser is unavailable / Use external browser” prompt. Playwright: 1/1 passed in 42.1 seconds. |
| 9 | Editing the latest message marks the source Edited and excludes its request from revised context | PASS — integration | Turn rendering marks superseded source turns Edited; projector tests preserve the revision relationship; gateway conversation tests cut superseded request context from the revised run. |
| 10 | Restart during queue submission does not create a duplicate task | PASS — shared-database integration | Crash-boundary acceptance and duplicate-retry tests reopen the same SQLite database, reconcile the committed task, and return the original task. Queue remount tests keep the same mutation identity across recovery. |

## Exactly-once database evidence

The acceptance tests execute against disposable SQLite databases and query the durable rows after simulated acceptance/restart boundaries. For one `clientMutationId`, the asserted result is:

```text
tasks = 1
task_run_attempts = 1
user turns for task = 1
mutation_receipts = 1
operation_receipts where action = task.submit = 1
```

A duplicate retry returns the original task ID and leaves the same single user turn and task row. The two-connection runner tests additionally prove only one engine side effect occurs after concurrent eligibility, silent runs keep their lease, stale owners cannot terminalize a new owner, and a non-owner shutdown cannot cancel foreign work. No prompt text or credentials were copied into this report.

## Packaged browser command

```bash
pnpm --dir apps/desktop exec playwright test \
  -c e2e/playwright.config.ts \
  e2e/browser-capability.spec.ts
```

Result:

```text
1 passed (42.1s)
opens local HTML in the in-app browser without external fallback
```

## Additional notes

- An optional account/onboarding Electron suite was not used as release evidence. A separate Grok Desk process using the normal profile was already active, and the first isolated fresh-window case reached its 120-second launch timeout; the run was interrupted rather than misreported. Account, sign-out, onboarding, and sign-in state remain covered by the 694-test desktop suite.
- Native Computer Use could not be used for this run because its local bridge was unavailable. The packaged Playwright/Electron path exercised the actual signed binary instead.
- Browser-pane rendered-element selection/commenting remains the explicitly separate follow-on project described in the implementation plan.
