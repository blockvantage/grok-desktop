let meta = #{
    name: "implement-phase2-surfaces",
    description: "Implement Phase 2 simplified daily Desk surfaces: Home desk, sidebar Needs review, palette daily ranking, single Artifacts search, visual QA",
    when_to_use: "After Phase 1 (truth/readiness/artifacts/layout) is complete; simplify signed-in Home, sidebar, command palette, and search before Phase 3 intent chips",
    phases: [
        #{ title: "Discover", detail: "Map Home, sidebar, palette, search, visual-QA surfaces" },
        #{ title: "Home", detail: "One composer + current-work/needs-attention; hide healthy setup" },
        #{ title: "Sidebar", detail: "Active/recent first; failed history under Needs review" },
        #{ title: "Palette", detail: "Daily actions first; demote setup/admin" },
        #{ title: "Search", detail: "One clear search behavior per view, especially Artifacts" },
        #{ title: "Verify", detail: "Build, visual-qa, Phase 1 + Phase 2 tests" },
        #{ title: "Fix", detail: "Repair failures until green or honestly blocked" },
        #{ title: "Report", detail: "Changed files, QA outcome, residual risks" },
    ],
};

let map_schema = #{
    "type": "object",
    "required": ["root", "summary", "preserve", "files", "risks", "current_pain"],
    "properties": #{
        "root": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "preserve": #{ "type": "array", "items": #{ "type": "string" } },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
        "risks": #{ "type": "array", "items": #{ "type": "string" } },
        "current_pain": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

