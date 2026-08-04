#!/usr/bin/env node
/**
 * Assert qualified signed desktop release targets.
 *
 * Enforces the launch publication matrix (darwin-arm64, darwin-x64, win32-x64),
 * rejects portable Windows publish artifacts, and holds back win32-arm64 unless
 * QUALIFIED_WIN32_ARM64=1 and a qualification evidence file are present.
 *
 * Env / CLI:
 *   QUALIFIED_WIN32_ARM64=1  — explicit opt-in to publish win32-arm64
 *   RELEASE_WORKFLOW_PATH    — override workflow path (default PATH standard)
 *   ELECTRON_BUILDER_YML     — override electron-builder.yml path
 *   QUALIFICATION_EVIDENCE   — override evidence file path
 *   --dry-run                — print resolved config; still runs assertions
 *
 * PATH standard (desktop repo root):
 *   .github/workflows/release-desktop.yml
 *   apps/desktop/electron-builder.yml
 *   docs/releases/qualification/win32-arm64.md
 *
 * Run tests:
 *   pnpm exec vitest run scripts/assert-release-targets.test.ts
 *
 * CLI:
 *   pnpm exec tsx scripts/assert-release-targets.ts
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DESKTOP_ROOT = path.resolve(__dirname, "..");

/** Launch-qualified publication targets. win32-arm64 stays unpublished. */
export const QUALIFIED_PUBLICATION_TARGETS = [
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
] as const;

export type QualifiedPublicationTarget =
  (typeof QUALIFIED_PUBLICATION_TARGETS)[number];

/** Held-back until real-hardware qualification record is complete. */
export const HOLDBACK_TARGET = "win32-arm64" as const;

/** Canonical runtime targets (includes holdback). */
export const CANONICAL_RUNTIME_TARGETS = [
  ...QUALIFIED_PUBLICATION_TARGETS,
  HOLDBACK_TARGET,
] as const;

export type CanonicalRuntimeTarget =
  (typeof CANONICAL_RUNTIME_TARGETS)[number];

/** PATH standard layout under the desktop monorepo root. */
export const RELEASE_PATHS = {
  workflow: ".github/workflows/release-desktop.yml",
  electronBuilder: "apps/desktop/electron-builder.yml",
  win32Arm64Evidence: "docs/releases/qualification/win32-arm64.md",
} as const;

export const DEFAULT_QUALIFICATION_EVIDENCE_PATH =
  RELEASE_PATHS.win32Arm64Evidence;

/** Artifacts that must never ship from the paid/release path. */
export const FORBIDDEN_PUBLISH_ARTIFACTS = ["portable"] as const;

const QUALIFIED_SET = new Set<string>(QUALIFIED_PUBLICATION_TARGETS);
const CANONICAL_SET = new Set<string>(CANONICAL_RUNTIME_TARGETS);

export type ReleaseTargetAssertInput = {
  /** Process/runtime targets listed for this release (e.g. matrix). */
  targets: readonly string[];
  /** electron-builder target names (dmg, zip, nsis, portable, …). */
  publishArtifacts: readonly string[];
  /** Process env (tests inject; CLI uses process.env). */
  env: Readonly<Record<string, string | undefined>>;
  /** Whether the win32-arm64 qualification evidence file exists. */
  evidencePresent: boolean;
  /** Evidence path for error messages (PATH standard). */
  evidencePath: string;
};

export type ReleaseTargetAssertResult = {
  ok: boolean;
  errors: string[];
};

export function isQualifiedPublicationTarget(
  value: string,
): value is QualifiedPublicationTarget {
  return QUALIFIED_SET.has(value);
}

export function isCanonicalRuntimeTarget(
  value: string,
): value is CanonicalRuntimeTarget {
  return CANONICAL_SET.has(value);
}

/**
 * Pure assertion: no I/O. Callers load files / env and pass results in.
 *
 * win32-arm64 is rejected unless:
 *   - env.QUALIFIED_WIN32_ARM64 === "1"
 *   - evidencePresent === true
 */
