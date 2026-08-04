let meta = #{
    name: "implement-phase5-motion",
    description: "Phase 5: coherent motion, performance cleanup, release/QA gate (no new product workflows)",
    when_to_use: "After Phases 1-4 of simplified-experience; finish motion language, lazy previews, visual-qa/release-qa",
    phases: [
        #{ title: "Preflight", detail: "Classify visual-qa hang; ensure fallback gate" },
        #{ title: "Motion", detail: "Tokens + surfaces; reduced-motion" },
        #{ title: "Performance", detail: "api import graph + lazy previews" },
        #{ title: "Verify", detail: "build, release-qa, visual-qa, regressions" },
        #{ title: "Report", detail: "Evidence summary and residual risks" },
    ],
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
    "required": ["build_ok", "release_qa_ok", "visual_qa_ok", "summary", "failures"],
    "properties": #{
        "build_ok": #{ "type": "boolean" },
        "release_qa_ok": #{ "type": "boolean" },
        "visual_qa_ok": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "failures": #{ "type": "array", "items": #{ "type": "string" } },
        "visual_qa_notes": #{ "type": "string" },
        "preflight_hang_class": #{ "type": "string" },
    },
};

let root = "/Users/maceo/blockvantage/grok/grok-desktop";
if args != () && args.root != () && type_of(args.root) == "string" && args.root != "" {
    root = args.root;
}

let desktop = root + "/apps/desktop";
let plan_doc = root + "/docs/simplified-experience-qa-plan-2026-07-31.md";

phase("Preflight");
let preflight_prompt = "";
preflight_prompt += "Phase 5 preflight for Grok Desk at " + root + ".\n";
preflight_prompt += "Read " + plan_doc + " Phase 5 section and apps/desktop/e2e/visual-qa.spec.ts.\n";
preflight_prompt += "Classify visual-qa hang: firstWindow / gateway child / worker teardown / Playwright fixture / userData lock.\n";
preflight_prompt += "If safely fixable, fix; else document exact blocker in visual-qa header + ensure package.json has release-qa.\n";
preflight_prompt += "AGENTS.md: never keychain/keytar/safeStorage for product keys; createSafeStorageCredentialVault only.\n";
preflight_prompt += "Do not add product workflows or Phase 6 ideas. Scope: motion, lazy previews, QA gate only.\n";
preflight_prompt += "Return done=true when preflight note is written into code comments or release-qa docs, changed_files listed.\n";
let preflight = agent(preflight_prompt, #{
    label: "phase5-preflight",
    capability_mode: "read-write",
    output_schema: status_schema,
});

phase("Motion");
let motion_prompt = "";
motion_prompt += "Complete Phase 5 motion at " + desktop + ".\n";
motion_prompt += "Ensure lib/motion-system.ts tokens cover: navigation, palette, intent chips, work graph, artifact reveal, approval/needs-you.\n";
motion_prompt += "Wire MOTION_SURFACE_CLASSES / helpers into App, command-palette, home intent chips, work-graph-rail, artifacts, deliverables-digest, plan-card.\n";
motion_prompt += "view-transition and CSS must honor prefers-reduced-motion; globals use --motion-duration-* tokens for VT.\n";
motion_prompt += "Keep motion subtle/functional. Unit tests in motion-system.test.ts must pass.\n";
motion_prompt += "No decorative redesign. Return done + changed_files.\n";
let motion = agent(motion_prompt, #{
    label: "phase5-motion",
    capability_mode: "read-write",
    output_schema: status_schema,
});

phase("Performance");
let perf_prompt = "";
perf_prompt += "Phase 5 performance at " + desktop + ".\n";
perf_prompt += "No dynamic import of @/lib/api (static only). markdown-lazy + dynamic mermaid. Heavy views React.lazy in App.\n";
perf_prompt += "lazy-preview-load.test.ts must pass. Run pnpm --filter @grokdesk/desktop build and note api.ts dual-import warning if any.\n";
perf_prompt += "Do not destabilize IPC/task startup. Return done + changed_files + notes about build warnings.\n";
let perf = agent(perf_prompt, #{
    label: "phase5-perf",
    capability_mode: "execute",
    output_schema: status_schema,
});

phase("Verify");
let verify_prompt = "";
verify_prompt += "Verify Phase 5 at " + root + ".\n";
verify_prompt += "Run: pnpm --filter @grokdesk/desktop release-qa\n";
verify_prompt += "Run: pnpm --filter @grokdesk/desktop build\n";
verify_prompt += "Run: pnpm --filter @grokdesk/desktop visual-qa (capture soft-skip honestly if Electron blocked)\n";
verify_prompt += "If needed: motion/lazy/view-transition unit tests and touched Phase 1-4 desktop suites.\n";
verify_prompt += "Set visual_qa_ok true only if product gate passes or soft-skip is documented; never fabricate Electron success.\n";
verify_prompt += "preflight_hang_class: one of firstWindow|gateway|teardown|fixture|userData|none.\n";
let verify = agent(verify_prompt, #{
    label: "phase5-verify",
    capability_mode: "execute",
    output_schema: verify_schema,
});

phase("Report");
let report = #{
    preflight: preflight,
    motion: motion,
    perf: perf,
    verify: verify,
};
complete(report);
