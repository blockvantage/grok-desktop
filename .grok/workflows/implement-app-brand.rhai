let meta = #{
    name: "implement-app-brand",
    description: "Align Grok Desk desktop app branding to Deep Navy + Ice (match landing), full implementation",
    when_to_use: "When the landing page brand was updated and the desktop (and optionally mobile) product UI must match with the same rigor",
    phases: [
        #{ title: "Discover", detail: "Map desktop token system, hardcodes, tests, brand surfaces" },
        #{ title: "Foundation", detail: "Remap globals tokens, Electron bg, DESIGN.md, token tests" },
        #{ title: "Chrome", detail: "Shell, brand mark, buttons, focus, activity cues" },
        #{ title: "States", detail: "Approvals, success, danger, running/processing surfaces" },
        #{ title: "Surfaces", detail: "Onboarding, license, empty states, high-visibility screens" },
        #{ title: "Mobile", detail: "Optional companion theme parity" },
        #{ title: "Sweep", detail: "Purge residual sand/warm hardcodes" },
        #{ title: "Verify", detail: "Typecheck, tests, build" },
        #{ title: "Fix", detail: "Repair failures until green or blocked" },
        #{ title: "Report", detail: "Completion report" },
    ],
};

let map_schema = #{
    "type": "object",
    "required": ["root", "summary", "preserve", "files", "risks", "hardcode_hits"],
    "properties": #{
        "root": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "preserve": #{ "type": "array", "items": #{ "type": "string" } },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
        "risks": #{ "type": "array", "items": #{ "type": "string" } },
        "hardcode_hits": #{ "type": "array", "items": #{ "type": "string" } },
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
    "required": ["typecheck_ok", "test_ok", "build_ok", "summary", "failures"],
    "properties": #{
        "typecheck_ok": #{ "type": "boolean" },
        "test_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "failures": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

// args.root: monorepo root (grok-desktop)
// args.desktop: path to apps/desktop (optional)
// args.skip_mobile: bool
// args.max_fix_rounds: number (default 2)
let root = "/Users/maceo/blockvantage/grok/grok-desktop";
if args != () && args.root != () && type_of(args.root) == "string" && args.root != "" {
    root = args.root;
}
let desktop = root + "/apps/desktop";
if args != () && args.desktop != () && type_of(args.desktop) == "string" && args.desktop != "" {
    desktop = args.desktop;
}
let skip_mobile = false;
if args != () && args.skip_mobile == true { skip_mobile = true; }
let max_fix_rounds = 2;
if args != () && args.max_fix_rounds != () {
    if type_of(args.max_fix_rounds) == "i64" { max_fix_rounds = args.max_fix_rounds; }
    if type_of(args.max_fix_rounds) == "f64" { max_fix_rounds = args.max_fix_rounds; }
}

let spec = root + "/docs/superpowers/specs/2026-07-24-desktop-deep-navy-ice-brand.md";
let landing_spec = "/Users/maceo/blockvantage/grok/grok-landing/docs/superpowers/specs/2026-07-23-deep-navy-ice-landing.md";
let landing_css = "/Users/maceo/blockvantage/grok/grok-landing/src/app/globals.css";

let brief = "";
brief += "You are a senior product designer and frontend engineer implementing brand consistency for Grok Desk.\n";
brief += "MONOREPO ROOT: " + root + "\n";
brief += "DESKTOP PACKAGE: " + desktop + "\n";
brief += "SPEC (read fully): " + spec + "\n";
brief += "LANDING SPEC (reference): " + landing_spec + "\n";
brief += "LANDING CSS (reference tokens): " + landing_css + "\n";
brief += "HARD RULES:\n";
brief += "- Implement in code. Do not stop at recommendations.\n";
brief += "- Align desktop product to Deep Navy + Ice brand matching the landing page.\n";
brief += "- Keep the APP DARK (midnight/navy product chrome). Do not convert to light marketing cloud layout.\n";
brief += "- Ice is scarce accent; approval/success/danger/electric roles stay distinct; never color-only status.\n";
brief += "- Preserve architecture, IPC, license, onboarding flows, token discipline (no raw rose/amber/sky utilities).\n";
brief += "- Prefer remapping CSS variables so components inherit brand changes.\n";
brief += "- Purge warm sand primary (HSL ~34 32%) and #0e0e10 window flash color.\n";
brief += "- Honor prefers-reduced-motion and visible focus-visible.\n";
brief += "- Run package commands from the correct directory after inspecting package.json scripts.\n\n";