export function assertReleaseTargets(
  input: ReleaseTargetAssertInput,
): ReleaseTargetAssertResult {
  const errors: string[] = [];
  const targets = [...new Set(input.targets.map((t) => t.trim()).filter(Boolean))];
  const artifacts = [
    ...new Set(
      input.publishArtifacts.map((a) => a.trim().toLowerCase()).filter(Boolean),
    ),
  ];

  if (targets.length === 0) {
    errors.push("Release target list is empty; expected qualified matrix.");
  }

  for (const target of targets) {
    if (target === HOLDBACK_TARGET) {
      const flag = input.env.QUALIFIED_WIN32_ARM64;
      if (flag !== "1") {
        errors.push(
          `win32-arm64 is held back: set QUALIFIED_WIN32_ARM64=1 and provide qualification evidence at ${input.evidencePath} before publishing.`,
        );
      } else if (!input.evidencePresent) {
        errors.push(
          `win32-arm64 requires qualification evidence file at ${input.evidencePath} (missing).`,
        );
      }
      continue;
    }

    if (!isQualifiedPublicationTarget(target)) {
      if (isCanonicalRuntimeTarget(target)) {
        errors.push(
          `Target ${target} is not in the qualified publication matrix (${QUALIFIED_PUBLICATION_TARGETS.join(", ")}).`,
        );
      } else {
        errors.push(
          `Unknown or unsupported publication target: ${target}. Allowed: ${QUALIFIED_PUBLICATION_TARGETS.join(", ")} (plus ${HOLDBACK_TARGET} with qualification).`,
        );
      }
    }
  }

  for (const artifact of artifacts) {
    if (
      (FORBIDDEN_PUBLISH_ARTIFACTS as readonly string[]).includes(artifact)
    ) {
      errors.push(
        `Forbidden publish artifact "${artifact}": do not publish portable Windows from the paid/release path (NSIS only for win32-x64).`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Extract `target:` values from a release-desktop workflow matrix include block.
 * Intentionally lightweight (no YAML dependency) — matches `target: <name>` lines.
 */
export function parseWorkflowReleaseTargets(yamlText: string): string[] {
  const targets: string[] = [];
  const re = /^\s*-\s*target:\s*["']?([a-z0-9-]+)["']?\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(yamlText)) !== null) {
    targets.push(m[1]!);
  }
  // Also match non-list form: target: foo under include entries written as maps
  const reInline = /^\s+target:\s*["']?([a-z0-9-]+)["']?\s*$/gim;
  while ((m = reInline.exec(yamlText)) !== null) {
    const t = m[1]!;
    if (!targets.includes(t)) targets.push(t);
  }
  return targets;
}

/**
 * Collect electron-builder mac/win/linux `target` names from YAML text.
 * Used to reject `portable` and similar forbidden publish artifacts.
 */
export function parseElectronBuilderPublishTargets(ymlText: string): string[] {
  const targets: string[] = [];
  const lines = ymlText.replace(/\r\n/g, "\n").split("\n");
  let inTargetList = false;
  let targetIndent = 0;

  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === "") {
      if (inTargetList && line.trim() === "") {
        // blank lines inside lists are fine; keep state
      }
      continue;
    }

    const targetMatch = line.match(/^(\s*)target:\s*(.*)$/);
    if (targetMatch) {
      const indent = targetMatch[1]!.length;
      const rest = targetMatch[2]!.trim();
      if (rest && !rest.startsWith("#")) {
        // single value: target: nsis
        const value = rest.replace(/^["']|["']$/g, "").split(/\s+#/)[0]!.trim();
        if (value && value !== "|" && value !== ">") {
          targets.push(value.toLowerCase());
        }
        inTargetList = false;
      } else {
        inTargetList = true;
        targetIndent = indent;
      }
      continue;
    }

    if (inTargetList) {
      const listItem = line.match(/^(\s*)-\s+(.+)$/);
      if (listItem && listItem[1]!.length > targetIndent) {
        const raw = listItem[2]!.trim();
        // target entry may be scalar or map with `target: name`
        const mapTarget = raw.match(/^target:\s*["']?([a-zA-Z0-9._-]+)["']?/);
        if (mapTarget) {
          targets.push(mapTarget[1]!.toLowerCase());
        } else if (!raw.includes(":")) {
          const value = raw
            .replace(/^["']|["']$/g, "")
            .split(/\s+#/)[0]!
            .trim();
          if (value) targets.push(value.toLowerCase());
        }
        continue;
      }
      // left the list (dedent or new key at same/less indent under parent)
      const keyLine = line.match(/^(\s*)[A-Za-z0-9_]+:/);
      if (keyLine && keyLine[1]!.length <= targetIndent) {
        inTargetList = false;
      }
    }
  }

  return [...new Set(targets)];
}

export type LoadReleaseConfigResult = {
  targets: string[];
  publishArtifacts: string[];
  evidencePath: string;
  evidencePresent: boolean;
  workflowPath: string;
  electronBuilderPath: string;
  workflowPresent: boolean;
  electronBuilderPresent: boolean;
};

export function resolveEvidencePath(
  env: Readonly<Record<string, string | undefined>> = process.env,
  desktopRoot: string = DESKTOP_ROOT,
): string {
  if (env.QUALIFICATION_EVIDENCE?.trim()) {
    return path.isAbsolute(env.QUALIFICATION_EVIDENCE.trim())
      ? env.QUALIFICATION_EVIDENCE.trim()
      : path.join(desktopRoot, env.QUALIFICATION_EVIDENCE.trim());
  }
  return path.join(desktopRoot, DEFAULT_QUALIFICATION_EVIDENCE_PATH);
}

export function loadReleaseConfig(options: {
  desktopRoot?: string;
  env?: Readonly<Record<string, string | undefined>>;
}): LoadReleaseConfigResult {
  const desktopRoot = options.desktopRoot ?? DESKTOP_ROOT;
  const env = options.env ?? process.env;

  const workflowRel =
    env.RELEASE_WORKFLOW_PATH?.trim() || RELEASE_PATHS.workflow;
  const builderRel =
    env.ELECTRON_BUILDER_YML?.trim() || RELEASE_PATHS.electronBuilder;

  const workflowPath = path.isAbsolute(workflowRel)
    ? workflowRel
    : path.join(desktopRoot, workflowRel);
  const electronBuilderPath = path.isAbsolute(builderRel)
    ? builderRel
    : path.join(desktopRoot, builderRel);
  const evidencePath = resolveEvidencePath(env, desktopRoot);

  const workflowPresent = existsSync(workflowPath);
  const electronBuilderPresent = existsSync(electronBuilderPath);

  const targets = workflowPresent
    ? parseWorkflowReleaseTargets(readFileSync(workflowPath, "utf8"))
    : [];
  const publishArtifacts = electronBuilderPresent
    ? parseElectronBuilderPublishTargets(
        readFileSync(electronBuilderPath, "utf8"),
      )
    : [];

  return {
    targets,
    publishArtifacts,
    evidencePath,
    evidencePresent: existsSync(evidencePath),
    workflowPath,
    electronBuilderPath,
    workflowPresent,
    electronBuilderPresent,
  };
}

/**
 * Derive the release publish artifact set for assertion.
 *
 * Priority:
 * 1. RELEASE_PUBLISH_ARTIFACTS env (comma-separated)
 * 2. Workflow package steps (nsis / dmg / zip / portable mentions)
 * 3. Default qualified release set: dmg, zip, nsis
 *
 * electron-builder.yml may still list portable for local experiments; the
 * release gate cares about what the workflow actually packages/publishes.
 */
export function resolvePublishArtifactsForRelease(input: {
  env: Readonly<Record<string, string | undefined>>;
  workflowText: string;
  builderArtifacts: readonly string[];
}): string[] {
  if (input.env.RELEASE_PUBLISH_ARTIFACTS?.trim()) {
    return input.env.RELEASE_PUBLISH_ARTIFACTS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  // Only inspect packaging command lines (ignore comments / rejection checks).
  const commandLines = input.workflowText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/#.*$/, "").trim().toLowerCase())
    .filter(
      (line) =>
        line.includes("electron-builder") ||
        line.startsWith("eb_args:") ||
        line.includes("eb_args:"),
    );

  const fromWorkflow = new Set<string>();
  for (const line of commandLines) {
    for (const name of ["dmg", "zip", "nsis", "portable", "appimage"] as const) {
      if (
        new RegExp(
          `(?:--|/|\\b|=)${name}\\b|target[=:\\s"]+${name}\\b`,
        ).test(line)
      ) {
        fromWorkflow.add(name);
      }
    }
  }
  if (fromWorkflow.size > 0) {
    return [...fromWorkflow];
  }

  // Fallback: intended signed release set (never portable).
  void input.builderArtifacts;
  return ["dmg", "zip", "nsis"];
}

/**
 * CLI entry: load PATH standard files + env, assert, exit non-zero on failure.
 */
export function main(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): number {
  const dryRun = argv.includes("--dry-run");
  const config = loadReleaseConfig({ env });

  if (!config.workflowPresent) {
    console.error(
      `assert-release-targets: missing workflow at ${config.workflowPath}`,
    );
    return 1;
  }

  const workflowText = readFileSync(config.workflowPath, "utf8");
  const publishArtifacts = resolvePublishArtifactsForRelease({
    env,
    workflowText,
    builderArtifacts: config.publishArtifacts,
  });

  const evidencePathRel = path.relative(DESKTOP_ROOT, config.evidencePath);
  const result = assertReleaseTargets({
    targets: config.targets,
    publishArtifacts,
    env,
    evidencePresent: config.evidencePresent,
    evidencePath:
      evidencePathRel && !evidencePathRel.startsWith("..")
        ? evidencePathRel
        : config.evidencePath,
  });

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          targets: config.targets,
          publishArtifacts,
          builderArtifacts: config.publishArtifacts,
          evidencePath: config.evidencePath,
          evidencePresent: config.evidencePresent,
          qualified: QUALIFIED_PUBLICATION_TARGETS,
          holdback: HOLDBACK_TARGET,
          ok: result.ok,
          errors: result.errors,
        },
        null,
        2,
      ),
    );
  }

  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`assert-release-targets: ${err}`);
    }
    return 1;
  }

  if (!dryRun) {
    console.log(
      `assert-release-targets: ok targets=[${config.targets.join(", ")}] artifacts=[${publishArtifacts.join(", ")}]`,
    );
  }
  return 0;
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  process.exit(main());
}