let status_schema = #{
    "type": "object",
    "required": ["done", "summary", "changed_files", "notes"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "changed_files": #{ "type": "array", "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["build_ok", "visual_qa_ok", "phase1_tests_ok", "phase2_tests_ok", "summary", "failures"],
    "properties": #{
        "build_ok": #{ "type": "boolean" },
        "visual_qa_ok": #{ "type": "boolean" },
        "phase1_tests_ok": #{ "type": "boolean" },
        "phase2_tests_ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "failures": #{ "type": "array", "items": #{ "type": "string" } },
        "visual_qa_notes": #{ "type": "string" },
        "screenshot_paths": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

// args.root: monorepo root (grok-desktop)
// args.max_fix_rounds: number (default 2)
let root = "/Users/maceo/blockvantage/grok/grok-desktop";
if args != () && args.root != () && type_of(args.root) == "string" && args.root != "" {
    root = args.root;
}
let max_fix_rounds = 2;
if args != () && args.max_fix_rounds != () {
    if type_of(args.max_fix_rounds) == "i64" { max_fix_rounds = args.max_fix_rounds; }
    if type_of(args.max_fix_rounds) == "f64" { max_fix_rounds = args.max_fix_rounds; }
}

let plan_doc = root + "/docs/simplified-experience-qa-plan-2026-07-31.md";
let desktop = root + "/apps/desktop";

let brief = "";
brief += "You are a senior product engineer implementing Phase 2 of the Grok Desk simplified experience.\n";
brief += "MONOREPO ROOT: " + root + "\n";
brief += "DESKTOP PACKAGE: " + desktop + "\n";
brief += "PLAN DOC (read Phase 2 section): " + plan_doc + "\n";
brief += "PRODUCT DECISION: Home becomes the desk, not the dashboard. Dashboard details may still exist but must not be the first thing a healthy signed-in user parses.\n";
brief += "\n";
brief += "HARD RULES (AGENTS.md + scope):\n";
brief += "- Never use OS Keychain, Windows Credential Manager, @github/keytar, keytar, or Electron safeStorage for product keys / device identity.\n";
brief += "- Production credential path must remain createSafeStorageCredentialVault (AES-256-GCM file under Electron userData + local .key).\n";
brief += "- Unit tests may use createMemoryCredentialVault only (never bootstrap Keychain paths).\n";
brief += "- Implement in code. Do not stop at recommendations or plans.\n";
brief += "- Phase 2 only. Do NOT implement Phase 3 intent chips, memory auto-suggestions, or work-graph unless a tiny structural hook is required for Phase 2 layout.\n";
brief += "- Do not chase Grok Build parity.\n";
brief += "- Scoped edits only. Worktree may already be dirty — do not revert unrelated changes.\n";
brief += "- Do not use destructive git commands (no reset --hard, force-push, clean -fd of unrelated work).\n";
brief += "- Keep power affordances available but visually secondary.\n";
brief += "- After edits, run targeted tests from monorepo root with pnpm.\n";
brief += "\n";
brief += "ACCEPTANCE CRITERIA:\n";
brief += "- Signed-in Home is understandable as: ask Desk, continue current work, or review needs-you.\n";
brief += "- Healthy signed-in users do not see setup/admin surfaces as primary actions.\n";
brief += "- Home has materially fewer visible buttons/actions than before.\n";
brief += "- Command Palette daily actions appear before setup/admin actions.\n";
brief += "- Artifacts no longer has confusing duplicate search fields.\n";
brief += "- Visual QA still fails on console errors, asset 5xx, and horizontal overflow; update screenshots/assertions if structures change.\n";
brief += "- Existing Phase 1 tests (readiness/artifacts/layout) continue to pass.\n";
brief += "\n";
brief += "KEY FILES (read before editing):\n";
brief += "- apps/desktop/src/renderer/App.tsx\n";
brief += "- apps/desktop/src/renderer/components/views/home-view.tsx\n";
brief += "- apps/desktop/src/renderer/components/command-palette.tsx\n";
brief += "- apps/desktop/src/renderer/components/shell/app-sidebar.tsx\n";
brief += "- apps/desktop/src/renderer/components/views/tasks-view.tsx\n";
brief += "- apps/desktop/src/renderer/components/views/artifacts-view.tsx\n";
brief += "- apps/desktop/src/renderer/lib/home-landing-policy.ts\n";
brief += "- apps/desktop/src/renderer/lib/coworker-home.ts\n";
brief += "- apps/desktop/src/renderer/lib/morning-briefing.ts\n";
brief += "- apps/desktop/src/renderer/lib/thread-tasks.ts\n";
brief += "- apps/desktop/src/renderer/lib/dual-search.ts\n";
brief += "- apps/desktop/src/renderer/lib/topbar-search.ts\n";
brief += "- apps/desktop/src/renderer/lib/readiness-ui.ts / readiness-layout.ts\n";
brief += "- apps/desktop/e2e/visual-qa.spec.ts and ui-structure tests\n";
brief += "\n";

// ============================================================================
phase("Discover");
log("Discovering Phase 2 surfaces at " + desktop);

let discover_prompt = brief;
discover_prompt += "PHASE: Discover (read-only: list_dir, read_file, grep only — do not edit).\n";
discover_prompt += "Map the current signed-in daily surfaces thoroughly:\n";
discover_prompt += "1) Home: how home-view, home-landing-policy, coworker-home, morning-briefing, readiness checklist compose the first screen; count primary CTAs and setup noise when healthy.\n";
discover_prompt += "2) Sidebar: app-sidebar task/history ordering; where failed tasks appear; Chats/Tasks full-history access.\n";
discover_prompt += "3) Command palette: ranking of New task, current work, search, stop, Run setup again, billing/docs/settings.\n";
discover_prompt += "4) Search: dual-search, topbar-search, Artifacts view-local search — where global and view-local compete.\n";
discover_prompt += "5) Visual QA: e2e/visual-qa.spec.ts assertions and screenshot paths.\n";
discover_prompt += "6) Phase 1 tests: readiness-ui, account-signed-in, artifact-availability, readiness-layout, ui-structure, packaging smoke.\n";
discover_prompt += "Return root, summary, preserve[] (must-keep Phase 1 behaviors), files[] to change, risks[], current_pain[] (user-visible clutter).\n";
discover_prompt += "Do not edit files in this phase.\n";

let discovery = agent(discover_prompt, #{
    label: "discover",
    capability_mode: "read-only",
    output_schema: map_schema,
});

if discovery == () || !discovery.success {
    pause("infra", "Discover agent failed. Resume after tooling is healthy or adjust args.root.");
}

log("Discovery complete");

// ============================================================================
phase("Home");

