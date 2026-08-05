let meta = #{
    name: "sdd-adversarial-implement",
    description: "Subagent-driven development: implement plan components one-by-one, then run adversarial (skeptic) multi-dimension review after each; fix until the gate passes before advancing. Fail-closed on missing/failed review evidence. Invoke: /workflow sdd-adversarial-implement with args.plan_path (default next-level coworker plan), optional args.root, args.max_components, args.max_fix_rounds, args.component filter, args.components seed list.",
    when_to_use: "Execute an implementation plan (phases/tasks) with implement → adversarial review → fix loops per component; default plan is docs/superpowers/plans/2026-08-04-next-level-coworker-program.md. Not for mobile-remote product work.",
    phases: [
        #{ title: "Discover", detail: "Parse plan into ordered implementable components" },
        #{ title: "Implement", detail: "Write code and tests for one component" },
        #{ title: "Adversarial", detail: "Read-only skeptics hunt defects across dimensions" },
        #{ title: "Fix", detail: "Repair confirmed issues then re-review" },
        #{ title: "Report", detail: "Write run summary of components and gate outcomes" },
    ],
};

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

let components_schema = #{
    "type": "object",
    "required": ["components"],
    "properties": #{
        "components": #{
            "type": "array",
            "maxItems": 40,
            "items": #{
                "type": "object",
                "required": ["id", "title", "body"],
                "properties": #{
                    "id": #{ "type": "string" },
                    "title": #{ "type": "string" },
                    "body": #{ "type": "string" },
                    "phase": #{ "type": "string" },
                },
            },
        },
        "notes": #{ "type": "string" },
    },
};

let implement_schema = #{
    "type": "object",
    "required": ["done", "summary", "changed_files", "tests_run", "notes"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "changed_files": #{ "type": "array", "items": #{ "type": "string" } },
        "tests_run": #{ "type": "array", "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
        "blocked_reason": #{ "type": "string" },
    },
};

// Each adversarial reviewer returns findings + an explicit approved flag.
// Gate requires approved==true AND no evidence-backed findings; missing/failed
// reviewer results never count as pass.
let adversarial_schema = #{
    "type": "object",
    "required": ["dimension", "approved", "findings", "inspected"],
    "properties": #{
        "dimension": #{ "type": "string" },
        "approved": #{ "type": "boolean" },
        "inspected": #{ "type": "boolean" },
        "findings": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["file", "issue", "why"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "why": #{ "type": "string" },
                    "severity": #{ "type": "string" },
                },
            },
        },
        "summary": #{ "type": "string" },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["done", "summary", "changed_files", "addressed"],
    "properties": #{
        "done": #{ "type": "boolean" },
        "summary": #{ "type": "string" },
        "changed_files": #{ "type": "array", "items": #{ "type": "string" } },
        "addressed": #{ "type": "array", "items": #{ "type": "string" } },
        "notes": #{ "type": "string" },
    },
};

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

// args.root: monorepo root
// args.plan_path: path to implementation plan markdown
// args.max_components: cap on components processed this run (default 1)
// args.max_fix_rounds: fix+re-review cycles per component (default 2)
// args.component: optional substring filter on component id or title
// args.components: optional pre-seeded array of {id,title,body,phase?} (skips discover body detail)
// args.discover_only: if true, only list components and complete (no implement)

let root = "/Users/maceo/blockvantage/grok/grok-desktop";
if args != () && args.root != () && type_of(args.root) == "string" && args.root != "" {
    root = args.root;
}

let plan_path = root + "/docs/superpowers/plans/2026-08-04-next-level-coworker-program.md";
if args != () && args.plan_path != () && type_of(args.plan_path) == "string" && args.plan_path != "" {
    plan_path = args.plan_path;
}

let max_components = 1;
if args != () && args.max_components != () {
    if type_of(args.max_components) == "i64" { max_components = args.max_components; }
    if type_of(args.max_components) == "f64" { max_components = args.max_components; }
}
if max_components < 0 { max_components = 0; }
if max_components > 40 { max_components = 40; }

