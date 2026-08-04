let meta = #{
    name: "implement-landing",
    description: "Fully implement the Deep Navy + Ice Grok Desk landing redesign in grok-landing (not a review)",
    when_to_use: "When redesigning or implementing the public Grok Desk marketing landing page against the premium Deep Navy + Ice brief",
    phases: [
        #{ title: "Discover", detail: "Map current landing architecture and preserve constraints" },
        #{ title: "Foundation", detail: "Semantic tokens, globals, design-contract rewrite" },
        #{ title: "Copy", detail: "English dictionary and section copy as source of truth" },
        #{ title: "Shell", detail: "Nav, page assembly, trust strip, section scaffolding" },
        #{ title: "Hero", detail: "Hero + interactive multi-demo product window" },
        #{ title: "Narrative", detail: "Overnight run, behaviors, real goals" },
        #{ title: "Surface", detail: "Feature groups, SuperGrok bridge, pricing, FAQ, final CTA" },
        #{ title: "Locales", detail: "Sync non-English dictionaries to the new Dictionary shape" },
        #{ title: "Verify", detail: "Lint, tests, production build" },
        #{ title: "Fix", detail: "Repair failures until green or blocked" },
        #{ title: "Report", detail: "Write completion report" },
    ],
};

let map_schema = #{
    "type": "object",
    "required": ["root", "summary", "preserve", "files", "risks"],
    "properties": #{
        "root": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "preserve": #{ "type": "array", "items": #{ "type": "string" } },
        "files": #{ "type": "array", "items": #{ "type": "string" } },
        "risks": #{ "type": "array", "items": #{ "type": "string" } },
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
    "required": ["lint_ok", "test_ok", "build_ok", "summary", "failures"],
    "properties": #{
        "lint_ok": #{ "type": "boolean" },
        "test_ok": #{ "type": "boolean" },
        "build_ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "failures": #{ "type": "array", "items": #{ "type": "string" } },
    },
};

// --- args ---
// args.root: absolute path to grok-landing (optional)
// args.skip_locales: if true, only keep en compiling via temporary stubs (not recommended)
// args.max_fix_rounds: number of fix cycles after verify (default 2)
let root = "/Users/maceo/blockvantage/grok/grok-landing";
if args != () && args.root != () && type_of(args.root) == "string" && args.root != "" {
    root = args.root;
}
let skip_locales = false;
if args != () && args.skip_locales == true { skip_locales = true; }
let max_fix_rounds = 2;
if args != () && args.max_fix_rounds != () {
    // coerce carefully; invalid values fall back to 2
    if type_of(args.max_fix_rounds) == "i64" { max_fix_rounds = args.max_fix_rounds; }
    if type_of(args.max_fix_rounds) == "f64" { max_fix_rounds = args.max_fix_rounds; }
}

let spec = root + "/docs/superpowers/specs/2026-07-23-deep-navy-ice-landing.md";
let brief_header = "";
brief_header += "You are a senior product designer and frontend engineer implementing a full production landing page.\n";
brief_header += "REPO ROOT (absolute): " + root + "\n";
brief_header += "SPEC (read fully with read_file before editing): " + spec + "\n";
brief_header += "Framework: Next.js App Router, React, TypeScript, Tailwind 4, existing i18n dictionaries.\n";
brief_header += "HARD RULES:\n";
brief_header += "- Implement code in the repo. Do not stop after plans or mockups.\n";
brief_header += "- Work only under the REPO ROOT unless fixing a path you just created there.\n";
brief_header += "- Preserve checkout (BuyButton -> /api/checkout), Stripe, account, fulfillment, waitlist, and API routes.\n";
brief_header += "- Preserve pricingFromEnv launch $29 / list $49 semantics.\n";
brief_header += "- Use semantic CSS variables from the spec; no scattered raw hex in components.\n";
brief_header += "- Avoid forbidden marketing words: cowork, claude, chatbot, chatgpt.\n";
brief_header += "- Do not claim xAI affiliation beyond requiring SuperGrok.\n";
brief_header += "- Respect prefers-reduced-motion; accessible focus; native FAQ disclosures.\n";
brief_header += "- Ice Blue is a scarce accent, not a page wash.\n";
brief_header += "- After edits, prefer running targeted checks from REPO ROOT with pnpm.\n\n";