let home_prompt = brief;
home_prompt += "PHASE: Home — signed-in Home as desk, not dashboard.\n";
if discovery != () && discovery.success && discovery.output != () {
    home_prompt += "Discovery summary: " + json_encode(discovery.output.summary) + "\n";
    home_prompt += "Current pain: " + json_encode(discovery.output.current_pain) + "\n";
    home_prompt += "Preserve: " + json_encode(discovery.output.preserve) + "\n";
    home_prompt += "Risks: " + json_encode(discovery.output.risks) + "\n";
}
home_prompt += "IMPLEMENT (not recommend):\n";
home_prompt += "1) Center signed-in Home around ONE primary composer and ONE current-work / needs-attention band.\n";
home_prompt += "2) When the app is healthy (signed-in, engine ready, not blocked), hide setup/readiness/admin noise as primary UI. Subtle account/usage chips OK.\n";
home_prompt += "3) Show at most THREE recommended next actions.\n";
home_prompt += "4) Old failed/history clutter must not dominate the first screen — demote or fold into secondary.\n";
home_prompt += "5) Power affordances stay available but visually secondary.\n";
home_prompt += "6) Prefer policy/lib helpers (home-landing-policy, coworker-home, readiness-ui) over hardcoding conditionals deep in JSX when possible.\n";
home_prompt += "7) Add or update unit/UI-structure tests proving: healthy signed-in Home hides setup primary CTAs; primary action count reduced; max 3 recommended actions.\n";
home_prompt += "8) Preserve Phase 1 truth: connected SuperGrok never renders false sign-in blockers.\n";
home_prompt += "Return done/summary/changed_files/notes.\n";

let home = agent(home_prompt, #{
    label: "home",
    capability_mode: "all",
    output_schema: status_schema,
});

if home == () || !home.success {
    await_user("no_progress", "Home phase agent failed. Resume to continue desk Home simplification.");
}

log("Home phase done");

// ============================================================================
phase("Sidebar");

let sidebar_prompt = brief;
sidebar_prompt += "PHASE: Sidebar — reduce history noise.\n";
if home != () && home.success && home.output != () {
    sidebar_prompt += "Home phase notes: " + json_encode(home.output.notes) + "\n";
    sidebar_prompt += "Home changed: " + json_encode(home.output.changed_files) + "\n";
}
sidebar_prompt += "IMPLEMENT:\n";
sidebar_prompt += "1) Prioritize active and recent meaningful work in the sidebar.\n";
sidebar_prompt += "2) Group failed historical tasks under a secondary section labeled Needs review (or equivalent i18n key).\n";
sidebar_prompt += "3) Duplicate/retry-heavy tasks must not overwhelm daily navigation (dedupe, collapse, or demote).\n";
sidebar_prompt += "4) Preserve access to full history via Chats/Tasks views.\n";
sidebar_prompt += "5) Touch app-sidebar.tsx and helpers such as thread-tasks.ts as needed; update i18n locales for new section labels.\n";
sidebar_prompt += "6) Add/update tests for Needs review grouping and active/recent priority.\n";
sidebar_prompt += "Return done/summary/changed_files/notes.\n";

let sidebar = agent(sidebar_prompt, #{
    label: "sidebar",
    capability_mode: "all",
    output_schema: status_schema,
});

if sidebar == () || !sidebar.success {
    await_user("no_progress", "Sidebar phase agent failed. Resume to continue sidebar noise reduction.");
}

log("Sidebar phase done");

// ============================================================================
phase("Palette");

let palette_prompt = brief;
palette_prompt += "PHASE: Command Palette — demote setup/admin.\n";
if sidebar != () && sidebar.success && sidebar.output != () {
    palette_prompt += "Sidebar notes: " + json_encode(sidebar.output.notes) + "\n";
}
palette_prompt += "IMPLEMENT in command-palette.tsx (and any ranking helpers):\n";
palette_prompt += "1) Rank daily actions first: New task, current work, search/open recent, stop running task.\n";
palette_prompt += "2) Run setup again must only appear when readiness is blocked OR from Settings — not as a normal daily action for healthy profiles.\n";
palette_prompt += "3) Billing, docs, settings, admin actions grouped lower and visually demoted.\n";
palette_prompt += "4) Add/update tests for ranking order and conditional setup visibility.\n";
palette_prompt += "Return done/summary/changed_files/notes.\n";

let palette = agent(palette_prompt, #{
    label: "palette",
    capability_mode: "all",
    output_schema: status_schema,
});

if palette == () || !palette.success {
    await_user("no_progress", "Palette phase agent failed. Resume to continue palette ranking work.");
}

log("Palette phase done");

// ============================================================================
phase("Search");

