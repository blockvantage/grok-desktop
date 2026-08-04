import fs from "node:fs";
import path from "node:path";

export type ReadmeDemoProfile = {
  root: string;
  userDataDir: string;
  gatewayDataDir: string;
  workspaceDir: string;
  rawDir: string;
  logsDir: string;
  releaseAssetsDir: string;
  env: NodeJS.ProcessEnv;
};

const FORBIDDEN_PROFILE_ENV = [
  "GROKDESK_USE_REAL_PROFILE",
  "GROKDESK_USER_DATA",
  "ELECTRON_USER_DATA",
] as const;

export function assertReadmeCaptureIsIsolated(
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const key of FORBIDDEN_PROFILE_ENV) {
    if (env[key]) {
      throw new Error(
        `README capture refused ${key}=…; use samples/readme-demo only`,
      );
    }
  }
}

function assertSafeDemoRoot(repoRoot: string, demoRoot: string): void {
  const expected = path.join(path.resolve(repoRoot), "samples", "readme-demo");
  if (path.resolve(demoRoot) !== expected || path.basename(demoRoot) !== "readme-demo") {
    throw new Error(`Unsafe README demo root: ${demoRoot}`);
  }
}

/** Recreate the one explicit ignored demo profile used for README captures. */
export function createReadmeDemoProfile(opts?: {
  repoRoot?: string;
  env?: NodeJS.ProcessEnv;
}): ReadmeDemoProfile {
  const repoRoot = path.resolve(opts?.repoRoot ?? path.join(process.cwd(), "../.."));
  const sourceEnv = opts?.env ?? process.env;
  assertReadmeCaptureIsIsolated(sourceEnv);

  const root = path.join(repoRoot, "samples", "readme-demo");
  assertSafeDemoRoot(repoRoot, root);
  fs.rmSync(root, { recursive: true, force: true });

  const userDataDir = path.join(root, "user-data");
  const gatewayDataDir = path.join(root, "gateway-data");
  const workspaceDir = path.join(root, "workspace");
  const rawDir = path.join(root, "raw");
  const logsDir = path.join(root, "logs");
  const releaseAssetsDir = path.join(root, "release-assets");
  for (const directory of [
    userDataDir,
    gatewayDataDir,
    workspaceDir,
    rawDir,
    logsDir,
    releaseAssetsDir,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }

  // Synthetic, isolated E2E identity: keeps readiness/account surfaces honest
  // without reading or copying any real SuperGrok profile or credential.
  const grokDir = path.join(root, ".grok");
  fs.mkdirSync(grokDir, { recursive: true });
  fs.writeFileSync(
    path.join(grokDir, "auth.json"),
    JSON.stringify({
      "https://auth.x.ai::client": {
        email: "demo@grokdesk.local",
        first_name: "Demo",
        last_name: "Workspace",
        refresh_token: "readme-e2e-placeholder",
        expires_at: "2099-01-01T00:00:00.000Z",
      },
    }),
  );

  return {
    root,
    userDataDir,
    gatewayDataDir,
    workspaceDir,
    rawDir,
    logsDir,
    releaseAssetsDir,
    env: {
      ...sourceEnv,
      GROKDESK_E2E: "1",
      GROKDESK_PROVIDER_ENGINE: "1",
      GROKDESK_PROVIDER_ID: "fake",
      GROKDESK_SKIP_BROWSER_LOGIN: "1",
      GROKDESK_DATA_DIR: gatewayDataDir,
      GROKDESK_NODE_PATH: process.execPath,
      ELECTRON_USER_DATA: userDataDir,
      HOME: root,
      USERPROFILE: root,
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
    },
  };
}