// ============================================================================
// Discover
// ============================================================================
phase("Discover");
log("Mapping landing architecture at " + root);

let discover_prompt = brief_header;
discover_prompt += "PHASE: Discover (read-only tools only: list_dir, read_file, grep).\n";
discover_prompt += "Inspect the landing implementation thoroughly:\n";
discover_prompt += "- src/app/[lang]/page.tsx and layout.tsx\n";
discover_prompt += "- src/app/globals.css\n";
discover_prompt += "- src/components/site-header.tsx, site-footer.tsx, buy-button.tsx, product-frame.tsx\n";
discover_prompt += "- src/components/sections/*\n";
discover_prompt += "- src/i18n/dictionaries/en.ts and how other locales satisfy Dictionary\n";
discover_prompt += "- src/lib/pricing.ts, src/lib/copy.ts\n";
discover_prompt += "- tests/design-contract.test.ts and related tests that lock visual system\n";
discover_prompt += "- package.json scripts\n";
discover_prompt += "Return structured output: root, summary of current UX system, preserve list (must-keep behaviors), key files to change, risks (i18n shape, design-contract tests, etc).\n";
discover_prompt += "Do not edit files in this phase.\n";

let discovery = agent(discover_prompt, #{
    label: "discover",
    capability_mode: "read-only",
    output_schema: map_schema,
});

if discovery == () || !discovery.success {
    pause("infra", "Discover agent failed. Resume after checking agent tooling, or pass a different args.root.");
}

log("Discovery complete");

// ============================================================================
// Foundation
// ============================================================================
phase("Foundation");

let foundation_prompt = brief_header;
foundation_prompt += "PHASE: Foundation — tokens + global styles + design contract.\n";
if discovery.success && discovery.output != () {
    foundation_prompt += "Discovery summary: " + json_encode(discovery.output.summary) + "\n";
    foundation_prompt += "Preserve: " + json_encode(discovery.output.preserve) + "\n";
    foundation_prompt += "Risks: " + json_encode(discovery.output.risks) + "\n";
}
foundation_prompt += "TASKS (implement, not recommend):\n";
foundation_prompt += "1) Read the SPEC file completely.\n";
foundation_prompt += "2) Update src/app/globals.css :root with the full semantic palette from the SPEC.\n";
foundation_prompt += "3) Wire tokens into @theme / utility-friendly names so components can use semantic colors.\n";
foundation_prompt += "4) Update body/html defaults for the new light editorial + deep product-surface system (~55% cloud/white, ~30% deep navy surfaces).\n";
foundation_prompt += "5) Define focus-visible styles, selection, reduced-motion helpers, and typography utilities (display, metadata mono, voice serif for emphasis only).\n";
foundation_prompt += "6) REWRITE tests/design-contract.test.ts to lock the NEW Deep Navy + Ice system instead of warm-noir/stone/ember. Enforce:\n";
foundation_prompt += "   - required CSS variables exist in globals.css\n";
foundation_prompt += "   - no purple/violet glow aesthetics\n";
foundation_prompt += "   - ice used sparingly (not whole-page background)\n";
foundation_prompt += "   - success/approval/danger remain distinct tokens\n";
foundation_prompt += "7) Update button/badge UI primitives if they hardcode old warm-noir colors so primary CTA can use Ice.\n";
foundation_prompt += "8) Keep Geist Sans / Mono and Instrument Serif loading from layout if already present.\n";
foundation_prompt += "Do not fully rewrite every section yet — foundation only, but leave the app compilable if possible.\n";
foundation_prompt += "Return done/summary/changed_files/notes.\n";

let foundation = agent(foundation_prompt, #{
    label: "foundation",
    capability_mode: "all",
    output_schema: status_schema,
});

if foundation == () || !foundation.success {
    await_user("no_progress", "Foundation agent did not complete. Resume to retry foundation, or inspect partial edits in the landing repo.");
}

