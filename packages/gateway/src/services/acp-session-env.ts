/**
 * Provision the ACP spawn environment to match headless GrokBuildEngine:
 * managed-binary PATH, isolated GROK_HOME (unless inherit), Desk MCP + skills.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  allowProjectToolSetup,
  isolateGrokHomeFromSpawnEnv,
  toAcpMcpServers,
  type AcpMcpServerParam,
  type DeskMcpServerLike,
} from "@grokdesk/shared";
import {
  installSkillsIntoGrokHome,
  installSkillsIntoProject,
  writeEphemeralMcpConfig,
  writeProjectMcpConfig,
} from "@grokdesk/shared/node";
import {
  envWithManagedBinary,
  seedIsolatedGrokHome,
  withDeskBrowserTaskId,
  type McpServerConfig,
} from "../engine-composition.js";

export type AcpDeskMcpServer = McpServerConfig;

export type ProvisionAcpGrokHomeInput = {
  inheritUserConfig?: boolean;
  /** Reuse a caller-owned home instead of mkdtemp. */
  isolatedProfileDir?: string;
  mcpServers?: readonly DeskMcpServerLike[];
  skillsPaths?: readonly string[];
  cwd: string;
  browserSessionId?: string;
  processEnv?: NodeJS.ProcessEnv;
  userHome?: string;
  trustedFolders?: readonly string[];
  /** Managed binary — only its directory is prepended to PATH. */
  binary?: string | null;
};

export type ProvisionAcpGrokHomeResult = {
  env: NodeJS.ProcessEnv;
  grokHome: string | null;
  isolateGrokHome: boolean;
  createdHome: boolean;
  mcpServersForSession: AcpMcpServerParam[];
  skillsInstalled: string[];
};

export function provisionAcpGrokHome(
  input: ProvisionAcpGrokHomeInput,
): ProvisionAcpGrokHomeResult {
  const processEnv = input.processEnv ?? process.env;
  const isolate = input.inheritUserConfig !== true;
  const userHome = input.userHome ?? os.homedir();
  const mcpServers: McpServerConfig[] = (input.mcpServers ?? [])
    .filter((s) => s && s.id && s.command)
    .map((s) => ({
      id: s.id,
      command: s.command,
      args: s.args ?? [],
      env: s.env,
      enabled: s.enabled !== false,
    }));
  const skillsPaths = [...(input.skillsPaths ?? [])];
  const serversForTask = withDeskBrowserTaskId(
    mcpServers,
    input.browserSessionId ?? "desk",
  );

  const env: NodeJS.ProcessEnv = input.binary
    ? envWithManagedBinary(input.binary, processEnv)
    : { ...processEnv };

  let grokHome: string | null = null;
  let createdHome = false;
  const skillsInstalled: string[] = [];

  if (isolate) {
    if (input.isolatedProfileDir?.trim()) {
      grokHome = input.isolatedProfileDir.trim();
      fs.mkdirSync(grokHome, { recursive: true, mode: 0o700 });
    } else {
      grokHome = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-grok-home-"));
      createdHome = true;
    }
    try {
      seedIsolatedGrokHome(grokHome, userHome);
    } catch {
      /* auth copy best-effort */
    }
    env.GROK_HOME = grokHome;

    const projectToolsOk = allowProjectToolSetup({
      workspacePath: input.cwd,
      trustedFolders: input.trustedFolders ? [...input.trustedFolders] : [],
    });
    try {
      writeProjectMcpConfig(
        input.cwd,
        serversForTask.map((server) => ({ ...server, enabled: false })),
        processEnv,
      );
      writeEphemeralMcpConfig(serversForTask, processEnv, grokHome);
    } catch {
      /* MCP write is best-effort on ACP; session/new still carries servers */
    }
    if (skillsPaths.length > 0) {
      try {
        skillsInstalled.push(
          ...installSkillsIntoGrokHome(grokHome, skillsPaths),
        );
      } catch {
        /* skills best-effort */
      }
    }
    if (skillsPaths.length > 0 && projectToolsOk) {
      try {
        installSkillsIntoProject(input.cwd, skillsPaths);
      } catch {
        /* project skills optional */
      }
    }
  } else {
    const projectToolsOk = allowProjectToolSetup({
      workspacePath: input.cwd,
      trustedFolders: input.trustedFolders ? [...input.trustedFolders] : [],
    });
    if (projectToolsOk) {
      try {
        writeProjectMcpConfig(input.cwd, serversForTask, processEnv);
      } catch {
        /* inherit-mode project MCP optional */
      }
      if (skillsPaths.length > 0) {
        try {
          installSkillsIntoProject(input.cwd, skillsPaths);
        } catch {
          /* optional */
        }
      }
    }
  }

  const isolateGrokHome = isolateGrokHomeFromSpawnEnv(env);
  return {
    env,
    grokHome,
    isolateGrokHome,
    createdHome,
    mcpServersForSession: toAcpMcpServers(serversForTask),
    skillsInstalled,
  };
}

export function cleanupProvisionedGrokHome(
  result: Pick<ProvisionAcpGrokHomeResult, "createdHome" | "grokHome">,
): void {
  if (!result.createdHome || !result.grokHome) return;
  try {
    fs.rmSync(result.grokHome, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
