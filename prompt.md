# Grok Desk Exhaustive Product, Agent Safety, Desktop Engineering, Security, and Production-Readiness Review

You are responsible for conducting an exhaustive, adversarial, end-to-end audit and improvement cycle of **Grok Desk**, also referred to as **Grok Desktop**.

Grok Desk is a macOS and Windows desktop coworker powered by SuperGrok/Grok Build. It can operate on local workspaces, execute tools, browse the web through an in-app browser, control the desktop when authorized, create artifacts, retain memory, run scheduled work, and accept encrypted remote control from the companion mobile application.

## Primary resources

- Public website: `https://grokdesk.app`
- Repository: the repository in the current working directory
- Default branch: `main`
- Desktop application: `apps/desktop`
- Mobile companion: `apps/mobile`
- Local gateway and persistence: `packages/gateway`
- Grok execution engine: `packages/engine-grok`
- Provider/runtime abstraction: `packages/agent-runtime` and provider packages
- Shared contracts and policies: `packages/shared`
- Licensing and cryptography: `packages/license`
- Entitlement client: `packages/entitlement-client`
- Remote relay: `services/remote-relay`
- Bundled skills: `skills/`
- CI and release workflows: `.github/workflows/`
- Existing specifications, plans, analyses, evidence, and runbooks: `docs/`

