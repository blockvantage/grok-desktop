let meta = #{
    name: "launch-p0-fix",
    description: "Orchestrate launch P0: landing claim honesty, desktop license/copyright, runtime first-run gate, verify greps, write summary",
    phases: [
        #{ title: "Inventory", detail: "read-only scan of remaining false claims and runtime wiring" },
        #{ title: "Verify", detail: "gating greps and unit tests for shipped paths" },
        #{ title: "Summary", detail: "write Done / Owner-only / Residual risk summary" },
    ],
    when_to_use: "After launch readiness audit, to verify P0 honesty + first-run runtime gate fixes",
};

let inventory_schema = #{
    "type": "object",
    "required": ["landing_claim_hits", "desktop_claim_hits", "runtime_wired"],
    "properties": #{
        "landing_claim_hits": #{ "type": "array", "items": #{ "type": "string" } },
        "desktop_claim_hits": #{ "type": "array", "items": #{ "type": "string" } },
        "runtime_wired": #{ "type": "boolean" },
        "notes": #{ "type": "string" },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["claim_grep_clean", "desktop_grep_clean", "runtime_evidence", "tests_ok"],
    "properties": #{
        "claim_grep_clean": #{ "type": "boolean" },
        "desktop_grep_clean": #{ "type": "boolean" },
        "runtime_evidence": #{ "type": "string" },
        "tests_ok": #{ "type": "boolean" },
        "test_log": #{ "type": "string" },
    },
};

let summary_schema = #{
    "type": "object",
    "required": ["done", "owner_only", "residual_risk"],
    "properties": #{
        "done": #{ "type": "array", "items": #{ "type": "string" } },
        "owner_only": #{ "type": "array", "items": #{ "type": "string" } },
        "residual_risk": #{ "type": "array", "items": #{ "type": "string" } },
        "summary_markdown": #{ "type": "string" },
    },
};

phase("Inventory");
let inv = agent(
    "Inventory launch P0 surfaces in the workspace root (contains grok-landing and grok-desktop). "
        + "Use grep/read_file only. Report: (1) any remaining user-facing false claims "
        + "(OS keychain storage, always-wait deletes under Autopilot, memory never leaves without SuperGrok honesty) "
        + "under grok-landing/src; (2) any remaining free-product commercial license theater "
        + "(three devices, lifetime stable updates, Copyright © xAI) under grok-desktop apps/desktop user-facing sources; "
        + "(3) whether RuntimeInstallStep is imported/used from onboarding-wizard or home-view and whether "
        + "shouldBlockCreate/createTask hard-blocks when engineStatus is missing. "
        + "Return landing_claim_hits, desktop_claim_hits, runtime_wired, notes.",
    #{
        label: "inventory",
        capability_mode: "read-only",
        output_schema: inventory_schema,
    },
);

phase("Verify");
let ver = agent(
    "Verify launch P0 gating for Grok Desk. Run shell commands from the workspace that contains "
        + "grok-landing and grok-desktop (parent of both). "
        + "1) rg for forbidden landing claim patterns under grok-landing/src; expect zero false claims "
        + "(honest vault wording that mentions Keychain as NOT storage is OK). "
        + "2) rg for 'three devices|lifetime stable updates|Copyright © xAI' under "
        + "grok-desktop/apps/desktop (not docs/history). "
        + "3) Confirm RuntimeInstallStep is used from home-view and/or onboarding-wizard and createTask "
        + "blocks runtime_missing. "
        + "4) Run: cd grok-landing && pnpm exec vitest run tests/claim-honesty.test.ts tests/oss-consistency.test.ts "
        + "and cd grok-desktop && pnpm exec vitest run apps/desktop/src/renderer/lib/create-task-ui.test.ts "
        + "apps/desktop/src/renderer/lib/readiness-ui.test.ts — if node_modules missing, set tests_ok false and note env. "
        + "Return claim_grep_clean, desktop_grep_clean, runtime_evidence, tests_ok, test_log.",
    #{
        label: "verify",
        capability_mode: "execute",
        output_schema: verify_schema,
    },
);

phase("Summary");
let inv_notes = "";
if inv != () && inv.success && inv.output.notes != () {
    inv_notes = inv.output.notes;
}
let ver_log = "";
if ver != () && ver.success && ver.output.test_log != () {
    ver_log = ver.output.test_log;
}
let sum_prompt = "";
sum_prompt += "Write the final launch-P0 human summary for Grok Desk based on inventory notes: ";
sum_prompt += inv_notes;
sum_prompt += " and verify log: ";
sum_prompt += ver_log;
sum_prompt += ". Sections: Done (what was fixed in-repo), Remaining owner-only "
    + "(signing secrets, live SuperGrok E2E, legal entity names, redeploy), Residual risk "
    + "(free runtime download may still fail without backend; live site may lag until redeploy). "
    + "Return done[], owner_only[], residual_risk[], and summary_markdown with those three ## headings. "
    + "Also write the markdown via write tool to docs/launch-p0-summary.md under the workspace if writable, "
    + "or report path only in summary_markdown.";
let sum = agent(
    sum_prompt,
    #{
        label: "summary",
        capability_mode: "read-write",
        output_schema: summary_schema,
    },
);

let md = "# Launch P0 summary\n\n(workflow incomplete)";
if sum != () && sum.success && sum.output.summary_markdown != () {
    md = sum.output.summary_markdown;
}
let path = write_scratch_file("launch-p0-summary.md", md);
log("Wrote summary to " + path);

let claim_ok = false;
let desk_ok = false;
let tests_ok = false;
let runtime_ok = false;
if ver != () && ver.success {
    if ver.output.claim_grep_clean == true { claim_ok = true; }
    if ver.output.desktop_grep_clean == true { desk_ok = true; }
    if ver.output.tests_ok == true { tests_ok = true; }
    if ver.output.runtime_evidence != () && ver.output.runtime_evidence != "" {
        runtime_ok = true;
    }
}
if inv != () && inv.success && inv.output.runtime_wired == true {
    runtime_ok = true;
}

complete(#{
    summary_path: path,
    claim_grep_clean: claim_ok,
    desktop_grep_clean: desk_ok,
    runtime_ok: runtime_ok,
    tests_ok: tests_ok,
    markdown: md,
});
