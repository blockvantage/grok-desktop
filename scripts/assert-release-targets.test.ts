/**
 * Deterministic unit tests for qualified signed desktop release targets.
 *
 * PATH standard fixtures are in-memory only. Run:
 *   pnpm exec vitest run scripts/assert-release-targets.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QUALIFICATION_EVIDENCE_PATH,
  HOLDBACK_TARGET,
  QUALIFIED_PUBLICATION_TARGETS,
  assertReleaseTargets,
  parseElectronBuilderPublishTargets,
  parseWorkflowReleaseTargets,
  type ReleaseTargetAssertInput,
} from "./assert-release-targets.js";

const QUALIFIED = [...QUALIFIED_PUBLICATION_TARGETS];

function baseInput(
  overrides: Partial<ReleaseTargetAssertInput> = {},
): ReleaseTargetAssertInput {
  return {
    targets: QUALIFIED,
    publishArtifacts: ["dmg", "zip", "nsis"],
    env: {},
    evidencePresent: false,
    evidencePath: DEFAULT_QUALIFICATION_EVIDENCE_PATH,
    ...overrides,
  };
}

describe("PATH standard constants", () => {
  it("publishes only darwin-arm64, darwin-x64, and win32-x64 by default", () => {
    expect(QUALIFIED_PUBLICATION_TARGETS).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "win32-x64",
    ]);
  });

  it("holds back win32-arm64 until qualification evidence exists", () => {
    expect(HOLDBACK_TARGET).toBe("win32-arm64");
    expect(DEFAULT_QUALIFICATION_EVIDENCE_PATH).toBe(
      "docs/releases/qualification/win32-arm64.md",
    );
  });
});

describe("assertReleaseTargets — qualified matrix", () => {
  it("accepts the default qualified target set without holdback", () => {
    const result = assertReleaseTargets(baseInput());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects unknown or unsupported publication targets", () => {
    const result = assertReleaseTargets(
      baseInput({ targets: ["darwin-arm64", "linux-x64"] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes("linux-x64"))).toBe(true);
  });

  it("rejects portable Windows publish artifacts", () => {
    const result = assertReleaseTargets(
      baseInput({ publishArtifacts: ["nsis", "portable"] }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /portable/i.test(e))).toBe(true);
  });
});

describe("assertReleaseTargets — win32-arm64 holdback", () => {
  it("rejects win32-arm64 when QUALIFIED_WIN32_ARM64 is unset", () => {
    const result = assertReleaseTargets(
      baseInput({
        targets: [...QUALIFIED, "win32-arm64"],
        env: {},
        evidencePresent: true,
      }),
    );
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.includes("win32-arm64") && e.includes("QUALIFIED_WIN32_ARM64"),
      ),
    ).toBe(true);
  });

  it("rejects win32-arm64 when QUALIFIED_WIN32_ARM64=1 but evidence is missing", () => {
    const result = assertReleaseTargets(
      baseInput({
        targets: [...QUALIFIED, "win32-arm64"],
        env: { QUALIFIED_WIN32_ARM64: "1" },
        evidencePresent: false,
      }),
    );
    expect(result.ok).toBe(false);
    expect(
      result.errors.some(
        (e) =>
          e.includes("win32-arm64") &&
          e.includes(DEFAULT_QUALIFICATION_EVIDENCE_PATH),
      ),
    ).toBe(true);
  });

  it("rejects win32-arm64 when QUALIFIED_WIN32_ARM64 is not exactly 1", () => {
    for (const value of ["true", "yes", "0", ""]) {
      const result = assertReleaseTargets(
        baseInput({
          targets: [...QUALIFIED, "win32-arm64"],
          env: { QUALIFIED_WIN32_ARM64: value },
          evidencePresent: true,
        }),
      );
      expect(result.ok).toBe(false);
      expect(
        result.errors.some((e) => e.includes("QUALIFIED_WIN32_ARM64")),
      ).toBe(true);
    }
  });

  it("accepts win32-arm64 only with QUALIFIED_WIN32_ARM64=1 and evidence file", () => {
    const result = assertReleaseTargets(
      baseInput({
        targets: [...QUALIFIED, "win32-arm64"],
        env: { QUALIFIED_WIN32_ARM64: "1" },
        evidencePresent: true,
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("parseWorkflowReleaseTargets", () => {
  it("extracts matrix include targets from release-desktop workflow YAML", () => {
    const yaml = `
name: release-desktop
jobs:
  package:
    strategy:
      matrix:
        include:
          - target: darwin-arm64
            os: macos-14
          - target: darwin-x64
            os: macos-13
          - target: win32-x64
            os: windows-latest
`;
    expect(parseWorkflowReleaseTargets(yaml)).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "win32-x64",
    ]);
  });

  it("surfaces win32-arm64 if present in the matrix", () => {
    const yaml = `
        include:
          - target: win32-x64
          - target: win32-arm64
`;
    expect(parseWorkflowReleaseTargets(yaml)).toEqual([
      "win32-x64",
      "win32-arm64",
    ]);
  });
});

describe("parseElectronBuilderPublishTargets", () => {
  it("reads win targets including portable for rejection", () => {
    const yml = `
win:
  target:
    - nsis
    - portable
mac:
  target:
    - dmg
    - zip
`;
    expect(parseElectronBuilderPublishTargets(yml).sort()).toEqual(
      ["dmg", "nsis", "portable", "zip"].sort(),
    );
  });

  it("handles single-line target forms", () => {
    const yml = `
win:
  target: nsis
mac:
  target: dmg
`;
    expect(parseElectronBuilderPublishTargets(yml).sort()).toEqual(
      ["dmg", "nsis"].sort(),
    );
  });
});