let search_prompt = brief;
search_prompt += "PHASE: Search — remove duplicate search friction.\n";
if palette != () && palette.success && palette.output != () {
    search_prompt += "Palette notes: " + json_encode(palette.output.notes) + "\n";
}
search_prompt += "IMPLEMENT:\n";
search_prompt += "1) Avoid showing a global search AND a view-local search that compete on the same screen.\n";
search_prompt += "2) Artifacts especially: one clear search behavior (prefer contextual view search OR global, not both stacked).\n";
search_prompt += "3) Keep keyboard/search behavior predictable (same shortcuts, focus order).\n";
search_prompt += "4) Inspect dual-search.ts, topbar-search.ts, artifacts-view.tsx, App shell search affordances.\n";
search_prompt += "5) Update tests so Artifacts structure asserts a single search field/behavior.\n";
search_prompt += "Return done/summary/changed_files/notes.\n";

let search = agent(search_prompt, #{
    label: "search",
    capability_mode: "all",
    output_schema: status_schema,
});

if search == () || !search.success {
    await_user("no_progress", "Search phase agent failed. Resume to continue search dedupe.");
}

log("Search phase done");

// ============================================================================
phase("Verify");

let verify_prompt = brief;
verify_prompt += "PHASE: Verify — run real commands from monorepo root " + root + ".\n";
verify_prompt += "1) pnpm --filter @grokdesk/desktop build\n";
verify_prompt += "2) Relevant new/updated desktop unit tests (ui-structure, home, sidebar, palette, search helpers, readiness/artifacts/layout).\n";
verify_prompt += "3) Existing Phase 1 tests, e.g.:\n";
verify_prompt += "   readiness-ui, account-signed-in, artifact-availability, readiness-layout, readiness-checklist, create-task-ui, packaging.smoke if still relevant.\n";
verify_prompt += "4) pnpm --filter @grokdesk/desktop visual-qa\n";
verify_prompt += "   - If visual-qa fails due to env (GROKDESK_NODE_PATH / better-sqlite3 ABI), set visual_qa_ok=false and document honestly in visual_qa_notes — do not fake green.\n";
verify_prompt += "   - If structures changed, update visual-qa.spec.ts screenshots/assertions first then re-run.\n";
verify_prompt += "   - Visual QA must still fail on console errors, asset 5xx, horizontal overflow.\n";
verify_prompt += "5) If you touched queue/projector/provider/gateway, run those package tests too.\n";
verify_prompt += "Return build_ok, visual_qa_ok, phase1_tests_ok, phase2_tests_ok, summary, failures[], visual_qa_notes, screenshot_paths[].\n";

let verify = agent(verify_prompt, #{
    label: "verify",
    capability_mode: "all",
    output_schema: verify_schema,
});

if verify == () || !verify.success {
    await_user("verification", "Verify agent failed to run. Resume to re-run build/tests/visual-qa.");
}

// ============================================================================
phase("Fix");

let round = 0;
let all_green = false;
if verify != () && verify.success {
    all_green = verify.output.build_ok == true
        && verify.output.phase1_tests_ok == true
        && verify.output.phase2_tests_ok == true
        && verify.output.visual_qa_ok == true;
}

while round < max_fix_rounds && !all_green {
    round += 1;
    log("Fix round " + round.to_string());
    let fix_prompt = brief;
    fix_prompt += "PHASE: Fix round " + round.to_string() + " of " + max_fix_rounds.to_string() + ".\n";
    if verify != () && verify.success {
        fix_prompt += "Previous verify summary: " + json_encode(verify.output.summary) + "\n";
        fix_prompt += "Failures: " + json_encode(verify.output.failures) + "\n";
        if verify.output.visual_qa_notes != () {
            fix_prompt += "Visual QA notes: " + json_encode(verify.output.visual_qa_notes) + "\n";
        }
    }
    fix_prompt += "Fix implementation-caused errors and broken assertions.\n";
    fix_prompt += "Update visual QA screenshots/assertions if Home/Palette/Artifacts structure changed legitimately.\n";
    fix_prompt += "Do not weaken gates for console errors, asset 5xx, or horizontal overflow.\n";
    fix_prompt += "Re-run build, Phase 1 tests, Phase 2 tests, and visual-qa.\n";
    fix_prompt += "If blocked only by environment (Node path / native module), set visual_qa_ok=false with clear notes — still fix code failures.\n";
    fix_prompt += "Return build_ok, visual_qa_ok, phase1_tests_ok, phase2_tests_ok, summary, failures[], visual_qa_notes, screenshot_paths[].\n";

    verify = agent(fix_prompt, #{
        label: "fix-" + round.to_string(),
        capability_mode: "all",
        output_schema: verify_schema,
    });

    if verify == () || !verify.success {
        await_user("verification", "Fix agent failed on round " + round.to_string() + ". Resume to continue.");
    } else {
        all_green = verify.output.build_ok == true
            && verify.output.phase1_tests_ok == true
            && verify.output.phase2_tests_ok == true
            && verify.output.visual_qa_ok == true;
    }
}

