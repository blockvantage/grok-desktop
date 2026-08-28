/**
 * Live `grok agent stdio` transport factory (composition root only).
 * Returns null unless the CLI is discovered AND probe confirms agent stdio,
 * so callers can fall back to headless without try/catch.
 *
 * T1/T3: when probe.supportsSandbox, spawn argv includes `--sandbox <profile>`
 * via the same policy compiler as headless (`buildAcpSpawnArgs`). The same
 * probe flags are returned so AgentProviderEngine protection cannot diverge.
 *
 * Spawn env matches headless: managed binary PATH + isolated GROK_HOME
 * (unless inheritUserConfig), Desk MCP written into that home, skills installed.
 */
import type { SessionInput } from "@grokdesk/agent-runtime";
import {
  buildAcpSpawnArgs,
  isolateGrokHomeFromSpawnEnv,
  policySnapshotFromEffective,
  projectAcpProtection,
  type DeskMcpServerLike,
} from "@grokdesk/shared";
import {
  spawnAcpLineTransport,
  type AcpLineTransport,
} from "@grokdesk/provider-grok";
import {
  cliVersionAtLeast,
  probeGrokCli,
  resolveManagedGrokBinary,
} from "../engine-composition.js";
import {
  cleanupProvisionedGrokHome,
  provisionAcpGrokHome,
} from "./acp-session-env.js";

export type AcpTransportFactory = (
  input: SessionInput,
) => AcpLineTransport | Promise<AcpLineTransport>;

export type AcpProbeResult = {
  supportsAgentStdio: boolean;
  supportsSandbox?: boolean;
  supportsNoAutoUpdate?: boolean;
  version?: string | null;
};

/** Result of a successful live ACP factory build (factory + probe honesty). */
export type LiveAcpFactoryResult = {
  factory: AcpTransportFactory;
  /** CLI probe: sandbox flag documented/supported. Fail closed when false. */
  supportsSandbox: boolean;
  supportsNoAutoUpdate: boolean;
};

/**
 * Build spawn argv for ACP from session input + probe (pure helper for tests).
 */
export function acpSpawnArgsForSession(
  input: SessionInput,
  probe: { supportsSandbox?: boolean; supportsNoAutoUpdate?: boolean },
): string[] {
  const policy = policySnapshotFromEffective({
    approvalMode: input.policy.approvalMode,
    workspaceRoots: input.workspaceRoots?.length
      ? input.workspaceRoots
      : [input.cwd],
    capabilities: input.policy.capabilities,
  });
  return buildAcpSpawnArgs({
    cwd: input.cwd,
    policy,
    supportsSandbox: probe.supportsSandbox === true,
    noAutoUpdate: probe.supportsNoAutoUpdate === true,
    isolateGrokHome: input.inheritUserConfig !== true,
  });
}

/** Protection snapshot matching the ACP spawn for this session (T3). */
export function acpProtectionForSession(
  input: SessionInput,
  probe: { supportsSandbox?: boolean; supportsNoAutoUpdate?: boolean },
  spawnEnv?: Record<string, string | undefined>,
) {
  const policy = policySnapshotFromEffective({
    approvalMode: input.policy.approvalMode,
    workspaceRoots: input.workspaceRoots?.length
      ? input.workspaceRoots
      : [input.cwd],
    capabilities: input.policy.capabilities,
  });
  return projectAcpProtection({
    cwd: input.cwd,
    policy,
    supportsSandbox: probe.supportsSandbox === true,
    noAutoUpdate: probe.supportsNoAutoUpdate === true,
    isolateGrokHome: spawnEnv
      ? isolateGrokHomeFromSpawnEnv(spawnEnv)
      : input.inheritUserConfig !== true,
    executesOwnTools: true,
    spawnEnv,
  });
}

export type LiveAcpFactoryDeps = {
  findBinary?: () => Promise<string | null>;
  probe?: (binary: string) => Promise<AcpProbeResult>;
  spawn?: typeof spawnAcpLineTransport;
  processEnv?: NodeJS.ProcessEnv;
  mcpServers?: readonly DeskMcpServerLike[];
  skillsPaths?: readonly string[];
  mcpServersProvider?: () => readonly DeskMcpServerLike[];
  skillsPathsProvider?: () => readonly string[];
  userHome?: string;
  /** Overlay Desk remembered grants into isolated GROK_HOME before spawn. */
  copyPermissionGrants?: (grokHome: string, cwd: string) => void;
};

export async function createLiveAcpTransportFactory(
  deps?: LiveAcpFactoryDeps,
): Promise<LiveAcpFactoryResult | null> {
  const processEnv = deps?.processEnv ?? process.env;
  const findBinary =
    deps?.findBinary ??
    (() => resolveManagedGrokBinary({ env: processEnv }));
  const probe = deps?.probe ?? ((b: string) => probeGrokCli(b));
  const spawn = deps?.spawn ?? spawnAcpLineTransport;

  const binary = await findBinary();
  if (!binary) return null;
  let probeResult: AcpProbeResult;
  try {
    probeResult = await probe(binary);
    if (!probeResult.supportsAgentStdio) return null;
    if (
      probeResult.version &&
      !cliVersionAtLeast(probeResult.version)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  const supportsSandbox = probeResult.supportsSandbox === true;
  const supportsNoAutoUpdate = probeResult.supportsNoAutoUpdate === true;
  const factory: AcpTransportFactory = (input) => {
    const args = acpSpawnArgsForSession(input, {
      supportsSandbox,
      supportsNoAutoUpdate,
    });
    const mcpServers =
      input.mcpServers ??
      deps?.mcpServersProvider?.() ??
      deps?.mcpServers ??
      [];
    const skillsPaths =
      input.skillsPaths ??
      deps?.skillsPathsProvider?.() ??
      deps?.skillsPaths ??
      [];
    const provisioned = provisionAcpGrokHome({
      inheritUserConfig: input.inheritUserConfig,
      isolatedProfileDir: input.isolatedProfileDir,
      mcpServers,
      skillsPaths,
      cwd: input.cwd,
      browserSessionId: input.browserSessionId,
      processEnv,
      userHome: deps?.userHome,
      trustedFolders: input.trustedFolders,
      binary,
    });
    if (provisioned.grokHome && deps?.copyPermissionGrants) {
      try {
        deps.copyPermissionGrants(provisioned.grokHome, input.cwd);
      } catch {
        /* grants overlay is best-effort; spawn still proceeds */
      }
    }
    const transport = spawn({
      binary,
      args,
      cwd: input.cwd,
      env: provisioned.env,
      allowSpawn: true,
    });
    transport.spawnMeta = {
      grokHome: provisioned.grokHome,
      isolateGrokHome: provisioned.isolateGrokHome,
      env: provisioned.env,
    };
    if (provisioned.createdHome) {
      const origClose = transport.close.bind(transport);
      transport.close = async () => {
        try {
          await origClose();
        } finally {
          cleanupProvisionedGrokHome(provisioned);
        }
      };
    }
    return transport;
  };
  return {
    factory,
    supportsSandbox,
    supportsNoAutoUpdate,
  };
}