let max_fix_rounds = 2;
if args != () && args.max_fix_rounds != () {
    if type_of(args.max_fix_rounds) == "i64" { max_fix_rounds = args.max_fix_rounds; }
    if type_of(args.max_fix_rounds) == "f64" { max_fix_rounds = args.max_fix_rounds; }
}
if max_fix_rounds < 0 { max_fix_rounds = 0; }
if max_fix_rounds > 5 { max_fix_rounds = 5; }

let component_filter = "";
if args != () && args.component != () && type_of(args.component) == "string" {
    component_filter = args.component;
}

let discover_only = false;
if args != () && args.discover_only == true {
    discover_only = true;
}

// ---------------------------------------------------------------------------
// Shared implementer rules (embedded in prompts)
// ---------------------------------------------------------------------------

let hard_rules = "";
hard_rules += "HARD RULES (must follow):\n";
hard_rules += "1) AGENTS.md credentials: Never use OS Keychain, Windows Credential Manager, @github/keytar, keytar, or Electron safeStorage for product keys / device identity. Production path remains createSafeStorageCredentialVault (AES-256-GCM under Electron userData + local .key). Unit tests may use createMemoryCredentialVault only.\n";
hard_rules += "2) Scope: Do NOT implement mobile remote, QR pairing, telepresence expansion, or remote-relay product work. Do not expand apps/mobile product paths for this program.\n";
hard_rules += "3) TDD: When the plan task defines tests, write failing tests first, then implement, then re-run until green. Prefer targeted pnpm --filter tests.\n";
hard_rules += "4) Git: No destructive git (no reset --hard, force-push, clean -fd of unrelated work). Do not revert unrelated dirty work.\n";
hard_rules += "5) Honesty: Never claim full sandbox/mediation/audit if the code path is partial. Prefer fail-closed policy.\n";
hard_rules += "6) Implement in code; do not stop at recommendations. Self-contained prompts — inspect files with tools before editing.\n";
hard_rules += "7) Work only under monorepo root: " + root + "\n";

let dimensions = ["correctness", "trust-honesty", "test-gaps"];

// ---------------------------------------------------------------------------
// Discover components
// ---------------------------------------------------------------------------

phase("Discover");
log("Discovering components from plan: " + plan_path);

let raw_components = [];
let used_seed = false;

if args != () && args.components != () && type_of(args.components) == "array" {
    raw_components = args.components;
    used_seed = true;
    log("Using args.components seed (" + raw_components.len().to_string() + " items)");
} else {
    let discover_prompt = "";
    discover_prompt += "You are planning work for subagent-driven development.\n";
    discover_prompt += "MONOREPO ROOT: " + root + "\n";
    discover_prompt += "PLAN FILE (read fully with read_file): " + plan_path + "\n";
    discover_prompt += "Use read-only tools only (read_file, grep, list_dir). Do not edit files.\n";
    discover_prompt += "Extract ordered implementable components from the plan.\n";
    discover_prompt += "Prefer Task-level units (e.g. Task A1, Task B2) when present; otherwise Phase slices.\n";
    discover_prompt += "Skip Out of scope / Non-goals / Mobile remote sections.\n";
    discover_prompt += "Each component needs: id (stable short slug like A1-audit-list), title (human), body (full task text: files, steps, tests — enough for an implementer who has not seen the plan), optional phase label.\n";
    discover_prompt += "Return at most 40 components in plan order. Empty components[] only if the plan file is missing or has zero tasks — after you attempted to read it.\n";
    discover_prompt += "Return JSON matching schema: components[], notes.\n";

    let discovery = agent(discover_prompt, #{
        label: "discover-components",
        capability_mode: "read-only",
        output_schema: components_schema,
    });

    if discovery == () || !discovery.success {
        await_user("infra", "Discover agent failed. Resume after tooling is healthy, or pass args.components / args.plan_path.");
        // After resume, try once more
        discovery = agent(discover_prompt, #{
            label: "discover-components-retry",
            capability_mode: "read-only",
            output_schema: components_schema,
        });
    }

    if discovery != () && discovery.success && discovery.output != () && discovery.output.components != () {
        raw_components = discovery.output.components;
    }
}