// ============================================================================
phase("Discover");
log("Discovering desktop brand surfaces at " + desktop);

let discover_prompt = brief;
discover_prompt += "PHASE: Discover (read-only: list_dir, read_file, grep).\n";
discover_prompt += "Map thoroughly:\n";
discover_prompt += "- apps/desktop/src/renderer/styles/globals.css token system\n";
discover_prompt += "- apps/desktop/tailwind.config.js\n";
discover_prompt += "- apps/desktop/DESIGN.md\n";
discover_prompt += "- design-tokens.test.ts and ui-structure tests that lock visuals\n";
discover_prompt += "- brand-mark, onboarding-wizard, license screens, buttons, badges\n";
discover_prompt += "- approval / waiting / success UI (grep approval, waiting, warning, primary)\n";
discover_prompt += "- Electron BrowserWindow backgroundColor in main/index.ts\n";
discover_prompt += "- Hardcoded sand colors: '34 32%', '#0e0e10', warm sand comments\n";
discover_prompt += "- apps/mobile theme/colors if present\n";
discover_prompt += "- package scripts for test/typecheck/build\n";
discover_prompt += "Return root, summary, preserve[], files[], risks[], hardcode_hits[].\n";
discover_prompt += "Do not edit files.\n";

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
phase("Foundation");

let foundation_prompt = brief;
foundation_prompt += "PHASE: Foundation — tokens, Electron bg, DESIGN.md, design-token tests.\n";
if discovery.success && discovery.output != () {
    foundation_prompt += "Discovery summary: " + json_encode(discovery.output.summary) + "\n";
    foundation_prompt += "Hardcode hits: " + json_encode(discovery.output.hardcode_hits) + "\n";
    foundation_prompt += "Risks: " + json_encode(discovery.output.risks) + "\n";
}
foundation_prompt += "TASKS (implement):\n";
foundation_prompt += "1) Read SPEC and landing globals.css for hex parity.\n";
foundation_prompt += "2) Remap :root tokens in globals.css to Deep Navy + Ice roles (background/sidebar/card/popover/primary/ring/success/warning/destructive/glow).\n";
foundation_prompt += "3) Add explicit --color-midnight/navy/ink/panel/ice/electric/frost/success/approval/danger aliases.\n";
foundation_prompt += "4) Retune body ambient gradients from warm sand to subtle cool ice/electric (scarce, not neon wash).\n";
foundation_prompt += "5) Map --warning to approval amber; --success and --destructive to brand functional colors; primary to ice.\n";
foundation_prompt += "6) Update Electron backgroundColor to #050e21 (midnight).\n";
foundation_prompt += "7) Rewrite DESIGN.md principles for Deep Navy + Ice (remove warm-sand-as-primary).\n";
foundation_prompt += "8) Update design-tokens.test.ts: keep discipline rules; assert brand tokens / primary ice mapping / no sand primary.\n";
foundation_prompt += "9) Update tailwind.config.js if new semantic colors are needed; keep hairline ladder.\n";
foundation_prompt += "Verify contrast of primary buttons (ice fill + ink label). Adjust tokens if AA fails.\n";
foundation_prompt += "Return done/summary/changed_files/notes.\n";

let foundation = agent(foundation_prompt, #{
    label: "foundation",
    capability_mode: "all",
    output_schema: status_schema,
});

if foundation == () || !foundation.success {
    await_user("no_progress", "Foundation agent failed. Resume to retry token remapping.");
}

// ============================================================================
phase("Chrome");

let chrome_prompt = brief;
chrome_prompt += "PHASE: Chrome — shell, brand mark, buttons, focus, activity rings.\n";
chrome_prompt += "With tokens remapped, fix remaining chrome that hardcodes sand or warm light:\n";
chrome_prompt += "- brand-mark.tsx and any logo treatments\n";
chrome_prompt += "- UI button/badge primitives if they hardcode colors outside tokens\n";
chrome_prompt += "- focus-visible / ring utilities still sand-tinted\n";
chrome_prompt += "- live activity, streaming avatar rings, progress that referenced primary sand\n";
chrome_prompt += "- sidebar active state should read ice/electric selected, not sand\n";
chrome_prompt += "Keep density and layout. Prefer token classes (bg-primary, text-primary, ring) over hex.\n";
chrome_prompt += "Return done/summary/changed_files/notes.\n";

