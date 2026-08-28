/**
 * Phase 4.2 — catalogs and README must not revive the three false site claims.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG } from "./catalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../../");

const FORBIDDEN = [
  "secrets live in the OS keychain",
  "credentials stay in the OS keychain",
  "stored in the macOS Keychain",
  "live in macOS Keychain",
  "deletes always need explicit yes",
  "sharp edges always wait",
  "memory stays home",
  "not on someone's server",
  "memory never leaves your machine",
];

function collectUserCopy(): string {
  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  const site = fs.readFileSync(
    path.join(repoRoot, "docs/honesty/site-copy.md"),
    "utf8",
  );
  return `${JSON.stringify(CATALOG)}\n${readme}\n${site}`;
}

describe("honesty copy O-005 / O-006 / O-007", () => {
  it("does not claim OS keychain storage, universal always-wait deletes, or memory that never leaves", () => {
    const hay = collectUserCopy().toLowerCase();
    for (const phrase of FORBIDDEN) {
      expect(hay, phrase).not.toContain(phrase.toLowerCase());
    }
  });

  it("English security copy names the file vault and denies Keychain", () => {
    const en = CATALOG.en as {
      settings: { securityDesc: string; privacyPointLocal: string };
      onboarding: { policyAutopilotDesc: string };
      memory: { subtitle: string };
    };
    expect(en.settings.securityDesc.toLowerCase()).toMatch(/encrypted/);
    expect(en.settings.securityDesc.toLowerCase()).toMatch(
      /not the macos keychain/,
    );
    expect(en.settings.privacyPointLocal).toMatch(/SuperGrok/i);
    expect(en.onboarding.policyAutopilotDesc.toLowerCase()).toMatch(
      /without asking/,
    );
    expect(en.memory.subtitle).toMatch(/sent to SuperGrok/i);
  });

  it("ships paste-ready site copy for the three owner-gated claims", () => {
    const site = fs.readFileSync(
      path.join(repoRoot, "docs/honesty/site-copy.md"),
      "utf8",
    );
    expect(site).toMatch(/encrypted vault/i);
    expect(site).toMatch(/not in the macOS Keychain/i);
    expect(site).toMatch(/Autopilot\*\* can delete/i);
    expect(site).toMatch(/included in the prompt sent to SuperGrok/i);
  });

  it("README describes the file vault, not OS credential stores", () => {
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    expect(readme).toMatch(/AES-256-GCM/i);
    expect(readme).toMatch(/never OS Keychain/i);
    expect(readme).toMatch(/Autopilot is available[\s\S]*deletes without prompting/i);
    expect(readme).toMatch(/relevant context is sent to SuperGrok/i);
  });
});
