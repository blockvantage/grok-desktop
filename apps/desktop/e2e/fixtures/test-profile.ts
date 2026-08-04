/**
 * Isolated Electron test profile helpers.
 * Deterministic specs MUST use fresh temp dirs and never a real user profile.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function createTempTestProfile(prefix = "grokdesk-e2e-"): {
  userDataDir: string;
  gatewayDataDir: string;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const userDataDir = path.join(root, "userData");
  const gatewayDataDir = path.join(root, "gateway");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(gatewayDataDir, { recursive: true });
  return {
    userDataDir,
    gatewayDataDir,
    cleanup: () => {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

/** Reject accidental use of developer profiles in deterministic specs. */
export function assertNoRealProfileEnv(env: NodeJS.ProcessEnv = process.env): void {
  const forbidden = [
    "GROKDESK_USE_REAL_PROFILE",
    "GROKDESK_USER_DATA",
    "ELECTRON_USER_DATA",
  ];
  for (const key of forbidden) {
    if (env[key]) {
      throw new Error(
        `Deterministic E2E refused env ${key}=… — use createTempTestProfile()`,
      );
    }
  }
}

export const FAKE_PROVIDER_ENV = {
  GROKDESK_PROVIDER_ENGINE: "1",
  GROKDESK_PROVIDER_ID: "fake",
  GROKDESK_E2E: "1",
} as const;