// Re-filter in plain Rhai (agents are untrusted): non-empty title+id, optional substring filter, cap.
let components = [];
let dropped = 0;
for c in raw_components {
    if components.len() >= max_components {
        dropped += 1;
    } else if c == () {
        dropped += 1;
    } else {
        let cid = "";
        let ctitle = "";
        let cbody = "";
        let cphase = "";
        if c.id != () && type_of(c.id) == "string" { cid = c.id; }
        if c.title != () && type_of(c.title) == "string" { ctitle = c.title; }
        if c.body != () && type_of(c.body) == "string" { cbody = c.body; }
        if c.phase != () && type_of(c.phase) == "string" { cphase = c.phase; }
        // trim mutates in place
        if type_of(cid) == "string" { cid.trim(); }
        if type_of(ctitle) == "string" { ctitle.trim(); }
        if cid == "" || ctitle == "" {
            dropped += 1;
        } else {
            let keep = true;
            if component_filter != "" {
                keep = false;
                // substring match on id or title (simple contains)
                if cid.contains(component_filter) || ctitle.contains(component_filter) {
                    keep = true;
                }
            }
            if keep {
                if cbody == "" {
                    cbody = ctitle;
                }
                components.push(#{
                    id: cid,
                    title: ctitle,
                    body: cbody,
                    phase: cphase,
                });
            } else {
                dropped += 1;
            }
        }
    }
}

if dropped > 0 {
    log("Filtered/dropped " + dropped.to_string() + " component slot(s); keeping " + components.len().to_string());
}

if components.len() == 0 {
    let empty_report = "# SDD adversarial implement — no components\n\n";
    empty_report += "- plan_path: " + plan_path + "\n";
    empty_report += "- root: " + root + "\n";
    empty_report += "- used_seed: " + used_seed.to_string() + "\n";
    empty_report += "- max_components: " + max_components.to_string() + "\n";
    empty_report += "\nNo valid components after discover/filter. Pass args.components or fix plan_path.\n";
    let empty_path = write_scratch_file("sdd-adversarial-report.md", empty_report);
    complete(#{
        path: empty_path,
        summary: "No components to implement",
        components_done: [],
        components_blocked: [],
        plan_path: plan_path,
        root: root,
    });
}

if discover_only {
    let disco_md = "# SDD discover-only\n\n";
    disco_md += "Plan: " + plan_path + "\n\n";
    disco_md += "Components (" + components.len().to_string() + "):\n";
    for c in components {
        disco_md += "- **" + c.id + "**: " + c.title + "\n";
    }
    let disco_path = write_scratch_file("sdd-adversarial-report.md", disco_md);
    complete(#{
        path: disco_path,
        summary: "Discover-only: " + components.len().to_string() + " components",
        components: components,
        plan_path: plan_path,
    });
}

// ---------------------------------------------------------------------------
// Per-component: Implement → Adversarial → Fix loop
// ---------------------------------------------------------------------------

let components_done = [];
let components_blocked = [];
let report_lines = [];