let chrome = agent(chrome_prompt, #{
    label: "chrome",
    capability_mode: "all",
    output_schema: status_schema,
});

if chrome == () || !chrome.success {
    await_user("no_progress", "Chrome agent failed. Resume to continue shell branding.");
}

// ============================================================================
phase("States");

let states_prompt = brief;
states_prompt += "PHASE: Functional states — approval, success, danger, processing.\n";
states_prompt += "Audit and fix product states so they match brand semantics:\n";
states_prompt += "- Approval / needs-you / held actions → approval amber (--warning / --color-approval) + text\n";
states_prompt += "- Completed / approved → success green\n";
states_prompt += "- Destructive / errors → danger\n";
states_prompt += "- Running / processing / links / progress → electric or ice activity (not approval)\n";
states_prompt += "Search for Waiting for approval, HELD, needs you, review-changes, protection-chip, etc.\n";
states_prompt += "Interactive approval affordances must visibly change state when approved if present.\n";
states_prompt += "Return done/summary/changed_files/notes.\n";

let states = agent(states_prompt, #{
    label: "states",
    capability_mode: "all",
    output_schema: status_schema,
});

if states == () || !states.success {
    await_user("no_progress", "States agent failed. Resume to continue semantic state branding.");
}

// ============================================================================
phase("Surfaces");

let surfaces_prompt = brief;
surfaces_prompt += "PHASE: High-visibility surfaces — onboarding, license, empty states, marketing-ish screens.\n";
surfaces_prompt += "These are the first screens users see after purchase; they must match landing brand.\n";
surfaces_prompt += "Update onboarding-wizard, license-activation-screen, empty-state, page-header treatments, and any hero-like panels still sand-themed.\n";
surfaces_prompt += "Do not change copy meaning or flow steps unless required for contrast/brand classes.\n";
surfaces_prompt += "Return done/summary/changed_files/notes.\n";

let surfaces = agent(surfaces_prompt, #{
    label: "surfaces",
    capability_mode: "all",
    output_schema: status_schema,
});

if surfaces == () || !surfaces.success {
    await_user("no_progress", "Surfaces agent failed. Resume to finish onboarding/license brand pass.");
}

// ============================================================================
phase("Mobile");

if !skip_mobile {
    let mobile_prompt = brief;
    mobile_prompt += "PHASE: Mobile companion brand parity (best-effort, same palette).\n";
    mobile_prompt += "Inspect apps/mobile for theme/colors/styles. If a token or theme file exists, map to Deep Navy + Ice.\n";
    mobile_prompt += "If mobile is minimal or has no theme layer, document that in notes and make only safe, small color updates.\n";
    mobile_prompt += "Do not break Expo/React Native builds.\n";
    mobile_prompt += "Return done/summary/changed_files/notes.\n";
    let mobile = agent(mobile_prompt, #{
        label: "mobile",
        capability_mode: "all",
        output_schema: status_schema,
    });
    if mobile == () || !mobile.success {
        log("Mobile phase failed or partial — continuing; desktop is primary");
    }
} else {
    log("skip_mobile=true");
}

// ============================================================================
phase("Sweep");

let sweep_prompt = brief;
sweep_prompt += "PHASE: Residual hardcode sweep.\n";
sweep_prompt += "Grep the desktop package (exclude node_modules, release, out) for:\n";
sweep_prompt += "  34 32%, #0e0e10, warm sand, hsl(34, sand accent leftovers, obsolete DESIGN claims\n";
sweep_prompt += "Fix product code leftovers. Docs under apps/desktop/*.md that describe sand-as-primary should be updated if they would mislead implementers.\n";
sweep_prompt += "Keep functional comments that only mention historical context only if necessary; prefer accurate current system.\n";
sweep_prompt += "Return done/summary/changed_files/notes listing remaining acceptable hits if any.\n";

let sweep = agent(sweep_prompt, #{
    label: "sweep",
    capability_mode: "all",
    output_schema: status_schema,
});

if sweep == () || !sweep.success {
    await_user("no_progress", "Sweep agent failed. Resume to finish hardcode purge.");
}

// ============================================================================
phase("Verify");