log("Foundation status: " + (if foundation.success { foundation.output.summary } else { "failed" }));

// ============================================================================
// Copy
// ============================================================================
phase("Copy");

let copy_prompt = brief_header;
copy_prompt += "PHASE: Copy — English dictionary is source of truth.\n";
copy_prompt += "Read SPEC and current src/i18n/dictionaries/en.ts.\n";
copy_prompt += "Rewrite English marketing copy so every required section has complete strings:\n";
copy_prompt += "nav, hero (eyebrow/headline/support/CTAs/metadata), trust strip, overnight timeline + artifacts, four core behaviors, three real goals, four feature groups (Run/Remember/Reach/Desk), SuperGrok bridge (3 cards), pricing receipt, FAQ (6 Qs), final CTA.\n";
copy_prompt += "Use the exact positioning language from the SPEC where specified (headlines, CTAs, FAQ questions).\n";
copy_prompt += "Update Dictionary shape carefully: other locale files must still typecheck. Either:\n";
copy_prompt += "  (preferred) keep a compatible nested shape and extend fields, updating TypeScript types via typeof en, OR\n";
copy_prompt += "  restructure en and immediately patch other locale files with English placeholders for new keys so `satisfies Dictionary` still works.\n";
copy_prompt += "Update meta title/description/OG strings to match the new positioning.\n";
copy_prompt += "Preserve checkout label keys needed by BuyButton.\n";
copy_prompt += "Do not introduce forbidden marketing words.\n";
copy_prompt += "Return done/summary/changed_files/notes.\n";

let copy = agent(copy_prompt, #{
    label: "copy-en",
    capability_mode: "all",
    output_schema: status_schema,
});

if copy == () || !copy.success {
    await_user("no_progress", "Copy agent failed. Resume to continue from current dictionary state.");
}

// ============================================================================
// Shell
// ============================================================================
phase("Shell");

let shell_prompt = brief_header;
shell_prompt += "PHASE: Shell — navigation, page assembly, trust strip, section wiring.\n";
shell_prompt += "Read SPEC, en dictionary, and current page/header/footer.\n";
shell_prompt += "Implement:\n";
shell_prompt += "1) SiteHeader: logo, How it runs, Everything it does, Pricing, FAQ, primary CTA 'Buy once · $29' (or dictionary equivalent). Responsive collapse of secondary links; keep logo + purchase CTA on mobile. Smooth scroll to section anchors.\n";
shell_prompt += "2) src/app/[lang]/page.tsx section order matching SPEC (hero, trust, overnight, behaviors, real goals, product surface, SuperGrok bridge, pricing, FAQ, final CTA). Remove or demote RemoteSoon if it conflicts.\n";
shell_prompt += "3) Trust strip component/section with the four trust items.\n";
shell_prompt += "4) Ensure section ids match nav anchors (e.g. #how, #features, #pricing, #faq).\n";
shell_prompt += "5) SiteFooter remains coherent with new palette and links.\n";
shell_prompt += "6) Wire existing BuyButton for purchase CTAs.\n";
shell_prompt += "Scaffold any missing section components so the page imports compile, even if some sections are still thin — later phases will deepen them.\n";
shell_prompt += "Return done/summary/changed_files/notes.\n";

let shell = agent(shell_prompt, #{
    label: "shell",
    capability_mode: "all",
    output_schema: status_schema,
});

if shell == () || !shell.success {
    await_user("no_progress", "Shell agent failed. Resume to continue page assembly.");
}

// ============================================================================
// Hero
// ============================================================================
phase("Hero");