for comp in components {
    let comp_id = comp.id;
    let comp_title = comp.title;
    let comp_body = comp.body;
    log("=== Component " + comp_id + ": " + comp_title + " ===");

    // ---- Implement ----
    phase("Implement");
    let impl_prompt = "";
    impl_prompt += "You are the IMPLEMENTER for subagent-driven development.\n";
    impl_prompt += "MONOREPO ROOT: " + root + "\n";
    impl_prompt += "PLAN PATH (context only; implement THIS component fully): " + plan_path + "\n";
    impl_prompt += hard_rules;
    impl_prompt += "\nCOMPONENT ID: " + comp_id + "\n";
    impl_prompt += "COMPONENT TITLE: " + comp_title + "\n";
    impl_prompt += "COMPONENT SPEC (authoritative for this turn):\n";
    impl_prompt += json_encode(comp_body);
    impl_prompt += "\n\nREQUIREMENTS:\n";
    impl_prompt += "- Read existing code before editing (read_file/grep).\n";
    impl_prompt += "- Implement the component completely: code + tests as specified.\n";
    impl_prompt += "- Run targeted tests and fix failures you introduced.\n";
    impl_prompt += "- Prefer small commits only if the environment allows non-interactive git commit; otherwise leave working tree changes.\n";
    impl_prompt += "- Return done=true only if implementation and claimed tests actually ran successfully.\n";
    impl_prompt += "- If blocked by missing deps/env, set done=false and blocked_reason.\n";
    impl_prompt += "- Return done, summary, changed_files[], tests_run[], notes, optional blocked_reason.\n";

    let impl = agent(impl_prompt, #{
        label: "implement:" + comp_id,
        capability_mode: "all",
        output_schema: implement_schema,
    });

    if impl == () || !impl.success {
        await_user("no_progress", "Implementer failed for component " + comp_id + ". Resume to retry implement.");
        impl = agent(impl_prompt, #{
            label: "implement-retry:" + comp_id,
            capability_mode: "all",
            output_schema: implement_schema,
        });
    }

    if impl == () || !impl.success {
        components_blocked.push(#{ id: comp_id, title: comp_title, reason: "implementer_failed" });
        report_lines.push("- BLOCKED " + comp_id + ": implementer agent failed");
        await_user("verification", "Cannot advance past " + comp_id + " — implementer still failing. Resume to retry or skip by raising filters.");
        // After resume, skip this component rather than falsely approve
        continue;
    }

    if impl.output.done != true {
        let br = "implementer reported done=false";
        if impl.output.blocked_reason != () && impl.output.blocked_reason != "" {
            br = impl.output.blocked_reason;
        }
        components_blocked.push(#{ id: comp_id, title: comp_title, reason: br });
        report_lines.push("- BLOCKED " + comp_id + ": " + br);
        await_user("verification", "Component " + comp_id + " implementer done=false (" + br + "). Resume after fixing environment, or re-run.");
        continue;
    }

    // ---- Adversarial review (fail-closed) ----
    phase("Adversarial");
    let gate_open = true;
    let fix_round = 0;
    let last_findings_json = "[]";
    let last_gate_summary = "";

    while gate_open {
        log("Adversarial review for " + comp_id + " (fix_round=" + fix_round.to_string() + ")");

        let impl_summary = "";
        if impl != () && impl.success && impl.output.summary != () {
            impl_summary = impl.output.summary;
        }
        let changed = [];
        if impl != () && impl.success && impl.output.changed_files != () {
            changed = impl.output.changed_files;
        }

        let jobs = [];
        for dim in dimensions {
            let rev_prompt = "";
            rev_prompt += "You are an ADVERSARIAL reviewer (skeptic). Your job is to FIND defects, not to rubber-stamp.\n";
            rev_prompt += "DIMENSION: " + dim + "\n";
            rev_prompt += "MONOREPO ROOT: " + root + "\n";
            rev_prompt += "COMPONENT: " + comp_id + " — " + comp_title + "\n";
            rev_prompt += "SPEC:\n" + json_encode(comp_body) + "\n";
            rev_prompt += "IMPLEMENTER SUMMARY:\n" + json_encode(impl_summary) + "\n";
            rev_prompt += "CHANGED FILES (start here, then grep related):\n" + json_encode(changed) + "\n";
            rev_prompt += hard_rules;
            rev_prompt += "\nMANDATORY METHOD:\n";
            rev_prompt += "- Use read-only tools only (read_file, grep, list_dir). Do NOT edit files.\n";
            rev_prompt += "- Independently inspect the shipped code paths. Do not trust the implementer summary.\n";
            rev_prompt += "- Set inspected=true only after you actually opened relevant files.\n";
            rev_prompt += "- Hunt hard for: correctness bugs, missing edge cases, trust/honesty overclaims, missing tests, regressions, scope violations (mobile remote), credential storage violations.\n";
            rev_prompt += "- For EACH real issue: file (path), issue (what), why (why it fails / user impact). Prefer severity critical|important|minor.\n";
            rev_prompt += "- Empty findings is valid ONLY if inspected=true and you truly found nothing after reading code.\n";
            rev_prompt += "- Set approved=true ONLY if inspected=true AND findings is empty of real defects for this dimension.\n";
            rev_prompt += "- If unsure, set approved=false and add a finding explaining uncertainty with a file path.\n";
            rev_prompt += "- Fail closed: never approve from memory without reading files.\n";
            rev_prompt += "Return dimension, approved, inspected, findings[], summary.\n";

            jobs.push(#{
                prompt: rev_prompt,
                label: "adv:" + dim + ":" + comp_id,
                capability_mode: "read-only",
                output_schema: adversarial_schema,
            });
        }

        let reviews = parallel(jobs);

        // Fail-closed aggregation in plain Rhai
        let usable = 0;
        let all_approved = true;
        let confirmed = [];
        let ri = 0;
        for r in reviews {
            if r == () || !r.success || r.output == () {
                all_approved = false;
                last_gate_summary = "missing_or_failed_reviewer";
            } else {
                usable += 1;
                if r.output.inspected != true {
                    all_approved = false;
                    confirmed.push(#{
                        file: "(reviewer)",
                        issue: "Reviewer did not inspect code (inspected!=true)",
                        why: "Fail-closed: uninspected review cannot approve component " + comp_id,
                        dimension: dimensions[ri],
                    });
                }
                if r.output.approved != true {
                    all_approved = false;
                }
                if r.output.findings != () {
                    for f in r.output.findings {
                        if f != () && f.file != () && f.issue != () && f.why != () {
                            let ff = f.file;
                            let fi = f.issue;
                            let fw = f.why;
                            if type_of(ff) == "string" { ff.trim(); }
                            if type_of(fi) == "string" { fi.trim(); }
                            if type_of(fw) == "string" { fw.trim(); }
                            if ff != "" && fi != "" && fw != "" {
                                all_approved = false;
                                let dim_label = dimensions[ri];
                                if r.output.dimension != () && type_of(r.output.dimension) == "string" {
                                    dim_label = r.output.dimension;
                                }
                                confirmed.push(#{
                                    file: ff,
                                    issue: fi,
                                    why: fw,
                                    dimension: dim_label,
                                });
                            }
                        }
                    }
                }
            }
            ri += 1;
        }

        // Missing any of the 3 reviewers → not a pass
        if usable < dimensions.len() {
            all_approved = false;
            if last_gate_summary == "" {
                last_gate_summary = "incomplete_parallel_panel usable=" + usable.to_string();
            }
        }

        last_findings_json = json_encode(confirmed);

        if all_approved && confirmed.len() == 0 && usable == dimensions.len() {
            gate_open = false;
            last_gate_summary = "approved";
            log("Adversarial gate PASSED for " + comp_id);
        } else {
            gate_open = true;
            if last_gate_summary == "" || last_gate_summary == "approved" {
                last_gate_summary = "rejected findings=" + confirmed.len().to_string();
            }
            log("Adversarial gate OPEN for " + comp_id + ": " + last_gate_summary);

            if fix_round >= max_fix_rounds {
                // Exhausted fix budget — do not advance
                components_blocked.push(#{
                    id: comp_id,
                    title: comp_title,
                    reason: "adversarial_gate_open_after_fixes",
                    findings: confirmed,
                });
                report_lines.push("- BLOCKED " + comp_id + " after adversarial: " + last_gate_summary);
                await_user(
                    "verification",
                    "Adversarial gate still open for " + comp_id + " after " + max_fix_rounds.to_string()
                        + " fix rounds. Findings: " + last_findings_json
                        + ". Resume to continue fixing, or raise args.max_fix_rounds.",
                );
                // Post-resume: one more fix+review attempt
                fix_round = 0;
                max_fix_rounds = max_fix_rounds + 1;
                if max_fix_rounds > 6 { max_fix_rounds = 6; }
            }

            // ---- Fix ----
            phase("Fix");
            fix_round += 1;
            let fix_prompt = "";
            fix_prompt += "You are the FIX agent after adversarial review failed.\n";
            fix_prompt += "MONOREPO ROOT: " + root + "\n";
            fix_prompt += hard_rules;
            fix_prompt += "COMPONENT: " + comp_id + " — " + comp_title + "\n";
            fix_prompt += "SPEC:\n" + json_encode(comp_body) + "\n";
            fix_prompt += "CONFIRMED ADVERSARIAL FINDINGS (fix all with evidence):\n";
            fix_prompt += last_findings_json + "\n";
            fix_prompt += "Gate summary: " + last_gate_summary + "\n";
            fix_prompt += "Fix round " + fix_round.to_string() + ".\n";
            fix_prompt += "Read the cited files, implement fixes, add/adjust tests, re-run targeted tests.\n";
            fix_prompt += "Return done, summary, changed_files[], addressed[] (issue strings fixed), notes.\n";

            let fixr = agent(fix_prompt, #{
                label: "fix:" + comp_id + ":" + fix_round.to_string(),
                capability_mode: "all",
                output_schema: fix_schema,
            });

            if fixr == () || !fixr.success {
                await_user("verification", "Fix agent failed for " + comp_id + " round " + fix_round.to_string() + ". Resume to retry.");
                // loop will re-run adversarial; still fail-closed if no fix
            } else {
                // Merge changed files into impl summary context for next review
                if fixr.output.changed_files != () {
                    let merged = [];
                    if impl != () && impl.success && impl.output.changed_files != () {
                        for x in impl.output.changed_files { merged.push(x); }
                    }
                    for x in fixr.output.changed_files { merged.push(x); }
                    // Update impl.output for next adversarial prompt (re-bind summary)
                    impl = #{
                        success: true,
                        output: #{
                            done: true,
                            summary: fixr.output.summary,
                            changed_files: merged,
                            tests_run: [],
                            notes: "post-fix",
                        },
                    };
                }
            }
            // while continues → re-adversarial
        }
    }

    // Gate passed
    components_done.push(#{
        id: comp_id,
        title: comp_title,
        fix_rounds: fix_round,
        gate: last_gate_summary,
    });
    report_lines.push("- DONE " + comp_id + " (" + comp_title + ") gate=" + last_gate_summary + " fix_rounds=" + fix_round.to_string());
    log("Component complete: " + comp_id);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

