# Grok Desk — product-truth map (film claim gate)

Compiled 2026-07-11 from a three-agent code sweep (desktop app, engine/gateway, license/spec/git-history).
Rule: a film may only show/claim what is **SOLID** here. PARTIAL needs softening; SPEC-ONLY is banned.

## SOLID — safe to claim on camera

### The core loop (already told in "Escape the Terminal")
- One goal in → agent plans and works → files land in the workspace (auto-harvested deliverables + artifact events). Formats: md, txt, pdf, docx, png/jpg/gif/webp/svg, mp4/webm/mov.
- Parallel tasks: configurable 1–N concurrent (default 3), queueing, global pause/resume.
- Scheduling: full cron with timezone + quiet hours; headless scheduled runs get a private workspace; week heatmap UI.
- Models grok-4.5 default; effort fast/normal/heavy.

### Untold — memory & personalization
- Memory system: profile / project / brand kit / preference / episodic / NOW / standing-instruction items, SQLite-backed, **local embeddings** (no remote API) for retrieval; bounded token-budget injection per task.
- "Remember takeaways" from any chat → episodic memory.
- Role packs (one click): Marketing Agent, Researcher, Ops/Files, Chief of Staff — preset skills + standing instructions + default effort.
- Automation suggestions: reads your memory and proposes recurring automations with a draft cron ("Weekly priority review", "Weekly marketing pulse").
- Proactivity loop: hourly background tick → inbox items for approvals/unfinished/failed + suggestions; respects quiet hours; smart dedup; 30-day pruning.
- Grok auto-titles every chat (one-shot, 3–6 words).

### Untold — watch it work
- Agent browser cockpit: per-task **isolated** browser pane (own session partition, sandboxed); globe indicator; auto-opens on first browser tool; user can watch, collapse, pin.
- Browser tools: open, click, type, scroll, screenshot, read — all policy-gated with per-origin first-visit approval.
- Subagent HUD: live count + list of running child agents; click to focus a child's stream.
- Voice dictation: speak the goal — Grok STT (api.x.ai/v1/stt), live partial transcription, mic permission handled.
- Stream density toggle (Chat / Tools / Log); virtualized long streams; jump-to-latest.

### Untold — trust & control
- Three approval modes: **Strict** (everything asks) / **Balanced** (shell, deletes, network, form-submits ask) / **Autopilot**.
- Workspace-root boundary enforcement — file ops outside allowed roots are denied.
- Blocked-URL guard (localhost etc.), form-submit/download approvals, origin memory.
- Append-only audit log of every tool call, approval, denial.
- Pause-all kill-switch from the menu-bar/tray (macOS + Windows), tray status tooltip.
- Secrets in OS credential store; log redaction; auth delegated to Grok Build OAuth (tokens never touch the gateway).

### Untold — the desk itself
- Command palette (⌘K): navigate, launch, stop running tasks.
- Artifacts gallery: cross-task, media thumbnails, md/code preview, filter/sort, Reveal in Finder/Explorer.
- Inbox: approvals, clarifications, finished schedules, suggestions, reauth.
- 7 languages (en es fr de pt ja zh), runtime switch, auto-detect.
- Native notifications (done/failed/approval), deep links (grokdesk://), chat export to markdown.
- Connectors marketplace: **22 curated MCP connectors** (Filesystem, Web fetch, Memory graph, Sequential thinking, Git, GitHub, GitLab, Slack, Google Drive, Postgres, SQLite, Sentry, Brave Search, Puppeteer, Google Maps, AWS KB, …) + one-click "recommended" set + manual MCP server entry.
- SuperGrok usage meter (soft 70% / hard 90% warnings), billing portal link.
- License: Ed25519 signed keys, Stripe checkout → one-time claim, **7-day offline grace**, machine fingerprint.
- macOS + Windows packaging (DMG/ZIP, NSIS/portable), signing + notarization pipeline.

## PARTIAL — soften or avoid
- Image generation: Grok Build's own /imagine, surfaced only as artifacts ("imagines" claim from film 1 remains OK — it is real Grok Build capability).
- Sub-agent specialist fallback logic (HUD is real; orchestration semantics engine-side).
- Recovery banner (UI wired, classification in shared lib). Sidebar-collapse persistence. Diagnostics full export.
- Several connector presets use deprecated npm packages (still resolve).

## SPEC-ONLY — never claim
- **Computer Use / desktop GUI control** (spec locked 2026-07-11, zero implementation).
- Auto-update. Heavy multi-agent mode (engine-gated). File-watch/webhook schedule triggers.
- Hard sandbox (Docker/VM) backend. Vision inputs. Export/import backup. Auto-retry. Gateway rate limiting.