let hero_prompt = brief_header;
hero_prompt += "PHASE: Hero + interactive product demonstration.\n";
hero_prompt += "Implement Hero and product window per SPEC:\n";
hero_prompt += "- Eyebrow, two-line headline with restrained serif emphasis if appropriate, supporting copy, primary + secondary CTAs, purchase metadata chips.\n";
hero_prompt += "- Realistic interactive Grok Desk product window (not generic widgets).\n";
hero_prompt += "- Show: current goal, model/effort mode, parallel task progress, timestamps, completed + queued tasks, artifacts generating, Needs-you approval state, on-device/local-context indicator.\n";
hero_prompt += "- User can switch among at least 3 demos: Research competitors; Organize Downloads; Draft a launch brief.\n";
hero_prompt += "- Animate task progression subtly; if prefers-reduced-motion, show static final-ish state without looping animation.\n";
hero_prompt += "- Use Deep Navy product surfaces + Ice/Electric for live/active only; approval amber; success green for completed.\n";
hero_prompt += "- Status must not rely on color alone (include text labels).\n";
hero_prompt += "Update src/components/sections/hero.tsx and product-frame.tsx (or a new client component). Keep dependency-light (React state + CSS).\n";
hero_prompt += "Secondary CTA should scroll to overnight narrative section.\n";
hero_prompt += "Return done/summary/changed_files/notes.\n";

let hero = agent(hero_prompt, #{
    label: "hero",
    capability_mode: "all",
    output_schema: status_schema,
});

if hero == () || !hero.success {
    await_user("no_progress", "Hero agent failed. Resume to continue hero/product demo work.");
}

// ============================================================================
// Narrative + behaviors + goals
// ============================================================================
phase("Narrative");

let narrative_prompt = brief_header;
narrative_prompt += "PHASE: Overnight narrative, core behaviors, real goals.\n";
narrative_prompt += "Implement three areas per SPEC:\n";
narrative_prompt += "1) Overnight-run timeline: 18:30 goal received; 18:34 research/comparison parallel; 19:12 artifacts staged; 19:14 sensitive moves held for approval; 08:00 brief complete. Pair with finished-result card listing brief-monday.md, sources.json, pricing-diff.md. Communicate work completed, everything else untouched.\n";
narrative_prompt += "2) Four premium behavior cards: Parallel tasks; Schedules; Local memory; Approvals. Approvals card MUST include interactive approve control that visibly changes from approval-amber required to success-green completed (text updates too).\n";
narrative_prompt += "3) Real goals section with the three concrete user instructions from the SPEC.\n";
narrative_prompt += "Reuse/refactor how-it-works.tsx and pillars.tsx or create clean section components. Keep premium, calm, not a feature wall.\n";
narrative_prompt += "Return done/summary/changed_files/notes.\n";

let narrative = agent(narrative_prompt, #{
    label: "narrative",
    capability_mode: "all",
    output_schema: status_schema,
});

if narrative == () || !narrative.success {
    await_user("no_progress", "Narrative agent failed. Resume to continue overnight/behaviors sections.");
}

// ============================================================================
// Surface: features, bridge, pricing, FAQ, final CTA
// ============================================================================
phase("Surface");

let surface_prompt = brief_header;
surface_prompt += "PHASE: Product surface, SuperGrok bridge, pricing, FAQ, final CTA.\n";
surface_prompt += "Implement remaining sections per SPEC:\n";
surface_prompt += "1) Complete product surface — four compact categories Run / Remember / Reach / Desk with the listed items. Not an overwhelming wall.\n";
surface_prompt += "2) SuperGrok bridge — headline and three cards (X search, Imagine, Model and reasoning effort). Clear that SuperGrok is required and sold separately; no extra xAI affiliation claims.\n";
surface_prompt += "3) Pricing — premium receipt-style card with $29 launch, $49 later, license/features/updates/refunds/SuperGrok note, CTA Get Grok Desk · $29 via BuyButton.\n";
surface_prompt += "4) FAQ — six questions using native details/summary; keyboard accessible.\n";
surface_prompt += "5) Final CTA — Put the goal on the desk. + copy + CTA + once/platforms/refunds line. Ice accent appropriate here.\n";
surface_prompt += "Update feature-index, grok-depth, pricing, faq, final-cta components. Ensure dictionary fields exist and page imports match.\n";
surface_prompt += "Return done/summary/changed_files/notes.\n";

let surface = agent(surface_prompt, #{
    label: "surface",
    capability_mode: "all",
    output_schema: status_schema,
});

if surface == () || !surface.success {
    await_user("no_progress", "Surface agent failed. Resume to finish pricing/FAQ/CTA sections.");
}