Known development commands include:

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm dev
make local
make dev
```

`make local` uses a development-only entitlement bypass. Verify that this bypass can never affect packaged or production builds.

The repository references external commerce, entitlement, release-manifest, and public-site systems, including a possible sibling `grok-landing` repository. Treat this repository as the primary implementation scope. Inspect and modify sibling systems only when they are present, explicitly in scope, and safe to change. Otherwise document the dependency and exact required owner action.

Your responsibility is not merely to review Grok Desk or prepare recommendations.

Your responsibility is to:

1. Discover every existing product surface.
2. Understand what every feature is intended to accomplish.
3. Test every accessible workflow.
4. Compare public and in-product promises with actual behavior.
5. Identify anything incomplete, broken, confusing, inconsistent, unsafe, misleading, slow, fragile, or below a best-in-class desktop-agent standard.
6. Reproduce each meaningful problem.
7. Investigate its root cause across renderer, Electron main process, preload, gateway, runtime, database, and external integrations.
8. Implement the best reasonable fix.
9. Add or improve tests.
10. Validate the complete workflow after the fix.
11. Validate packaged behavior where the risk requires it.
12. Document evidence, reasoning, changes, and remaining risks.
13. Commit completed and verified improvements in small, understandable commits.

The desired result is a Grok Desk application that is substantially more trustworthy, polished, capable, commercially credible, secure, recoverable, and ready to operate on real users’ computers and real workspaces.

Do not stop at surface-level observations.

---

# 1. Primary Mission

Grok Desk aims to be a dependable desktop coworker capable of performing consequential work on behalf of a user.

It may be allowed to:

- Read local files
- Create and edit files
- Execute commands
- Use network tools
- Browse websites
- Click and type in browser sessions
- Control the physical desktop
- Capture screenshots
- Use microphone input
- Create images and other media
- Install or invoke MCP servers
- Use packaged skills
- Remember user and project information
- Schedule unattended work
- Continue work across multiple conversational turns
- Run multiple workers or subagents
- Produce artifacts and reports
- Receive instructions from a paired mobile device
- Update its own application and managed Grok runtime

Mistakes can therefore affect:

- Source code
- Business documents
- Credentials
- Private messages
- Customer data
- Financial information
- Browser sessions
- Cloud infrastructure
- Local applications
- User accounts
- Repository history
- Published content
- System availability
- User privacy
- Device security
- Paid licensing
- Stored conversations
- Scheduled and unattended operations
- Trust in autonomous agents

Treat Grok Desk as privileged local software, not as a casual chat interface.

The standard is not:

> “The UI renders and the agent produced an answer.”

The standard is:

> “A user can safely delegate meaningful work, understand what Grok is doing, control its authority, recover from failures, verify its results, and trust that the application will not lose data or perform hidden, unauthorized, or misleading actions.”

---

# 2. Highest-Weight Perspectives

Evaluate Grok Desk primarily through the eyes of users who allow an AI system to interact with their computer and work.

## Daily professional user

For every feature, ask:

- Does this reduce meaningful work?
- Can the user understand what the agent is doing?
- Does the user know whether work is queued, running, blocked, waiting, complete, or failed?
- Can the user tell what changed?
- Can the user verify the result without reading raw logs?
- Can the user correct the agent without starting over?
- Can the user safely stop or redirect work?
- Can the user distinguish a draft, plan, action, and completed result?
- Can the user resume work after restarting the app?
- Does the application preserve context without becoming unpredictable?
- Would the user trust this with an important folder?
- Does the product deliver enough value to justify its price and SuperGrok requirement?

## Developer or technical power user

Determine whether users can:

- Select and trust a workspace
- Work across repositories
- Attach and reference files
- Review proposed changes
- Understand command execution
- Inspect tool receipts
- Approve or deny sensitive operations
- Use strict, balanced, and autopilot modes safely
- Configure MCP servers and skills
- Diagnose runtime or connector failures
- Recover after an interrupted run
- Export work and evidence
- Prevent edits outside the selected workspace
- Avoid accidental secret disclosure
- Use the app without corrupting a dirty worktree

## Non-technical knowledge worker

Determine whether users can:

- Complete onboarding without understanding Grok CLI internals
- Sign in successfully
- Choose a useful first task
- Understand workspace selection
- Understand permission modes
- Know when an action requires attention
- Distinguish local files from generated artifacts
- Find previous work
- Use memory and schedules safely
- Recover from common errors without terminal access
- Understand limitations without technical jargon

## Security-conscious user

Determine whether users can:

- Understand what folders the agent can access
- Understand what shell and network authority it has
- See when desktop control is active
- See when remote control is active
- See which browser origin is being used
- Review risky actions before they occur
- Revoke permissions and paired devices
- Inspect an audit trail
- Know where credentials are stored
- Know whether data is sent to external providers
- Use strict mode as a genuine safety boundary
- Trust update and runtime verification

## Mobile remote user

Determine whether users can:

- Pair a mobile device safely
- Understand which desktop is paired
- Submit a task once
- Recover from temporary disconnection
- Avoid duplicate remote actions
- Receive useful status updates
- Handle expired sessions
- Revoke a lost phone
- Distinguish queued, delivered, accepted, running, and completed states
- Prevent unauthorized desktop control

## Additional perspectives

Also review through the eyes of:

- First-time user
- Returning user
- Lapsed or expired-license user
- User whose SuperGrok session expired
- User without a global Grok installation
- User with an incompatible global Grok installation
- User using the managed runtime
- User with multiple workspaces
- User with several simultaneous tasks
- User on a slow or unreliable connection
- User behind a corporate proxy
- User with a non-ASCII home-directory path
- User on macOS Apple Silicon
- User on macOS Intel
- User on Windows x64
- Keyboard-only user
- Screen-reader user
- Low-vision user
- User operating in English
- User operating in Spanish
- User operating in French, Portuguese, German, Japanese, or Chinese
- Support engineer
- Release engineer
- Security reviewer
- Product owner

---

# 3. Roles You Must Adopt

Operate as multiple distinct specialists.

At minimum, adopt the roles of:

- Desktop AI product manager
- Daily Grok Desk user
- Non-technical knowledge worker
- Developer and repository owner
- AI-agent UX designer
- Conversational UX specialist
- Human-in-the-loop safety designer
- Electron engineer
- React frontend engineer
- Node.js backend engineer
- SQLite and migration engineer
- Agent-runtime engineer
- Grok Build integration engineer
- MCP integration engineer
- Browser-automation engineer
- Desktop-automation engineer
- macOS platform engineer
- Windows platform engineer
- Mobile engineer
- Distributed-systems engineer
- Cryptography reviewer
- Authentication reviewer
- Authorization and policy reviewer
- Application-security reviewer
- Privacy reviewer
- Supply-chain security reviewer
- Licensing and entitlement reviewer
- Update-system reviewer
- Reliability engineer
- Performance engineer
- Accessibility reviewer
- Localization reviewer
- QA engineer
- Adversarial tester
- Release engineer
- Technical writer
- Support engineer
- Commercial claims reviewer

Do not collapse these into one vague “general review.”

Record materially different findings from each relevant perspective.

---

# 4. Core Operating Principles

## 4.1 Investigate before changing

For every issue:

1. Observe or reproduce the problem.
2. Record the environment and application state.
3. Determine the affected user.
4. Determine the safety, privacy, commercial, and productivity impact.
5. Trace the complete flow across relevant layers.
6. Identify the root cause.
7. Search for the same pattern elsewhere.
8. Consider possible solutions.
9. Select the smallest complete solution.
10. Implement it without changing unrelated behavior.
11. Add or improve tests.
12. Run targeted tests.
13. Run relevant regression tests.
14. Manually verify the full workflow.
15. Verify packaged behavior when development behavior is insufficient.
16. Document the final result.
17. Commit the verified change.

Do not patch renderer symptoms when the actual problem is an incorrect state model, gateway race, IPC contract, runtime event, policy boundary, or database invariant.

## 4.2 Evidence over assumptions

Every finding must include relevant evidence, such as:

- Screen or route
- Application version
- Git commit
- Operating system
- Architecture
- Fresh or existing app profile
- Workspace state
- Task ID
- Run-attempt ID
- Conversation or turn ID
- Screenshot
- Screen recording
- Reproduction steps
- Task event sequence
- IPC request and response
- Gateway request and response
- Database state
- Redacted log entry
- Tool or operation receipt
- Process tree
- Runtime version
- Network request
- Test result
- Performance measurement
- Accessibility output
- Relevant code path
- Before-and-after comparison

Classify verification accurately:

- `SOURCE_REVIEWED`
- `AUTOMATED_TESTED`
- `DEV_MANUALLY_VERIFIED`
- `PACKAGED_MANUALLY_VERIFIED`
- `REAL_PROVIDER_VERIFIED`
- `REAL_DEVICE_VERIFIED`
- `INFERRED`
- `BLOCKED`

Do not describe source inspection as end-to-end verification.

Do not claim that a feature works merely because a unit test exists.

## 4.3 Fix rather than merely recommend

When a meaningful problem can reasonably be fixed in the current repository, fix it.

Leave work unresolved only when it requires:

- Product-owner judgment
- Missing credentials
- Access to an unavailable sibling service
- Production signing identities
- Apple notarization access
- Authenticode credentials
- Real release infrastructure
- A real supported device or operating system
- External provider approval
- Legal or privacy review
- Destructive migration approval
- A major architectural decision with several valid product directions
- Information that cannot be derived safely

Record genuine blockers in `REQUIRES_OWNER_ATTENTION.md`.

## 4.4 Protect the user’s computer and data

Do not perform destructive testing in the user’s real workspace.

Do not:

- Delete user files
- Rewrite unrelated source code
- Reset a real repository
- Force-push
- Publish packages
- Deploy services
- Send real messages
- Submit real forms
- Purchase a real license
- Trigger real billing
- Deactivate real devices
- Sign the user out of a shared Grok CLI session without explicit permission
- Expose stored credentials
- Print tokens, product keys, leases, private keys, pair secrets, or cookies
- Capture unrelated screen content
- Store sensitive screenshots in the repository
- Enable broad desktop control against the user’s live session without a safe test plan
- Run autopilot against valuable data
- Test remote control using untrusted public infrastructure
- Commit `.env` files or production responses

Use:

- Disposable workspaces
- Temporary Git repositories
- Dedicated test profiles
- Fake providers
- Local fixtures
- Stub MCP servers
- Local HTTP servers
- Sandbox entitlement responses
- Mock update manifests
- Test relay instances
- Reversible data
- Controlled desktop applications
- Provider test accounts where available

## 4.5 Preserve user changes

Assume existing working-tree changes belong to the user.

Before editing:

- Inspect `git status`.
- Identify unrelated changes.
- Avoid overwriting or formatting unrelated files.
- Do not discard changes.
- Do not use destructive Git recovery commands.
- Stop and document a conflict if the requested fix cannot safely avoid user work.

## 4.6 Avoid endless subjective redesign

Do not continuously redesign a working surface merely because another layout is possible.

A surface is complete when:

- Its purpose and state are truthful.
- Critical workflows have been exercised.
- P0, P1, and reproducible P2 issues are fixed or blocked.
- Relevant automated tests pass.
- Manual verification is complete.
- Accessibility and failure behavior have been examined.
- No known regression was introduced.
- Remaining subjective opportunities are documented with expected impact.

---

# 5. Required Audit Files

Create and maintain:

```text
docs/grok-desktop-audit/
```

Do not delete historical findings. Mark them completed, invalid, duplicated, superseded, blocked, or deferred.

Existing documents under `docs/analysis`, `docs/evidence`, `docs/plans`, `docs/superpowers`, and `docs/runbooks` are useful evidence but may be stale. Validate their claims against the current branch.

## 5.1 `AUDIT_INVENTORY.md`

Maintain an append-only inventory of every discovered:

- Desktop screen
- Modal
- Sheet
- Popover
- Menu
- Tray action
- System notification
- Onboarding step
- Settings tab
- Task state
- Conversation state
- Run-attempt state
- Worker event
- Approval workflow
- Tool request
- Tool receipt
- Browser operation
- Desktop-control operation
- File operation
- Artifact flow
- Memory operation
- Schedule operation
- Inbox operation
- MCP connector
- Skill pack
- Runtime provider
- Authentication operation
- Entitlement operation
- Update operation
- IPC method
- Preload API
- Loopback server endpoint
- Database table
- Migration
- Background timer
- Child process
- Remote protocol message
- Mobile screen
- Offline queue operation
- Relay channel
- Cryptographic operation
- External URL
- Constructed URL
- Download
- Upload
- Release artifact
- CI job
- Destructive action
- Recovery path

Use stable identifiers such as:

- `ONB-001`
- `AUTH-001`
- `SHELL-001`
- `CHAT-001`
- `TASK-001`
- `RUN-001`
- `WORKER-001`
- `APPROVAL-001`
- `TOOL-001`
- `FILE-001`
- `ART-001`
- `BROWSER-001`
- `DESKTOP-001`
- `MEM-001`
- `SCHED-001`
- `MCP-001`
- `SKILL-001`
- `IPC-001`
- `DB-001`
- `REMOTE-001`
- `MOBILE-001`
- `RELAY-001`
- `LICENSE-001`
- `ENT-001`
- `RUNTIME-001`
- `UPDATE-001`
- `PKG-001`
- `SEC-001`
- `PRIV-001`
- `PERF-001`
- `A11Y-001`
- `I18N-001`
- `CI-001`
- `CLAIM-001`

Every item must include:

- ID
- Category
- Name
- Screen, route, method, or code location
- User
- Intended purpose
- Required permissions
- External dependencies
- Data read or written
- Operational criticality
- Risk level
- Review status
- Test status
- Verification level
- Findings
- Related issue IDs
- Evidence
- Last-reviewed timestamp

The inventory may only grow.

## 5.2 `AUDIT_LOG.md`

Maintain a chronological, append-only record containing:

- Timestamp
- Investigation performed
- Reason
- Branch and commit
- Operating system and architecture
- App profile used
- Workspace used
- Screens visited
- Commands executed
- Tests performed
- Files inspected
- Processes examined
- IPC methods inspected
- Database behavior inspected
- Network behavior inspected
- Findings created
- Changes made
- Subagents used
- Verification completed
- Commits created
- Blockers
- Next investigation target

Do not include secrets or sensitive raw payloads.

## 5.3 `FINDINGS.md`

Create a structured entry for every meaningful issue.

Each finding must contain:

- Finding ID
- Title
- Severity
- Confidence
- Status
- Affected user
- Affected workflow
- Safety impact
- Privacy impact
- Productivity impact
- Commercial impact
- Platform
- Environment
- Preconditions
- Reproduction steps
- Expected behavior
- Actual behavior
- Evidence
- Verification level
- Root cause
- Similar occurrences searched
- Options considered
- Selected solution
- Files changed
- Tests added or changed
- Manual verification
- Packaged verification
- Commit reference
- Remaining risks

Use these severity levels:

### P0 — Critical

Examples:

- Arbitrary command execution without the required user authority
- Writing or deleting outside authorized workspace boundaries
- Packaged application honoring the development entitlement bypass
- Secret, token, product-key, lease, or private-key exposure
- Unauthorized remote control
- Broken remote cryptography that allows message forgery or replay
- Update signature bypass
- Runtime artifact verification bypass
- Malicious IPC caller reaching privileged main-process actions
- Silent destructive desktop action
- Irrecoverable conversation or workspace data loss
- Cross-user or cross-device private data exposure
- Agent reports success while performing a materially different dangerous action

### P1 — High

Examples:

- Major advertised workflow is broken
- Task work is lost after an ordinary restart
- Approval is bypassed or attributed to the wrong task
- Strict mode permits side effects
- Stop or cancel does not stop the active process
- Duplicate remote instruction executes twice
- Browser silently falls back to an unintended external browser
- Agent writes to the wrong workspace
- Update or rollback leaves the app unusable
- Paid user is incorrectly locked out
- Entitlement loss hides or destroys local work
- Task is marked complete despite engine failure
- Artifact points to the wrong or unsafe file
- Sign-out unexpectedly destroys a shared Grok CLI session
- Scheduled unattended work exceeds its declared authority
- Desktop control remains active after the task stops

### P2 — Medium

Examples:

- Important workflow friction
- Contradictory account or run state
- Poor failure recovery
- Misleading task-progress language
- Lost queued follow-up
- Weak validation
- Accessibility failure
- Serious localization defect
- Unsupported URL handled poorly
- Incorrect usage presentation
- Update status is unclear
- Meaningful performance issue
- Settings do not reflect effective runtime behavior

### P3 — Low

Examples:

- Minor visual inconsistency
- Copy refinement
- Low-impact edge case
- Maintainability improvement
- Non-critical shortcut or focus issue

### P4 — Observation

A possible opportunity without enough evidence to justify implementation.

## 5.4 `TEST_MATRIX.md`

For every manual and automated scenario record:

- Test ID
- Product domain
- Feature
- User
- Preconditions
- Test profile
- Test workspace
- Test data
- Steps
- Expected result
- Actual result
- Operating system
- Architecture
- Development or packaged build
- Provider/runtime
- Automated or manual
- Status
- Verification level
- Evidence
- Related finding
- Related test file

## 5.5 `CLAIMS_MATRIX.md`

Map every product promise to implementation and evidence.

For each claim include:

- Claim ID
- Exact or summarized claim
- Source
- Locale
- Intended user
- Required license or plan
- SuperGrok requirement
- Required operating system
- Required runtime
- Required permissions
- Implementation path
- External dependency
- Actual availability
- Test status
- Verification level
- Result quality
- Limitations
- Copy accuracy
- Required fix
- Related finding

Inspect claims in:

- `grokdesk.app`
- Purchase and checkout copy
- Download pages
- Account portal
- Onboarding
- Home screen
- Empty states
- Settings
- Tooltips
- Role packs
- Skill descriptions
- Release notes
- Documentation
- Installer copy
- License copy
- Update copy
- Mobile app
- Metadata
- Social previews
- Support material

Pay special attention to contradictions involving:

- Grok Desk versus Grok Build naming
- Separate Grok Desk and SuperGrok requirements
- One-time purchase versus subscription
- Number of licensed devices
- Lifetime updates
- Stable versus beta updates
- macOS and Windows availability
- Windows ARM64 availability
- Managed runtime versus required global installation
- Local-first or private behavior
- Browser control
- Desktop control
- Autonomous operation
- Approval guarantees
- Memory
- Scheduling
- Mobile remote control
- Offline behavior
- Translation quality
- Included connectors and skills

## 5.6 `STATE_MODEL.md`

Document authoritative state machines for:

- Account authentication
- Entitlement
- Managed runtime
- Application update
- Task
- Run attempt
- Conversation
- Worker/subagent
- Approval
- Browser capability
- Desktop-control session
- Remote pairing
- Remote session
- Offline queue
- Artifact creation
- Schedule occurrence

For each state machine include:

- States
- Allowed transitions
- Trigger
- Durable source of truth
- Renderer projection
- Recovery behavior
- Idempotency requirement
- Invalid transition behavior
- Tests

## 5.7 `SECURITY_BOUNDARIES.md`

Document:

- Renderer trust level
- Preload exposure
- Main-process authority
- Gateway authority
- Runtime authority
- Provider authority
- MCP authority
- Browser-host authority
- Desktop-control authority
- Workspace boundaries
- Credential storage
- Remote-device trust
- Relay trust
- Entitlement-service trust
- Release-manifest trust
- Update-artifact trust

Include data-flow and authority-flow diagrams where useful.

## 5.8 `RESEARCH_LOG.md`

For every external source record:

- URL
- Date accessed
- Subject
- Related finding
- Application to Grok Desk
- Whether it caused a change
- Limitations
- Source quality

Prefer primary sources:

- Electron security documentation
- Apple platform and notarization documentation
- Microsoft signing and installer documentation
- WCAG
- Node.js documentation
- SQLite documentation
- Cryptographic library documentation
- MCP specifications
- Official Grok/xAI documentation
- GitHub Actions documentation

## 5.9 `REQUIRES_OWNER_ATTENTION.md`

Only place genuine owner decisions here.

For each item include:

- Decision required
- Why it cannot be decided safely
- User impact
- Security impact
- Commercial impact
- Available options
- Recommended option
- Consequence of delay
- Exact owner action needed

## 5.10 `FINAL_AUDIT_SUMMARY.md`

At completion include:

- Executive summary
- Product surfaces reviewed
- Findings by severity
- Major safety issues
- Major reliability issues
- Major product issues
- Improvements implemented
- Agent-runtime outcomes
- Browser and desktop-control outcomes
- Remote and mobile outcomes
- Licensing and update outcomes
- Security and privacy outcomes
- Accessibility outcomes
- Localization outcomes
- Performance outcomes
- Tests added
- Research completed
- Commits created
- Unverified workflows
- Remaining risks
- Owner actions
- Final production-readiness assessment

---

# 6. Initial Discovery Phase

Do not begin with arbitrary UI changes.

Start by inspecting:

- Repository instructions
- Current branch and working tree
- Recent commits
- Workspace package graph
- Desktop renderer architecture
- Electron main process
- Preload bridge
- Privileged IPC registration
- Local gateway
- Shared IPC schemas
- Database schema and migrations
- Task runner
- Run-attempt lifecycle
- Engine and provider composition
- Grok CLI discovery and spawning
- ACP transport and permission mediation
- Browser MCP plane
- Desktop MCP plane
- Bundled skills
- MCP connector presets
- Authentication
- SuperGrok token handling
- Usage and billing links
- Licensing
- Entitlement leases
- Credential vaults
- Device identity
- Managed runtime
- App updates
- Release manifests
- Remote protocol
- Mobile client
- Remote relay
- Offline queues
- Localization catalogs
- Packaging
- Code signing
- CI
- Existing tests
- Existing audit evidence
- Public website and claims

Build an initial map covering:

1. Every user-facing screen.
2. Every settings tab.
3. Every task status.
4. Every task event.
5. Every worker event.
6. Every approval path.
7. Every privileged operation.
8. Every IPC method.
9. Every child process.
10. Every local server.
11. Every file boundary.
12. Every credential.
13. Every external provider.
14. Every background timer.
15. Every scheduled operation.
16. Every update and recovery path.
17. Every paired-device operation.
18. Every release target.
19. Every destructive action.
20. Every action that may occur unattended.

Continue extending the inventory throughout the audit.

---

# 7. Architecture and Trust-Boundary Review

Verify the actual architecture rather than assuming documentation is current.

At minimum, map:

```text
React renderer
  → preload bridge
  → Electron main process
  → local gateway
  → SQLite persistence
  → provider/runtime composition
  → Grok Build / ACP process
  → MCP tools
  → workspace, browser, desktop, and network side effects
