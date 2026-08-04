# Verbatim product strings for the film (verified 2026-07-11)

| Film use | String | Source |
|---|---|---|
| Thinking heartbeat | "Connecting the dots" (pool also has "Thinking it through", "Untangling the threads", "Doing the quiet math") | components/task-stream.tsx THINKING_PHRASES |
| Tool chip verbs | "Reading" / "Writing" / "Searching" / "Browsing the web" / "Running a command" | components/task-stream.tsx humanizeTool() |
| Want-it button | "Reveal in Finder" | components/views/artifacts-view.tsx:289 + i18n home.revealFinder |
| Rail header | "Deliverables" | i18n home.deliverables |
| Composer placeholder | "Reply to refine or take this further…" | components/views/task-workspace-view.tsx:534 |
| Schedule nav/title | "Scheduled" / "New schedule" | i18n nav.scheduled, scheduled.create |
| Model chip | "grok-4.5" | components/views/scheduled-view.tsx |

# Capability verdicts
| Beat | Verdict | Evidence |
|---|---|---|
| Parallel tasks (switcher) | REAL | gateway multi-task manager + sidebar chats (memory: pass 5) |
| Scheduler | REAL | scheduled-view.tsx create form, SchedulerService |
| Reveal in Finder | REAL | artifacts-view.tsx:289 |
| Inline image artifact | REAL | ArtifactMedia renders images/videos inline (task-stream.tsx) |
| X search | REAL | `grok -p "Search X for recent posts about xAI Grok and list 3 with authors."` returned 3 cited x.com posts with authors/handles/URLs (e.g. @EGirengi50732, @MfaragAiFilm, @vallumsoftware) |
| Code execution | REAL | `grok -p "...compute 17*23 and write the result to result.txt"` wrote `result.txt` containing `391` (17×23) |
