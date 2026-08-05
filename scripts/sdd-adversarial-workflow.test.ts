/**
 * Structural gate for the SDD + adversarial-review Grok workflow.
 * Drives the real shipped file under .grok/workflows/ — not a reimplementation.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".grok/workflows/sdd-adversarial-implement.rhai",
);

function loadWorkflow(): string {
  expect(existsSync(WORKFLOW), `missing workflow at ${WORKFLOW}`).toBe(true);
  return readFileSync(WORKFLOW, "utf8");
}

describe("sdd-adversarial-implement workflow (shipped Rhai)", () => {
  it("exists under project .grok/workflows and declares pure-literal meta name", () => {
    const src = loadWorkflow();
    expect(src.startsWith("let meta = #{")).toBe(true);
    expect(src).toMatch(/name:\s*"sdd-adversarial-implement"/);
    expect(src).toMatch(/phase\s*\(\s*"Discover"\s*\)/);
    expect(src).toMatch(/phase\s*\(\s*"Implement"\s*\)/);
    expect(src).toMatch(/phase\s*\(\s*"Adversarial"\s*\)/);
    expect(src).toMatch(/phase\s*\(\s*"Fix"\s*\)/);
    expect(src).toMatch(/complete\s*\(/);
  });

  it("implements with write/execute capability and reviews as read-only", () => {
    const src = loadWorkflow();
    // Implementer / fix agents must be able to edit and run tests
    expect(src).toMatch(/label:\s*"implement:"\s*\+/);
    expect(src).toMatch(/capability_mode:\s*"all"/);
    // Adversarial panel is explicitly read-only
    expect(src).toMatch(/label:\s*"adv:"\s*\+/);
    const advBlock = src.slice(src.indexOf('label: "adv:"'));
    expect(advBlock).toMatch(/capability_mode:\s*"read-only"/);
    // Prompt requires independent inspection / defect hunting
    expect(src).toMatch(/ADVERSARIAL reviewer/);
    expect(src).toMatch(/Independently inspect/);
    expect(src).toMatch(/FIND defects/);
    expect(src).toMatch(/inspected=true/);
  });

  it("advances only via structured approve gate (fail-closed on missing review)", () => {
    const src = loadWorkflow();
    expect(src).toMatch(/"approved"/);
    expect(src).toMatch(/gate_open/);
    expect(src).toMatch(/all_approved/);
    expect(src).toMatch(/missing_or_failed_reviewer/);
    expect(src).toMatch(/inspected\s*!=\s*true/);
    expect(src).toMatch(/usable\s*<\s*dimensions\.len\(\)/);
    // Must not treat empty/missing parallel slots as pass — gate stays open
    expect(src).toMatch(/if\s+usable\s*<\s*dimensions\.len\(\)/);
    expect(src).toMatch(/all_approved\s*=\s*false/);
    // Components only land in done after gate passes
    expect(src).toMatch(/components_done\.push/);
    expect(src).toMatch(/gate_open\s*=\s*false/);
  });

  it("embeds hard product rules (credentials, no mobile remote, no destructive git, TDD)", () => {
    const src = loadWorkflow();
    expect(src).toMatch(/Keychain/);
    expect(src).toMatch(/keytar/);
    expect(src).toMatch(/safeStorage/);
    expect(src).toMatch(/createSafeStorageCredentialVault/);
    expect(src).toMatch(/mobile remote/i);
    expect(src).toMatch(/reset --hard/);
    expect(src).toMatch(/TDD/);
  });

  it("documents invocation and default plan path in meta/description", () => {
    const src = loadWorkflow();
    expect(src).toMatch(/when_to_use:/);
    expect(src).toMatch(
      /2026-08-04-next-level-coworker-program\.md/,
    );
    expect(src).toMatch(/\/workflow sdd-adversarial-implement/);
    expect(src).toMatch(/max_components/);
    expect(src).toMatch(/write_scratch_file\s*\(\s*"sdd-adversarial-report\.md"/);
  });
});
