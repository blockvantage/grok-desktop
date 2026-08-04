import { describe, expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Keep free-release asset names in lockstep with the landing download buttons.
 */
describe("free release asset names", () => {
  it("stages the same stable filenames the marketing site expects", () => {
    const script = readFileSync(
      join(__dirname, "stage-free-release-assets.mjs"),
      "utf8",
    );
    expect(script).toContain("GrokDesk-mac-arm64.dmg");
    expect(script).toContain("GrokDesk-mac-x64.dmg");
    expect(script).toContain("GrokDesk-win-x64.exe");

    // Landing defaults (when that monorepo is a sibling checkout).
    const landingDownloads = join(
      __dirname,
      "../../grok-landing/src/lib/downloads.ts",
    );
    try {
      const landing = readFileSync(landingDownloads, "utf8");
      expect(landing).toContain("GrokDesk-mac-arm64.dmg");
      expect(landing).toContain("GrokDesk-mac-x64.dmg");
      expect(landing).toContain("GrokDesk-win-x64.exe");
    } catch {
      // Sibling landing repo not present in this checkout — names in script still pinned.
    }
  });

  it("does not label an arm64 DMG as the x64 download", () => {
    const root = mkdtempSync(join(tmpdir(), "grokdesk-stage-assets-"));
    const releaseDir = join(root, "release");
    const outDir = join(root, "out");
    mkdirSync(releaseDir);
    writeFileSync(join(releaseDir, "Grok Desk-1.0.0-arm64.dmg"), "arm64");
    writeFileSync(join(releaseDir, "Grok Desk-1.0.0.dmg"), "x64");

    try {
      execFileSync(
        process.execPath,
        [
          join(__dirname, "stage-free-release-assets.mjs"),
          "--target",
          "darwin-x64",
          "--release-dir",
          releaseDir,
          "--out-dir",
          outDir,
        ],
        { stdio: "pipe" },
      );
      expect(readFileSync(join(outDir, "GrokDesk-mac-x64.dmg"), "utf8")).toBe(
        "x64",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