phase("Report");

let md = "# SDD adversarial implement — run report\n\n";
md += "## How to invoke\n\n";
md += "```\n";
md += "/workflow sdd-adversarial-implement\n";
md += "# or with args:\n";
md += "# plan_path: docs/superpowers/plans/2026-08-04-next-level-coworker-program.md\n";
md += "# max_components: 1\n";
md += "# max_fix_rounds: 2\n";
md += "# component: A1\n";
md += "# discover_only: true\n";
md += "```\n\n";
md += "## Run context\n\n";
md += "- root: `" + root + "`\n";
md += "- plan_path: `" + plan_path + "`\n";
md += "- max_components: " + max_components.to_string() + "\n";
md += "- max_fix_rounds: " + max_fix_rounds.to_string() + "\n\n";
md += "## Components done\n\n";
if components_done.len() == 0 {
    md += "(none)\n\n";
} else {
    for line in report_lines {
        if line.contains("DONE") {
            md += line + "\n";
        }
    }
    md += "\n";
}
md += "## Components blocked\n\n";
if components_blocked.len() == 0 {
    md += "(none)\n\n";
} else {
    for line in report_lines {
        if line.contains("BLOCKED") {
            md += line + "\n";
        }
    }
    md += "\n";
}
md += "## Gate policy\n\n";
md += "- Implementer uses capability_mode `all` (write + execute tests).\n";
md += "- Adversarial reviewers are `read-only` and must set `inspected=true` after reading code.\n";
md += "- Advancement requires all dimensions approved, full parallel panel usable, and zero evidence-backed findings.\n";
md += "- Missing/failed reviewer or `approved!=true` keeps the gate open (fail-closed).\n";
md += "- Fix loop runs until gate passes or max_fix_rounds + user resume.\n";

let report_path = write_scratch_file("sdd-adversarial-report.md", md);
log("Wrote report " + report_path);

complete(#{
    path: report_path,
    summary: "Done=" + components_done.len().to_string() + " Blocked=" + components_blocked.len().to_string(),
    components_done: components_done,
    components_blocked: components_blocked,
    plan_path: plan_path,
    root: root,
    report: md,
});
