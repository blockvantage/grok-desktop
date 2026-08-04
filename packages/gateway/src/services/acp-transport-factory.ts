/**
 * Live `grok agent stdio` transport factory (composition root only).
 * Returns null unless the CLI is discovered AND probe confirms agent stdio,
 * so callers can fall back to headless without try/catch.
 *
 * T1/T3: when probe.supportsSandbox, spawn argv includes `--sandbox <profile>`
 * via the same policy compiler as headless (`buildAcpSpawnArgs`). The same
 * probe flags are returned so AgentProviderEngine protection cannot diverge.
 */
import type { SessionInput } from "@grokdesk/agent-runtime";
import {
  buildAcpSpawnArgs,
  policySnapshotFromEffective,
  projectAcpProtection,
} from "@grokdesk/shared";
import {
  spawnAcpLineTransport,
  type AcpLineTransport,
} from "@grokdesk/provider-grok";
import {
  findGrokBinary,
  probeGrokCli,
  envWithGrokPath,
} from "../engine-composition.js";

export type AcpTransportFactory = (
  input: SessionInput,
) => AcpLineTransport | Promise<AcpLineTransport>;

export type AcpProbeResult = {
  supportsAgentStdio: boolean;
  supportsSandbox?: boolean;
  supportsNoAutoUpdate?: boolean;
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
    isolateGrokHome: input.inheritUserConfig !== true,
    executesOwnTools: true,
  });
}

export async function createLiveAcpTransportFactory(deps?: {
  findBinary?: () => Promise<string | null>;
  probe?: (binary: string) => Promise<AcpProbeResult>;
  spawn?: typeof spawnAcpLineTransport;
}): Promise<LiveAcpFactoryResult | null> {
  const findBinary = deps?.findBinary ?? (() => findGrokBinary());
  const probe = deps?.probe ?? ((b: string) => probeGrokCli(b));
  const spawn = deps?.spawn ?? spawnAcpLineTransport;

  const binary = await findBinary();
  if (!binary) return null;
  let probeResult: AcpProbeResult;
  try {
    probeResult = await probe(binary);
    if (!probeResult.supportsAgentStdio) return null;
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
    return spawn({
      binary,
      args,
      cwd: input.cwd,
      env: envWithGrokPath(process.env),
      allowSpawn: true,
    });
  };
  return {
    factory,
    supportsSandbox,
    supportsNoAutoUpdate,
  };
}