let verify_prompt = brief;
verify_prompt += "PHASE: Verify — run real commands.\n";
verify_prompt += "1) Read apps/desktop/package.json and monorepo package.json for scripts.\n";
verify_prompt += "2) Run typecheck for desktop (e.g. pnpm --filter @grokdesk/desktop typecheck OR cd apps/desktop && pnpm typecheck).\n";
verify_prompt += "3) Run tests (prefer desktop package tests; if monorepo test is standard and reliable, use it carefully).\n";
verify_prompt += "4) Run desktop build (pnpm build in apps/desktop or filter equivalent). Do not run full OS packaging dist unless needed.\n";
verify_prompt += "5) Confirm design-tokens tests pass and globals no longer set sand primary.\n";
verify_prompt += "Return typecheck_ok, test_ok, build_ok, summary, failures[].\n";

let verify = agent(verify_prompt, #{
    label: "verify",
    capability_mode: "all",
    output_schema: verify_schema,
});

if verify == () || !verify.success {
    await_user("verification", "Verify agent failed to run. Resume to re-run typecheck/test/build.");
}

// ============================================================================
phase("Fix");

let round = 0;
let all_green = verify.success && verify.output.typecheck_ok == true && verify.output.test_ok == true && verify.output.build_ok == true;

while round < max_fix_rounds && !all_green {
    round += 1;
    log("Fix round " + round.to_string());
    let fix_prompt = brief;
    fix_prompt += "PHASE: Fix round " + round.to_string() + " of " + max_fix_rounds.to_string() + ".\n";
    fix_prompt += "Previous verify: " + json_encode(verify.output.summary) + "\n";
    fix_prompt += "Failures: " + json_encode(verify.output.failures) + "\n";
    fix_prompt += "Fix all implementation-caused errors. Re-run typecheck, tests, and build.\n";
    fix_prompt += "Return typecheck_ok, test_ok, build_ok, summary, failures[].\n";

    verify = agent(fix_prompt, #{
        label: "fix-" + round.to_string(),
        capability_mode: "all",
        output_schema: verify_schema,
    });

    if verify == () || !verify.success {
        await_user("verification", "Fix agent failed on round " + round.to_string() + ". Resume to continue.");
    } else {
        all_green = verify.output.typecheck_ok == true && verify.output.test_ok == true && verify.output.build_ok == true;
    }
}

if !all_green {
    await_user(
        "verification",
        "App brand still failing typecheck/test/build after fix rounds. Inspect failures, resume to continue, or raise args.max_fix_rounds."
    );
    let final_fix = brief;
    final_fix += "PHASE: Post-resume final fix. Re-run typecheck/test/build, fix remaining issues, report honestly.\n";
    final_fix += "Return typecheck_ok, test_ok, build_ok, summary, failures[].\n";
    verify = agent(final_fix, #{
        label: "fix-final",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if verify != () && verify.success {
        all_green = verify.output.typecheck_ok == true && verify.output.test_ok == true && verify.output.build_ok == true;
    }
}

// ============================================================================
phase("Report");

let report_prompt = brief;
report_prompt += "PHASE: Completion report.\n";
report_prompt += "Inspect final globals.css primary tokens, Electron backgroundColor, DESIGN.md, and a sample of brand surfaces.\n";
report_prompt += "Write concise markdown covering: token mapping, surfaces changed, residual risks, verify results, changed files.\n";
report_prompt += "done=true only if definition of done is met.\n";
if verify != () && verify.success {
    report_prompt += "Verify payload: " + json_encode(verify.output) + "\n";
}

let report = agent(report_prompt, #{
    label: "report",
    capability_mode: "read-write",
    output_schema: status_schema,
});

let report_text = "# implement-app-brand report\n\n";
report_text += "Root: " + root + "\n";
report_text += "Desktop: " + desktop + "\n";
report_text += "Spec: " + spec + "\n";
report_text += "All green: " + all_green.to_string() + "\n\n";
if report != () && report.success && report.output != () {
    report_text += "## Summary\n" + report.output.summary + "\n\n";
    report_text += "## Notes\n" + report.output.notes + "\n\n";
    report_text += "## Changed files\n";
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
    report_text += "- typecheck_ok: " + verify.output.typecheck_ok.to_string() + "\n";
    report_text += "- test_ok: " + verify.output.test_ok.to_string() + "\n";
    report_text += "- build_ok: " + verify.output.build_ok.to_string() + "\n";
    report_text += "- summary: " + verify.output.summary + "\n";
}

let path = write_scratch_file("implement-app-brand-report.md", report_text);

complete(#{
    path: path,
    root: root,
    desktop: desktop,
    all_green: all_green,
    report: report_text,
});