// ============================================================================
// Locales
// ============================================================================
phase("Locales");

if !skip_locales {
    let locales = ["es", "fr", "de", "ja", "pt", "zh"];
    let locale_jobs = [];
    for loc in locales {
        let lp = brief_header;
        lp += "PHASE: Locale sync for " + loc + ".\n";
        lp += "Read src/i18n/dictionaries/en.ts (source of truth shape) and src/i18n/dictionaries/" + loc + ".ts.\n";
        lp += "Update " + loc + ".ts so it satisfies Dictionary (typeof en): same keys/structure, translated where practical.\n";
        lp += "Product nouns stay verbatim: Grok Desk, SuperGrok, X, Imagine, Stripe, $29, file names like brief-monday.md.\n";
        lp += "No forbidden marketing words in any language (cowork/claude/chatbot/chatgpt).\n";
        lp += "If you cannot produce high-quality translation for every new string, use clear English placeholders for those strings rather than breaking the shape — but prefer proper " + loc + " translations for nav, hero, pricing, FAQ, and CTAs.\n";
        lp += "Do not modify other locale files in this job.\n";
        lp += "Return done/summary/changed_files/notes.\n";
        locale_jobs.push(#{
            prompt: lp,
            label: "locale-" + loc,
            capability_mode: "all",
            output_schema: status_schema,
        });
    }
    let locale_results = parallel(locale_jobs);
    let locale_ok = 0;
    let locale_fail = 0;
    for r in locale_results {
        if r != () && r.success && r.output.done == true {
            locale_ok += 1;
        } else {
            locale_fail += 1;
        }
    }
    log("Locales updated ok=" + locale_ok.to_string() + " fail_or_partial=" + locale_fail.to_string());
    if locale_fail > 0 {
        // One consolidator pass to force typecheck shape
        let fix_locales_prompt = brief_header;
        fix_locales_prompt += "PHASE: Locale consolidator.\n";
        fix_locales_prompt += "Some locale files may be out of sync. Read en.ts and every file in src/i18n/dictionaries/.\n";
        fix_locales_prompt += "Make all of es/fr/de/ja/pt/zh satisfy Dictionary. Prefer filling missing keys from English temporarily if needed so `pnpm build` typechecks.\n";
        fix_locales_prompt += "Ensure assertNoForbiddenMarketing would still pass.\n";
        fix_locales_prompt += "Return done/summary/changed_files/notes.\n";
        let loc_fix = agent(fix_locales_prompt, #{
            label: "locale-consolidate",
            capability_mode: "all",
            output_schema: status_schema,
        });
        if loc_fix == () || !loc_fix.success {
            await_user("verification", "Locale consolidator failed. Resume after fixing dictionary shapes or set args.skip_locales.");
        }
    }
} else {
    log("skip_locales=true — relying on prior English-compatible stubs");
}

// ============================================================================
// Verify
// ============================================================================
phase("Verify");

let verify_prompt = brief_header;
verify_prompt += "PHASE: Verification — run real commands from REPO ROOT.\n";
verify_prompt += "1) cd to REPO ROOT.\n";
verify_prompt += "2) Run: pnpm lint\n";
verify_prompt += "3) Run: pnpm test\n";
verify_prompt += "4) Run: pnpm build\n";
verify_prompt += "Capture failures with file/line detail. Also spot-check that SPEC sections exist in page.tsx and that BuyButton still posts to /api/checkout.\n";
verify_prompt += "Do not 'fix' by deleting tests unless a test still asserts the obsolete warm-noir system — then update the test to the new design contract.\n";
verify_prompt += "Return lint_ok, test_ok, build_ok, summary, failures[].\n";

let verify = agent(verify_prompt, #{
    label: "verify",
    capability_mode: "all",
    output_schema: verify_schema,
});

if verify == () || !verify.success {
    await_user("verification", "Verify agent failed to run. Resume to re-run lint/test/build.");
}

// ============================================================================
// Fix loop
// ============================================================================
phase("Fix");

let round = 0;
let all_green = verify.success && verify.output.lint_ok == true && verify.output.test_ok == true && verify.output.build_ok == true;