if !all_green {
    await_user(
        "verification",
        "Phase 2 still failing build/tests/visual-qa after fix rounds. Inspect failures, resume to continue, or raise args.max_fix_rounds. Env-blocked visual-qa may require GROKDESK_NODE_PATH."
    );
    let final_fix = brief;
    final_fix += "PHASE: Post-resume final fix. Re-run build, Phase 1/2 tests, visual-qa; fix remaining issues; report honestly.\n";
    final_fix += "Return build_ok, visual_qa_ok, phase1_tests_ok, phase2_tests_ok, summary, failures[], visual_qa_notes, screenshot_paths[].\n";
    verify = agent(final_fix, #{
        label: "fix-final",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if verify != () && verify.success {
        all_green = verify.output.build_ok == true
            && verify.output.phase1_tests_ok == true
            && verify.output.phase2_tests_ok == true
            && verify.output.visual_qa_ok == true;
    }
}

// ============================================================================
phase("Report");

let report_prompt = brief;
report_prompt += "PHASE: Completion report.\n";
report_prompt += "Inspect git status / changed files for Phase 2 surfaces only.\n";
report_prompt += "Write concise markdown covering:\n";
report_prompt += "- Product outcome: Home as desk; sidebar Needs review; palette ranking; single Artifacts search\n";
report_prompt += "- Changed files list\n";
report_prompt += "- Validation results (build, Phase 1 tests, Phase 2 tests, visual-qa)\n";
report_prompt += "- Screenshot / QA paths if any\n";
report_prompt += "- Remaining risks (env blockers, deferred Phase 3)\n";
report_prompt += "done=true only if acceptance criteria are met or residual is solely documented env blocker with code green.\n";
if verify != () && verify.success {
    report_prompt += "Verify payload: " + json_encode(verify.output) + "\n";
}
report_prompt += "Return done/summary/changed_files/notes (put full markdown in notes if long).\n";

let report = agent(report_prompt, #{
    label: "report",
    capability_mode: "read-write",
    output_schema: status_schema,
});

let report_text = "# implement-phase2-surfaces report\n\n";
report_text += "Root: " + root + "\n";
report_text += "Desktop: " + desktop + "\n";
report_text += "Plan: " + plan_doc + "\n";
report_text += "All green: " + all_green.to_string() + "\n\n";

if home != () && home.success && home.output != () {
    report_text += "## Home\n" + home.output.summary + "\n\n";
}
if sidebar != () && sidebar.success && sidebar.output != () {
    report_text += "## Sidebar\n" + sidebar.output.summary + "\n\n";
}
if palette != () && palette.success && palette.output != () {
    report_text += "## Palette\n" + palette.output.summary + "\n\n";
}
if search != () && search.success && search.output != () {
    report_text += "## Search\n" + search.output.summary + "\n\n";
}

if report != () && report.success && report.output != () {
    report_text += "## Report summary\n" + report.output.summary + "\n\n";
    report_text += "## Notes\n" + report.output.notes + "\n\n";
    report_text += "## Changed files (report agent)\n";
    if report.output.changed_files != () {
        for f in report.output.changed_files {
            report_text += "- " + f + "\n";
        }
    }
} else {
    report_text += "Report agent did not return structured output.\n";
}

if verify != () && verify.success {
    report_text += "\n## Verify\n";
    report_text += "- build_ok: " + verify.output.build_ok.to_string() + "\n";
    report_text += "- visual_qa_ok: " + verify.output.visual_qa_ok.to_string() + "\n";
    report_text += "- phase1_tests_ok: " + verify.output.phase1_tests_ok.to_string() + "\n";
    report_text += "- phase2_tests_ok: " + verify.output.phase2_tests_ok.to_string() + "\n";
    report_text += "- summary: " + verify.output.summary + "\n";
    if verify.output.visual_qa_notes != () {
        report_text += "- visual_qa_notes: " + verify.output.visual_qa_notes + "\n";
    }
}

let path = write_scratch_file("implement-phase2-surfaces-report.md", report_text);
log("Wrote report to " + path);

complete(#{
    path: path,
    root: root,
    desktop: desktop,
    all_green: all_green,
    report: report_text,
});