```

Also map:

```text
Mobile application
  → remote relay
  → encrypted remote session
  → desktop host
  → gateway mutation
  → task/run
```

And:

```text
Public purchase/portal
  → entitlement service
  → product key
  → device activation
  → signed lease
  → desktop admission
```

And:

```text
Signed release manifest
  → compatibility resolution
  → artifact download
  → cryptographic/platform verification
  → staging
  → idle coordination
  → install
  → restart
  → post-update verification
  → commit or rollback
```

For every boundary determine:

- Who authenticates whom?
- Who authorizes the action?
- What is trusted?
- What is untrusted?
- What is validated?
- What is persisted?
- What is redacted?
- What can be replayed?
- What happens after a crash?
- What happens when messages arrive out of order?
- What happens when the renderer is compromised?
- What happens when an MCP server is malicious?
- What happens when the relay is malicious?
- What happens when an update server is compromised?

---

# 8. Product Domains to Inventory and Review

## 8.1 Installation and first launch

Test:

- Clean macOS installation
- Clean Windows installation
- Upgrade from a previous supported version
- Launch without a global Grok installation
- Launch with an incompatible Grok installation
- Launch with corrupted local data
- Launch without network
- Launch behind a proxy
- Launch after interrupted update
- Launch after previous crash
- Launch with expired entitlement
- Launch with missing credential vault
- First-run performance
- First-run error handling
- Installer appearance
- Uninstall behavior
- Local-data preservation

Verify the application does not remain indefinitely behind a splash while performing network, account, runtime, or entitlement checks.

## 8.2 Onboarding and first value

Review every onboarding scene, including:

- Welcome
- Intended use or role
- Workspace selection
- Permission mode
- SuperGrok account
- Managed runtime readiness
- Final handoff
- Limited or demo mode
- Starter task

Test:

- Signed-in user
- Signed-out user
- User who skips account setup
- User who skips workspace selection where allowed
- Invalid or unavailable workspace
- Workspace on external volume
- Non-ASCII path
- Permission-denied folder
- Re-entering onboarding
- Back navigation
- Closing during onboarding
- App restart between steps
- Slow account check
- Failed account check
- Failed completion mutation
- Keyboard-only completion

Verify that onboarding explains the real consequences of strict, balanced, and autopilot modes.

## 8.3 Authentication and account state

Establish an explicit account-state model.

Test:

- Never signed in
- Sign-in started
- Browser opened
- User completes sign-in
- User abandons sign-in
- Duplicate sign-in click
- Sign-in timeout
- Token exists but is invalid
- Token expires during a task
- Reauthentication
- Provider unreachable
- Local CLI probe fails
- Signed in but model discovery fails
- Sign-out with no active task
- Sign-out with active tasks
- Sign-out partially fails
- App restart after sign-out
- Shared Grok CLI session effects
- Account identity refresh
- Usage refresh
- Billing link
- Privacy link

Do not conflate:

- Signed out
- Reauthentication required
- Provider offline
- Runtime missing
- Model discovery failed
- Gateway unavailable
- Entitlement inactive

Verify that secrets remain in the main process or secure provider boundary and never reach the renderer unnecessarily.

## 8.4 Home, shell, navigation, and global status

Review:

- Sidebar expanded and collapsed
- Home
- Chats or tasks
- Scheduled work
- Artifacts
- Memory
- Settings
- Search
- Command palette
- Shortcuts dialog
- Inbox
- Usage meter
- Account status
- Gateway status
- Runtime status
- Update status
- Remote-control banner
- Security-update banner
- Tray state
- System notifications

Test rapid navigation, stale selection, deleted tasks, active tasks, multiple windows if supported, small window sizes, zoom, and long translations.

The global shell must present a coherent hierarchy for:

- Working
- Needs user
- Paused
- Reauthentication required
- Degraded
- Failed
- Updating
- Remote control active

## 8.5 Task creation and composer

Inventory and test:

- New task
- Goal text
- Workspace selection
- Folder trust
- Model selection
- Effort levels: fast, normal, heavy, max
- Plan-first
- Strict, balanced, autopilot
- Role packs
- Attachments
- File mentions
- Slash commands
- Dictation
- Image or media generation
- Scheduled task creation
- Optimistic task creation
- Duplicate submission prevention
- Keyboard submission
- Multiline input
- Large input
- Unicode
- Pasted paths
- Missing files
- Changed files
- Unsupported attachments
- Cancelled file picker
- Task creation while gateway is recovering

Verify that the accepted task contains exactly the authority, workspace, attachments, model, effort, locale, skills, and MCP servers shown in the UI.

## 8.6 Conversations and follow-ups

Test:

- First turn
- Follow-up during active work
- Queued follow-up
- Multiple queued follow-ups
- Editing a queued message
- Removing a queued message
- Retrying a failed queued message
- Sending immediately
- Navigation away and back
- App restart with queued intent
- Two conversations running
- Renaming
- Pinning
- Deleting
- Exporting
- Copying the last response
- Revising or rewinding a turn
- Continuing after failure
- Continuing after cancellation
- Continuing after a question
- Continuing after approval
- Very long conversation
- Context compaction
- Missing events
- Duplicate events
- Out-of-order events

Ensure conversation, task, run, turn, and worker are not conflated.

## 8.7 Agent execution lifecycle

Review the complete task state machine:

- `queued`
- `running`
- `waiting_approval`
- `waiting_user`
- `blocked`
- `done`
- `failed`
- `cancelled`

Review modes:

- `interactive`
- `scheduled`
- `proactive`

Review task events:

- Message
- Step
- Tool request
- Tool result
- Approval required
- Approval resolved
- Artifact created
- Status change
- Error
- Plan update
- Citations
- Worker started
- Worker activity
- Worker message
- Worker completed
- Worker failed

Test:

- Ordinary completion
- Engine spawn failure
- Provider preflight failure
- Malformed event
- Duplicate event
- Missing terminal event
- Process exits zero without completion
- Process exits non-zero
- Process killed
- App exits
- Gateway exits
- Renderer reloads
- Machine sleeps
- Machine wakes
- Network disappears
- Token expires
- Runtime changes during a run
- Engine rebuild during active tasks
- Concurrent runs
- Maximum concurrency
- Queued cancellation
- Running cancellation
- Cancellation race with completion
- Crash recovery
- Lease expiry
- Watchdog recovery
- Stale run attempt
- Orphan child process

A task must never be marked successful solely because a subprocess exited cleanly.

## 8.8 Plans, questions, and approvals

Review:

- Plan-first mode
- Plan presentation
- Plan approval
- Plan rejection
- Revised plan
- User question
- Multiple-choice question
- Free-form reply
- Tool approval
- Approval denial
- Remembered approval
- Expired approval
- Approval after restart
- Duplicate approval response
- Approval for the wrong task
- Remote approval
- Approval after task cancellation

Every approval must be bound to:

- Exact task
- Exact run attempt
- Exact operation
- Exact target
- Exact parameters or safe digest
- Exact authority requested
- Expiration or lifecycle
- User or device that approved it

Test that stale approvals cannot authorize later operations.

## 8.9 Permission modes and effective protection

Test strict, balanced, and autopilot against:

- File reads inside workspace
- File reads outside workspace
- Writes inside workspace
- Writes outside workspace
- Deletes
- Shell
- Network
- Browser open
- Browser click
- Browser typing
- Browser form submission
- Desktop screenshot
- Desktop click
- Desktop typing
- MCP operations
- Scheduled work
- Remote work

Verify effective protection rather than UI labels.

Strict mode must fail closed.

If an underlying provider cannot enforce the selected policy, Grok Desk must block, downgrade visibly, or require explicit user confirmation. It must not silently pretend protection exists.

## 8.10 Workspace and file safety

Test:

- Trusted folder
- Untrusted folder
- Revoked trust
- Nested workspace
- Symlink
- Junction
- Relative path traversal
- `..`
- Case-insensitive path collision
- Unicode normalization
- External drive
- Network share
- Read-only directory
- File deleted after attachment
- File replaced after attachment
- Symlink changed after approval
- Large file
- Binary file
- Hidden file
- Git metadata
- Secret files
- Multiple workspace roots
- Temporary managed workspace

Verify:

- Canonicalization
- Path confinement
- Time-of-check/time-of-use behavior
- Attachment digest behavior
- Safe previews
- Safe artifact paths
- No unintended traversal through symlinks
- No workspace-root confusion between turns

## 8.11 Artifacts and deliverables

Review:

- Declared artifacts
- Harvested files
- Reports
- Media
- Cards
- Deliverables digest
- File previews
- Reveal in Finder/Explorer
- Download
- Open
- Missing file
- Moved file
- Deleted file
- Unsafe external path
- Unknown MIME type
- Huge media
- Malicious HTML
- SVG
- Mermaid
- Markdown
- Code block rendering
- Image lightbox
- Video poster
- Citation cards

The application must not claim an artifact exists unless it can resolve and verify it safely.

Local HTML and active content must not gain unintended application privileges.

## 8.12 In-app browser

Review:

- Browser capability discovery
- Browser MCP startup
- Loopback host
- Origin policy
- URL validation
- In-app pane
- Browser status
- Open
- Navigate
- Back
- Forward
- Refresh
- Click
- Type
- Scroll
- Read
- Screenshot
- Download
- Form submission
- Multiple tabs if supported
- Closing and reopening
- Sticky “keep closed” behavior
- Browser activity receipts
- Fallback behavior

Test:

- Public HTTPS
- HTTP
- Localhost
- IPv4 loopback
- IPv6 loopback
- `file:`
- `data:`
- `javascript:`
- Custom schemes
- Redirects
- Authentication pages
- Downloads
- Popups
- New-window requests
- Certificate failure
- Offline
- Timeout
- Malicious prompt injection
- Cross-origin navigation
- Origin approval persistence
- Browser close during active tool call
- App restart
- Packaged MCP spawn

Do not silently fall back to Chrome, a headless browser, or another provider when the product claims to use the in-app browser.

OAuth may intentionally use the system browser. Distinguish account authentication from agent browsing.

## 8.13 Desktop control

Review:

- Desktop-control toggle
- OS permission detection
- Screen capture
- Screenshot resizing
- Coordinate conversion
- Display scaling
- Multiple monitors
- macOS adapter
- Windows adapter
- Unsupported platform behavior
- Click
- Double click
- Move
- Scroll
- Type
- Key combinations
- Permission prompts
- Desktop-control HUD
- Emergency stop
- Task-end cleanup

Test:

- Retina/high-DPI
- Windows display scaling
- Negative monitor coordinates
- Multiple displays
- Window movement
- Target changes between screenshot and click
- Sensitive application
- Password field
- System dialog
- Lock screen
- Sleep and wake
- Task cancellation
- App crash
- Remote-control interaction
- Malformed coordinates
- Off-screen coordinates
- Rapid repeated commands

Desktop control must be conspicuous, revocable, scoped to a task, and fail closed.

## 8.14 MCP connectors and bundled skills

Inventory every:

- Curated connector preset
- User-defined MCP server
- Command
- Argument
- Environment placeholder
- Runtime requirement
- Health check
- Capability
- Bundled skill
- User skill path
- Effective skill path
- Workspace-installed configuration

Test:

- Add
- Edit
- Enable
- Disable
- Remove
- Missing executable
- Broken package
- Slow startup
- Crash
- Invalid protocol
- Huge output
- Malformed output
- Secret placeholder
- Secret redaction
- Duplicate connector ID
- Conflicting MCP names
- Malicious MCP server
- Packaged skill discovery
- Missing packaged skills
- User override
- Workspace config generation
- Engine rebuild
- Running task during configuration change

MCP servers are privileged plugins. Treat their output as untrusted and their authority as explicit.

## 8.15 Memory and personalization

Review memory kinds:

- Profile
- Project
- Brand
- Preference
- Episodic
- Now
- Standing

Test:

- Create
- Edit
- Delete
- Search
- Project scoping
- Provenance
- Takeaways from a task
- Duplicate memory
- Contradictory memory
- Stale memory
- Sensitive memory
- Memory injection into prompts
- User request to forget
- App restart
- Large memory collection
- Embedding failure
- Retrieval quality

The user must be able to understand what Grok remembers and why it affected a task.

Do not store secrets or transient sensitive content as durable memory without an explicit design.

## 8.16 Scheduling, proactivity, inbox, and notifications

Review:

- Schedule creation
- Cron parsing
- Time zones
- Quiet hours
- Enable
- Disable
- Edit
- Delete
- Schedule occurrence deduplication
- Missed occurrence
- DST transition
- App closed
- App asleep
- Multiple occurrences
- Scheduled approval mode
- Workspace availability
- Proactivity suggestions
- Suggestion deduplication
- Inbox items
- Read/dismiss
- Tray state
- System notification
- Notification click navigation

Unattended work must never gain broader authority than the user configured.

## 8.17 Dictation and media

Test dictation for:

- Microphone permission
- Permission denied
- No microphone
- Start
- Stop
- Cancel
- Silence
- Long recording
- App backgrounding
- Concurrent dictation
- Network failure
- Entitlement failure
- Provider failure
- Unsupported format
- Transcript insertion
- Locale
- Secret redaction

Review image/media flows for:

- Attachment
- Preview
- Generation request
- Progress
- Failure
- Artifact harvesting
- Unsupported result
- Missing file
- Large output
- Honest completion state

## 8.18 Mobile remote and relay

Review:

- Pair QR
- Pair secret
- Pair challenge
- Device identity
- Pair offer
- Pair accept
- Session establishment
- Session expiry
- Remote task creation
- Task listing
- Status polling
- Approval
- Cancellation
- Offline queue
- Reconnect
- Keep-awake
- Biometrics
- Haptics
- Local notifications
- Relay storage
- Relay expiration
- Multi-device behavior
- Device revocation

Test:

- Valid pair
- Invalid QR
- Expired challenge
- Replayed challenge
- Wrong machine
- Wrong device
- Relay disconnect
- Desktop disconnect
- Mobile disconnect
- Duplicate remote mutation
- Out-of-order frames
- Tampered ciphertext
- Replayed ciphertext
- Corrupt frame
- Huge frame
- Session-key rotation
- Lost phone
- Revoked phone
- Two phones
- Two desktops
- Same operation from two devices
- Offline task submission
- Queue drain after reconnect
- Timeout after server acceptance
- Mobile app restart
- Desktop app restart

The relay must be unable to read encrypted task content.

Do not log decoded remote frames or pairing secrets.

## 8.19 Licensing and entitlements

Review:

- Product-key input
- Product-key parsing
- Activation challenge
- Device identity
- Device proof
- Signed lease
- Lease refresh
- Offline grace
- Expiry
- Read-only mode
- Activation limit
- Device transfer
- Deactivation
- Refund or revocation
- Credential storage
- Legacy migration
- Portal link
- Purchase link
- Entitlement API errors
- Startup behavior
- Task admission

Test:

- Valid key
- Invalid key
- Wrong product
- Modified key
- Wrong signature
- Valid activation
- Duplicate activation
- Too many devices
- Network unavailable
- API timeout
- API malformed response
- Lease near expiry
- Expired lease
- Clock skew
- System clock rollback
- Revoked entitlement
- Credential-vault failure
- Migration interruption
- Restart after migration
- Read-only access to existing work
- Export while read-only
- New-task denial
- Active task during expiry
- Development bypass in unpackaged app
- Development bypass in packaged app

Local conversations and artifacts must remain viewable and exportable when licensing is unavailable unless an explicit, accurately advertised policy says otherwise.

## 8.20 Managed Grok runtime

Review:

- Runtime discovery
- Global Grok inheritance
- Managed runtime selection
- Compatibility
- Download
- Resume
- Hash verification
- Platform signature verification
- Extraction
- Staging
- Activation
- Probe
- Repair
- Rollback
- Removal
- Engine rebuild

Test:

- No runtime
- Compatible runtime
- Incompatible runtime
- Corrupt runtime
- Partial download
- Interrupted extraction
- Wrong architecture
- Wrong platform
- Invalid signature
- Wrong Team ID
- Antivirus quarantine
- File lock
- Low disk space
- Permission denied
- Proxy
- Offline
- Runtime update during active task
- App restart during update
- Repair preserving user data

## 8.21 Application updates and release manifests

Review every update phase:

- Idle
- Checking
- Available
- Downloading
- Verifying
- Staged
- Waiting for idle
- Installing
- Restarting
- Post-update verification
- Committed
- Error
- Repair

Review security modes:

- Normal
- Security warning
- Security block
- Revocation switch
- Revocation repair

Test:

- No update
- Ordinary update
- Beta channel
- Forced security update
- Manifest replay
- Manifest sequence rollback
- Expired manifest
- Unknown key
- Invalid signature
- Modified artifact
- Wrong architecture
- Wrong Desk/Grok pair
- Redirect
- Insecure URL
- Oversized manifest
- Interrupted download
- Active tasks
- Restart refusal
- Failed installation
- Failed health check
- Rollback
- Revoked artifact
- Offline cache
- Stale cache
- Clock skew

Update verification must fail closed.

## 8.22 Local persistence and migrations

Review SQLite tables for:

- Tasks
- Task events
- Artifacts
- Schedules
- Memories
- Inbox items
- Audit entries
- Settings
- Projects
- Remote devices
- Pair challenges
- Mutation receipts
- Run attempts
- Schedule occurrences
- Operation receipts
- Conversations
- Turns
- Usage

Test:

- New database
- Every supported migration path
- Interrupted migration
- Duplicate migration
- Corrupt row
- Unknown enum
- Partial write
- Disk full
- Database locked
- Concurrent write
- Crash during task creation
- Crash during event persistence
- Crash during completion
- Crash during approval
- Crash during artifact creation
- Backup and restore
- Large history
- Cleanup or retention

Critical mutations must be atomic and recoverable.

## 8.23 Settings and preferences

Review settings tabs for:

- Account
- Preferences
- Permissions
- Tools
- Remote
- Language
- License
- Runtime and updates

Test:

- Save
- Cancel
- Invalid value
- Unknown key
- Concurrent change
- App restart
- Runtime-effective value
- Renderer stale state
- Sensitive values
- Reset
- Import/export if supported

The displayed setting must match effective gateway/runtime behavior.

## 8.24 Cross-platform packaging

Verify:

- macOS Apple Silicon
- macOS Intel
- Windows x64
- Windows ARM64 holdback
- DMG
- macOS updater ZIP
- NSIS
- App icons
- Installer metadata
- Microphone usage description
- Screen-capture usage description
- Apple Events description
- Hardened runtime
- Entitlements
- Native module ABI
- Bundled MCP servers
- Bundled skills
- Managed runtime paths
- Keychain
- Credential Manager
- Uninstall behavior

Do not claim a platform is supported without a qualified artifact and real-device evidence.

---

# 9. Marketing Claims Versus Product Reality

Find every claim in public and in-product surfaces.

For each claim:

1. Add it to `CLAIMS_MATRIX.md`.
2. Identify the implementation.
3. Identify required SuperGrok access.
4. Identify required Grok Desk entitlement.
5. Identify platform limitations.
6. Identify permission requirements.
7. Test it end to end.
8. Test failure behavior.
9. Assess professional usefulness.
10. Determine whether wording overstates the capability.
11. Fix the product or correct the wording.
12. Add regression coverage.

Look especially for contradictions involving:

- “Desktop coworker”
- “Works while you focus elsewhere”
- “Controls your computer”
- “Uses its own browser”
- “Safe approvals”
- “Local-first”
- “Private”
- “Remembers your work”
- “Schedules tasks”
- “Works from your phone”
- “No terminal required”
- “No Grok installation required”
- “Lifetime updates”
- “Three devices”
- “Mac and Windows”
- “One-time payment”
- “Separate SuperGrok subscription required”
- “Autopilot”
- “Packaged skills”
- “Built-in connectors”
- “Multilingual”

A user must not purchase or install Grok Desk based on functionality that is unavailable, unsafe, provider-dependent, unqualified, or undisclosed.

---

# 10. Page-by-Page UI and UX Review

Review every desktop and mobile surface.

For each screen inspect:

## Purpose and hierarchy

- Is the screen’s purpose immediately clear?
- Is the primary action obvious?
- Is current state truthful?
- Does the user know what to do next?
- Are high-frequency actions accessible?
- Are dangerous actions separated?
- Are errors recoverable?
- Is technical detail progressively disclosed?
- Is there a clear distinction between conversation and work activity?

## Visual quality

Review:

- Typography
- Spacing
- Alignment
- Hierarchy
- Color
- Contrast
- Borders
- Radius
- Elevation
- Icons
- Density
- Lists
- Cards
- Forms
- Empty states
- Loading states
- Errors
- Success states
- Hover
- Focus
- Selected
- Disabled
- Skeletons
- Text wrapping
- Overflow
- Native title-bar regions
- Window drag regions
- Platform consistency

Follow the existing Grok Desk design direction unless evidence supports changing it:

- Premium dark desktop interface
- No pure black or white
- Tonal elevation
- Warm sand accent
- Semantic status colors
- Compact desktop density
- Keyboard-first interaction
- Visible focus
- Reduced-motion support

## Agent-specific clarity

Ask:

- Can the user tell what Grok is currently doing?
- Can the user tell which worker is doing it?
- Can the user distinguish intent from completed action?
- Can the user inspect tool receipts?
- Can the user identify which files changed?
- Can the user tell whether an action was approved?
- Can the user tell whether the browser or desktop is being controlled?
- Can the user stop work immediately?
- Can the user recover from failure?
- Does “done” mean the requested outcome was achieved?

## Window behavior

Test:

- Minimum supported size
- Narrow window
- Large desktop
- Full screen
- Split browser layout
- Long task title
- Long path
- Long translation
- Browser zoom
- OS text scaling
- Multiple displays
- Sleep and wake
- Minimize and restore
- Tray restore

---

# 11. Interaction and State Testing

Test every:

- Button
- Link
- Card
- Tab
- Input
- Textarea
- Select
- Toggle
- Checkbox
- Menu
- Dialog
- Sheet
- Tooltip
- Popover
- Search
- Filter
- Sort
- File picker
- Attachment control
- Microphone control
- Retry
- Stop
- Cancel
- Approve
- Deny
- Remember
- Export
- Reveal
- Download
- Update
- Repair
- Pair
- Revoke
- Destructive action
- Keyboard shortcut
- Tray action
- Notification action

For important actions test:

- Single click
- Double click
- Repeated click
- Keyboard activation
- Slow response
- Failure
- Timeout
- Renderer refresh
- App restart
- Back navigation
- Rapid navigation
- Duplicate request
- Two open views
- Concurrent task
- Expired session
- Revoked entitlement
- Gateway restart
- Engine restart
- Partial server failure

---

# 12. AI and Agent Quality Audit

Evaluate actual task quality, not only plumbing.

Create realistic task suites for:

- Repository explanation
- Focused bug diagnosis
- Small code change
- Multi-file refactor
- Test creation
- Documentation
- Research
- Marketing
- Planning
- File organization
- Data analysis
- Browser research
- Artifact creation
- Image creation
- Scheduled work
- Desktop-control task
- Ambiguous request
- Impossible request
- Unsafe request
- Request requiring clarification
- Request requiring approval

Evaluate:

- Instruction following
- Workspace grounding
- Use of attachments
- Memory use
- Correct model and effort
- Plan quality
- Question quality
- Tool choice
- Browser choice
- Desktop-control choice
- File safety
- Hallucination
- Citation accuracy
- Completion honesty
- Artifact correctness
- Recovery
- Latency
- Token/usage reporting
- Cost awareness
- Conversation continuity
- Worker coordination
- Localization
- Prompt-injection resistance

Test adversarial inputs in:

- Repository files
- Web pages
- MCP output
- Tool output
- Attached documents
- Memory
- Prior conversation
- Remote instructions

An untrusted file or webpage must not be able to override the user’s authority boundaries.

---

# 13. Electron and IPC Security

Review Electron security against current official guidance.

Inspect:

- `contextIsolation`
- `sandbox`
- `nodeIntegration`
- Preload exposure
- IPC schema validation
- Sender validation
- Navigation restrictions
- Window-open handling
- External URL handling
- CSP
- Custom asset protocol
- Local HTML
- Web contents permissions
- Session partitions
- Browser sessions
- DevTools in production
- Remote module usage
- Main-process exception handling
- Privileged IPC registration
- Renderer-controlled paths
- Renderer-controlled commands
- Loopback services
- Authentication of local requests

Attempt safe tests involving:

- Untrusted renderer origin
- Malformed IPC payload
- Unknown IPC method
- Oversized payload
- Prototype-pollution-like keys
- External navigation
- `javascript:` URL
- `file:` URL
- Crafted asset URL
- Crafted reveal path
- Crafted download path
- Stale window sender
- Destroyed web contents
- Browser-pane sender reaching app IPC

Treat renderer compromise as a realistic threat.

---

# 14. Secrets, Privacy, and Data Handling

Inventory:

- SuperGrok credentials
- Auth files
- Usage data
- Product keys
- Activation signatures
- Device private keys
- Signed leases
- Release public keys
- Pair secrets
- Remote session keys
- MCP environment variables
- Connector secrets
- Workspace content
- Conversation content
- Memory
- Screenshots
- Microphone audio
- Logs
- Crash reports
- Analytics

For every sensitive datum determine:

- Where it originates
- Where it is stored
- Whether it is encrypted
- Which process receives it
- Whether it reaches the renderer
- Whether it reaches logs
- Whether it reaches prompts
- Whether it reaches the relay
- Whether it is retained
- How it is deleted
- How it is migrated
- How failure is handled

Verify redaction against:

- Query strings
- Headers
- JSON
- Nested objects
- Arrays
- Environment variables
- Command arguments
- Tool receipts
- Exception strings
- URLs
- Logs from child processes

---

# 15. Concurrency and Idempotency

Test:

- Two tasks starting simultaneously
- Two follow-ups submitted simultaneously
- Duplicate task creation
- Duplicate remote mutation
- Two approvals
- Approval and cancellation race
- Completion and cancellation race
- Engine rebuild during a run
- Account sign-out during a run
- Entitlement expiry during a run
- Update staging during a run
- Two schedule occurrences
- App and mobile cancelling the same task
- Two devices submitting the same mutation
- Multiple queue drains
- Database lock
- Renderer retry after gateway acceptance
- Timeout after accepted mutation

Inspect:

- Mutation receipts
- Client mutation IDs
- Unique constraints
- Transactions
- Run leases
- Task-attempt ownership
- Event sequence numbers
- Schedule occurrence keys
- Queue claims
- Retry behavior
- Stale renderer state

The application must fail safely rather than silently duplicate work or corrupt state.

---

# 16. Crash, Restart, Sleep, and Offline Reliability

Test:

- Renderer crash
- Main-process crash
- Gateway crash
- Grok process crash
- MCP crash
- Browser MCP crash
- Desktop MCP crash
- Mobile crash
- Relay restart
- Machine sleep
- Machine wake
- Network loss
- Network recovery
- Proxy interruption
- App forced quit
- OS restart
- Disk full
- Database locked
- Child process refuses to terminate

Determine:

- Which tasks resume
- Which tasks fail
- Which tasks become blocked
- Whether approvals persist safely
- Whether queued messages survive
- Whether artifacts remain consistent
- Whether child processes are orphaned
- Whether desktop control stops
- Whether browser state is truthful
- Whether remote sessions expire
- Whether notifications remain accurate

---

# 17. Accessibility

Evaluate relevant surfaces against WCAG 2.2 AA principles and desktop accessibility expectations.

Test:

- Keyboard navigation
- Focus order
- Focus visibility
- Dialog focus trapping
- Escape behavior
- Command palette
- Menus
- Tooltips
- Screen-reader labels
- Semantic headings
- Landmarks
- Form labels
- Error association
- Dynamic announcements
- Task-status announcements
- Approval announcements
- Progress announcements
- Color contrast
- Status not relying only on color
- Reduced motion
- Zoom
- Reflow
- OS text scaling
- Touch targets on mobile
- Image alt text
- Markdown
- Mermaid diagrams
- Browser split
- Desktop-control HUD

Automated scans are insufficient.

Manually complete critical workflows using only the keyboard.

---

# 18. Copy and Localization

Inspect every visible string.

Review:

- Grammar
- Spelling
- Capitalization
- Terminology
- Tone
- Action clarity
- Failure recovery
- Loading language
- Empty states
- Confirmation dialogs
- Permission explanations
- Destructive warnings
- Account language
- Entitlement language
- Update language
- Runtime language
- Browser language
- Desktop-control language
- Remote-control language
- AI limitations

Review all supported locales:

- English
- Spanish
- French
- Portuguese
- German
- Japanese
- Chinese

Test:

- Key parity
- English fallback
- Native quality
- Long translations
- Plurals
- Date and time
- Relative time
- Time zones
- File paths
- Model names
- Product names
- Non-Latin input
- CJK line wrapping
- Locale persistence
- Main-process strings
- Tray strings
- Installer strings
- Notifications
- Mobile strings

Do not describe structural key coverage as professional native translation quality.

---

# 19. Performance

Measure rather than guess.

Review:

- Cold launch
- Warm launch
- First render
- Onboarding
- Account probing
- Task-list load
- Large conversation rendering
- Event streaming
- Markdown rendering
- Syntax highlighting
- Mermaid rendering
- Artifact list
- Memory search
- Schedule list
- Settings
- Browser split
- Desktop screenshots
- Database queries
- Runtime startup
- MCP startup
- Update checks
- Mobile reconnect

Measure:

- Time to usable shell
- Time to first task submission
- Time to first streamed response
- Event-to-render latency
- IPC latency
- Gateway latency
- SQLite latency
- Memory use
- CPU
- Renderer re-renders
- Process count
- Child-process leaks
- Large-list behavior
- Bundle size
- Download size
- Screenshot size
- Remote frame size
- Battery impact
- Polling frequency

Test realistic scale:

- Empty profile
- Hundreds of tasks
- Long conversation
- Thousands of task events
- Hundreds of artifacts
- Hundreds of memories
- Many schedules
- Several concurrent runs
- Large workspace
- Large attachments
- Long operational history

Record before-and-after measurements for meaningful performance changes.

---

# 20. Supply Chain and Dependency Security

Review:

- Electron version
- Electron updater
- Native modules
- `better-sqlite3`
- `keytar`
- React and renderer dependencies
- Markdown and syntax-highlighting libraries
- Mermaid
- QR generation
- MCP packages
- Bundled `.mjs` servers
- Package installation commands
- Lockfile integrity
- Dependency audit
- SBOM generation
- Build scripts
- Native ABI rebuild scripts
- GitHub Actions pinning
- Release secrets
- Signing material
- External downloads

Test that:

- Runtime downloads are verified
- Update downloads are verified
- Redirect policies are safe
- Package scripts cannot silently replace release artifacts
- Bundled MCP servers match reviewed source
- Packaged resources are complete
- Native modules use the intended ABI
- Release artifacts are reproducible enough to investigate
- SBOM output corresponds to the candidate

---

# 21. CI, Release, and Production Qualification

Inspect all workflows.

Verify coverage for:

- Frozen dependency installation
- Package builds
- Type checking
- Unit tests
- Integration tests
- Contract tests
- Crypto vectors
- Database migrations
- Desktop build
- Electron E2E
- Packaging smoke
- macOS and Windows runners
- Release-target assertions
- Code signing
- Notarization
- Authenticode timestamps
- Artifact hashes
- Malware scanning
- Cross-repository contract drift
- Manifest approval
- Release qualification
- Rollback
- Artifact revocation

Check for:

- Deprecated actions
- Unpinned release actions
- Unsupported runtimes
- Missing caches
- Missing timeouts
- Secret-dependent tests
- Silently skipped jobs
- Path filters that omit relevant changes
- Local/CI command mismatch
- Unqualified release targets
- Missing real-device evidence
- Unsafe workflow permissions
- Untrusted PR secret exposure
- Missing concurrency controls
- Artifact retention problems

Never weaken CI to hide a legitimate failure.

---

# 22. External Research and Competitive Comparison

Research current best practices in:

- Desktop AI coworkers
- Coding agents
- Agent approval UX
- Agent activity timelines
- Browser-use agents
- Computer-use agents
- Local-first AI tools
- MCP management
- AI memory
- Scheduled agents
- Remote agent control
- Electron security
- Desktop licensing
- Secure auto-updates
- macOS notarization
- Windows application signing
- AI-agent accessibility
- Conversation export and auditability

For every major feature:

1. Define the user problem.
2. Identify current best practices.
3. Compare Grok Desk.
4. Determine whether Grok Desk is behind, equivalent, or differentiated.
5. Record evidence.
6. Improve it where a clearly better approach exists.
7. Avoid complexity without proven user value.

Do not copy competitors blindly.

---

# 23. Subagent Strategy

Use subagents for bounded, independent investigations when available.

Good assignments include:

- Electron security and IPC
- Task/run state machine
- Conversation and queue behavior
- Browser MCP and in-app browser
- Desktop control
- Workspace and file safety
- Authentication and shared Grok session behavior
- Licensing and entitlement enforcement
- Managed runtime
- App updates and release manifests
- Remote crypto and relay
- Mobile offline behavior
- SQLite migrations and crash recovery
- Accessibility
- Localization
- Performance
- Packaging
- CI and release pipeline
- Public claims

Every subagent must receive:

- Grok Desk product context
- Exact scope
- Relevant files
- Relevant workflows
- Authority boundaries
- Operational risks
- Evidence requirements
- Test requirements
- Expected deliverables
- Instructions not to expose secrets
- Instructions not to modify unrelated files
- Instructions to update appropriate audit files

Do not assign vague tasks such as:

> “Review the entire app.”

The primary agent remains responsible for validating findings, preventing duplicate work, resolving conflicts, running integration tests, and ensuring coherent product decisions.

Do not automatically trust subagent output.

---

# 24. Testing Requirements

Use and expand the existing Vitest and Playwright stacks.

Add appropriate:

- Unit tests
- Component tests
- IPC contract tests
- Gateway tests
- Database tests
- Migration tests
- Engine tests
- Provider conformance tests
- MCP tests
- Integration tests
- Electron E2E tests
- Packaged-app tests
- Accessibility tests
- Crypto-vector tests
- Remote protocol tests
- Concurrency tests
- Crash-recovery tests
- Update tests
- Licensing tests
- Cross-platform tests
- Visual-regression tests where stable

Prioritize coverage for:

1. Privileged IPC
2. Workspace confinement
3. Strict-mode enforcement
4. Tool approvals
5. Task status transitions
6. Run-attempt recovery
7. Stop and cancellation
8. Conversation persistence
9. Duplicate mutations
10. Browser origin policy
11. Desktop control
12. Remote pairing and replay resistance
13. Credential storage
14. Entitlement admission
15. Update signature verification
16. Runtime verification
17. Database migrations
18. Scheduled unattended work
19. Artifact safety
20. Sign-in and sign-out

Tests must validate behavior rather than implementation details.

Do not:

- Disable failing tests
- Add arbitrary sleeps
- Hide flaky behavior
- Mock away the critical boundary being tested
- Depend on production providers when a fixture or contract server is appropriate
- Treat development-only bypass behavior as production verification

---

# 25. Minimum Adversarial Scenarios

At minimum, test:

- Fresh install
- Fresh profile
- Existing profile
- No SuperGrok session
- Expired SuperGrok session
- Slow account probe
- No global Grok runtime
- Broken global runtime
- Managed runtime missing
- Managed runtime corrupted
- Invalid license
- Expired lease
- Offline grace
- Credential-vault failure
- Packaged build with development-unlock environment set
- Empty workspace
- Dirty Git workspace
- Read-only workspace
- Workspace with symlinks
- Non-ASCII workspace path
- Secret file in workspace
- Large repository
- Task submitted twice
- Follow-up submitted twice
- App restarted during task creation
- App restarted during active run
- Engine process killed
- Gateway process killed
- Cancellation during completion
- Approval after cancellation
- Stale approval
- Two concurrent tasks
- Multiple worker events
- Malformed worker event
- Missing terminal event
- Queued message during active work
- Queue survives navigation
- Queue survives restart
- Browser unavailable
- Browser MCP crash
- External-browser fallback attempt
- Malicious webpage prompt injection
- Browser form submission
- Browser origin redirect
- Desktop-control permission denied
- Desktop target moves before click
- Desktop task cancelled
- Remote pair replay
- Remote frame replay
- Relay disconnect
- Duplicate remote mutation
- Lost mobile device
- Two paired devices
- Schedule during sleep
- Duplicate schedule occurrence
- DST change
- Corrupt update manifest
- Replayed manifest
- Wrong-architecture artifact
- Interrupted update
- Failed post-update health check
- Rollback
- Database locked
- Disk full
- Corrupt migration row
- English locale
- Spanish locale
- CJK locale
- Missing translation
- Long translation
- Keyboard-only workflow
- Reduced motion
- Screen-reader-relevant workflow
- Small window
- Large conversation
- Slow network
- Offline interruption
- Sleep and wake

Add further scenarios as they are discovered.

---

# 26. Prioritization

Use this order:

1. Unauthorized code execution or desktop control
2. Workspace escape and destructive file behavior
3. Secret and credential exposure
4. Update and runtime supply-chain integrity
5. Remote-control authentication and cryptography
6. Strict-mode and approval enforcement
7. Data loss and corrupted task state
8. False success and misleading completion
9. Crash recovery and idempotency
10. Authentication and entitlement correctness
11. Broken advertised workflows
12. Browser and desktop-control reliability
13. Conversation continuity and queued intent
14. Scheduled and unattended work
15. Installation and first-run success
16. Mobile remote experience
17. Agent quality and grounding
18. Performance
19. Accessibility
20. Localization
21. Visual consistency
22. Internal maintainability
23. Optional polish

Do not spend excessive time polishing a low-impact visual detail while a privilege, data-loss, update, or task-integrity issue remains.

---

# 27. Git and Commit Policy

Commit completed work in atomic, understandable commits.

Examples:

- `fix(policy): fail closed when strict mode cannot be enforced`
- `fix(tasks): preserve queued follow-ups across restart`
- `fix(browser): block silent fallback outside the in-app browser`
- `fix(remote): reject replayed control frames`
- `fix(updates): prevent manifest sequence rollback`
- `fix(runtime): verify staged binary before activation`
- `fix(auth): distinguish signed-out from reauthentication`
- `test(ipc): reject privileged requests from untrusted senders`
- `test(gateway): cover cancellation and completion race`
- `perf(chat): virtualize long task timelines`
- `docs(audit): record packaged browser verification`

Before every commit:

1. Review the diff.
2. Run formatting where configured.
3. Run type checking.
4. Run relevant tests.
5. Run relevant regression tests.
6. Manually verify the affected workflow.
7. Verify packaged behavior when required.
8. Update audit files.
9. Confirm no secrets or sensitive data are included.
10. Confirm no unrelated files are included.

Do not:

- Force-push
- Rewrite published history
- Commit failing code
- Commit secrets
- Commit production credentials
- Commit sensitive screenshots
- Commit speculative migrations
- Combine unrelated changes
- Delete unrelated work
- Hide skipped tests
- Weaken safety or CI to obtain a green result

---

# 28. Definition of Done

The audit is complete only when:

- Every discovered desktop and mobile surface is inventoried.
- Every inventory item has a review status.
- Every public product promise is in `CLAIMS_MATRIX.md`.
- Major claims are mapped to implementation.
- Critical advertised features are tested or explicitly blocked.
- Onboarding and first-run behavior are reviewed.
- Authentication states are reviewed.
- Task and run state machines are documented and tested.
- Conversation and queued-message behavior are reviewed.
- Strict, balanced, and autopilot behavior are tested.
- Approval boundaries are tested.
- Workspace confinement is tested.
- Browser control is tested.
- Desktop control is tested.
- MCP and bundled skill behavior are tested.
- Memory and scheduling are reviewed.
- Remote pairing, crypto, and idempotency are tested.
- Licensing and entitlement behavior are reviewed.
- Runtime and application updates are reviewed.
- Database migrations and crash recovery are tested.
- Electron and IPC security are reviewed.
- Secret storage and redaction are reviewed.
- Supported locales are reviewed.
- Critical workflows receive manual accessibility testing.
- Performance is measured on critical surfaces.
- Cross-platform packaging is reviewed.
- CI and release workflows are reviewed.
- P0, P1, and reproducible P2 issues are fixed or explicitly blocked.
- Relevant automated coverage is added.
- The test suite, typecheck, and production build pass, or failures are documented with evidence.
- Packaged-app verification is completed where development verification is insufficient.
- Changes are committed cleanly.
- `FINAL_AUDIT_SUMMARY.md` is complete.
- Every genuine owner action appears in `REQUIRES_OWNER_ATTENTION.md`.
- No serious issue is omitted because it was difficult to investigate.

---

# 29. Final Response

At completion, provide a concise, decision-oriented summary containing:

1. What was reviewed.
2. Verification environments used.
3. Number of findings by severity.
4. Most important safety and security problems found.
5. Most important task-integrity and data-loss problems found.
6. Most important product improvements implemented.
7. Browser and desktop-control outcomes.
8. Remote and mobile outcomes.
9. Licensing, runtime, and update outcomes.
10. Tests added or expanded.
11. Performance, accessibility, and localization outcomes.
12. Commits created.
13. Work that could not be verified.
14. Exact actions required from the owner.
15. Overall production-readiness assessment.

Keep detailed evidence in the audit files.

Do not overwhelm the final response with the chronological log.

---

# 30. Start Sequence

Begin now in this order:

1. Inspect the current branch and working tree.
2. Read repository instructions and documentation.
3. Inspect recent commits.
4. Inspect the complete workspace package structure.
5. Inspect renderer, preload, Electron main process, and privileged IPC.
6. Inspect shared IPC schemas and policy definitions.
7. Inspect SQLite schema and every migration.
8. Inspect task, run-attempt, conversation, worker, approval, and recovery models.
9. Inspect provider composition, Grok runtime discovery, and ACP mediation.
10. Inspect workspace path confinement and file operations.
11. Inspect browser and desktop-control planes.
12. Inspect authentication and credential handling.
13. Inspect licensing and entitlement enforcement.
14. Inspect managed runtime and application update systems.
15. Inspect mobile remote, relay, offline queue, and cryptography.
16. Inspect packaging and release workflows.
17. Inspect the public website and product claims.
18. Create `docs/grok-desktop-audit/`.
19. Create all required audit files.
20. Build the initial surface, method, process, data, and trust-boundary inventory.
21. Build the initial claims matrix.
22. Document authoritative state machines.
23. Establish baseline typecheck, test, build, and packaging-smoke results.
24. Identify the highest-risk privilege and data-integrity areas.
25. Begin the audit in priority order.
26. Keep the inventory, findings, test matrix, state model, research log, and audit log continuously updated.

Do not start with arbitrary visual changes.

First understand the authority model, local data, runtime, task lifecycle, approval boundaries, remote-control path, update chain, product promises, and recovery behavior.

The guiding question throughout the audit is:

> Can a real user safely trust Grok Desk with consequential work on their computer, understand exactly what it did, and recover when any component fails?