while round < max_fix_rounds && !all_green {
    round += 1;
    log("Fix round " + round.to_string());
    let fix_prompt = brief_header;
    fix_prompt += "PHASE: Fix round " + round.to_string() + " of " + max_fix_rounds.to_string() + ".\n";
    fix_prompt += "Previous verify summary: " + json_encode(verify.output.summary) + "\n";
    fix_prompt += "Failures: " + json_encode(verify.output.failures) + "\n";
    fix_prompt += "Fix every implementation-caused lint/test/build error. Re-read SPEC definition of done.\n";
    fix_prompt += "Also fix incomplete UX gaps if tests pass but critical SPEC sections are missing from the rendered page.\n";
    fix_prompt += "After fixes, re-run pnpm lint, pnpm test, and pnpm build from REPO ROOT.\n";
    fix_prompt += "Return lint_ok, test_ok, build_ok, summary, failures[].\n";

    verify = agent(fix_prompt, #{
        label: "fix-" + round.to_string(),
        capability_mode: "all",
        output_schema: verify_schema,
    });

    if verify == () || !verify.success {
        await_user("verification", "Fix agent failed on round " + round.to_string() + ". Resume to continue.");
    } else {
        all_green = verify.output.lint_ok == true && verify.output.test_ok == true && verify.output.build_ok == true;
    }
}

if !all_green {
    await_user(
        "verification",
        "Landing redesign still failing lint/test/build after fix rounds. Inspect failures, then resume to continue fixing, or raise args.max_fix_rounds and re-run."
    );
    // After resume, one more verify+fix attempt
    let final_fix_prompt = brief_header;
    final_fix_prompt += "PHASE: Post-resume final fix. Run pnpm lint, pnpm test, pnpm build from REPO ROOT, fix remaining issues, re-run until green or document blockers in failures.\n";
    final_fix_prompt += "Return lint_ok, test_ok, build_ok, summary, failures[].\n";
    verify = agent(final_fix_prompt, #{
        label: "fix-final",
        capability_mode: "all",
        output_schema: verify_schema,
    });
    if verify != () && verify.success {
        all_green = verify.output.lint_ok == true && verify.output.test_ok == true && verify.output.build_ok == true;
    }
}

// ============================================================================
// Report
// ============================================================================
phase("Report");

let report_prompt = brief_header;
report_prompt += "PHASE: Completion report (read tools + light file inspection).\n";
report_prompt += "Inspect the final page composition and key components. Write a concise markdown report covering:\n";
report_prompt += "- What changed (sections + design system)\n";
report_prompt += "- Interactions implemented (demo switcher, approval control, checkout)\n";
report_prompt += "- Accessibility/reduced-motion notes\n";
report_prompt += "- Verify results (lint/test/build)\n";
report_prompt += "- Residual risks or follow-ups\n";
report_prompt += "Also list the most important changed files.\n";
report_prompt += "Return done=true if the definition of done is met; otherwise done=false with honest notes.\n";
if verify != () && verify.success {
    report_prompt += "Verify payload: " + json_encode(verify.output) + "\n";
}

let report = agent(report_prompt, #{
    label: "report",
    capability_mode: "read-write",
    output_schema: status_schema,
});

let report_text = "# implement-landing report\n\n";
report_text += "Root: " + root + "\n";
report_text += "Spec: " + spec + "\n";
report_text += "All green: " + all_green.to_string() + "\n\n";
if report != () && report.success && report.output != () {
    report_text += "## Summary\n" + report.output.summary + "\n\n";
    report_text += "## Notes\n" + report.output.notes + "\n\n";
    report_text += "## Changed files (from report agent)\n";
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
    report_text += "- lint_ok: " + verify.output.lint_ok.to_string() + "\n";
    report_text += "- test_ok: " + verify.output.test_ok.to_string() + "\n";
    report_text += "- build_ok: " + verify.output.build_ok.to_string() + "\n";
    report_text += "- summary: " + verify.output.summary + "\n";
}

let path = write_scratch_file("implement-landing-report.md", report_text);

complete(#{
    path: path,
    root: root,
    all_green: all_green,
    report: report_text,
});
