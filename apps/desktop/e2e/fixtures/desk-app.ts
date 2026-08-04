/**
 * Launch helpers for isolated Electron desk tests (Task 18).
 */
import fs from "node:fs";
import path from "node:path";
import {
  assertNoRealProfileEnv,
  createTempTestProfile,
  FAKE_PROVIDER_ENV,
} from "./test-profile";

export type DeskLaunchEnv = Record<string, string>;

export function buildDeskLaunchEnv(extra: DeskLaunchEnv = {}): {
  env: DeskLaunchEnv;
  profile: ReturnType<typeof createTempTestProfile>;
} {
  assertNoRealProfileEnv();
  const profile = createTempTestProfile();
  return {
    profile,
    env: {
      ...FAKE_PROVIDER_ENV,
      GROKDESK_DATA_DIR: profile.gatewayDataDir,
      // Electron userData is set by the Playwright electron launcher when available.
      ELECTRON_USER_DATA: profile.userDataDir,
      ...extra,
    },
  };
}

/**
 * Resolve packaged/built main entry. Returns null when the app has not been built.
 */
export function resolveBuiltMainEntry(
  desktopRoot = process.cwd(),
): string | null {
  const candidates = [
    path.join(desktopRoot, "out/main/index.js"),
    path.join(desktopRoot, "dist/main/index.js"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * CI reliability path must build first and may not soft-skip.
 * Local smoke may skip when missing build if allowSkipMissingBuild is true.
 */
export function requireBuiltMainOrSkip(opts: {
  allowSkipMissingBuild: boolean;
  desktopRoot?: string;
}): { main: string } | { skip: true; reason: string } {
  const main = resolveBuiltMainEntry(opts.desktopRoot);
  if (main) return { main };
  if (opts.allowSkipMissingBuild) {
    return {
      skip: true,
      reason: "desktop out/main missing — run pnpm --filter @grokdesk/desktop build",
    };
  }
  throw new Error(
    "CI e2e:desktop requires a prior build (out/main/index.js missing)",
  );
}
