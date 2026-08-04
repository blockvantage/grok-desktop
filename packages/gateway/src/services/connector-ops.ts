/**
 * Connector enable/disable/doctor IPC orchestration (Phase 6 extract).
 * Engine rebuild is injected; secrets never appear in doctor reports.
 */

import { buildSettingsMutateResponse } from "./settings-response.js";

export type ConnectorSettingsLike = Record<string, unknown> & {
  mcpServers?: Array<{
    id: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    enabled: boolean;
  }>;
};

export interface ConnectorOpsDeps {
  getAll(): ConnectorSettingsLike;
  enablePreset(
    presetId: string,
    env?: Record<string, string>,
  ): ConnectorSettingsLike;
  disablePreset(presetId: string): ConnectorSettingsLike;
  enableRecommended(): ConnectorSettingsLike;
  getEffectiveSkillsPaths(): string[];
  applyEngineSettings(
    prev: ConnectorSettingsLike,
    next: ConnectorSettingsLike,
  ): Promise<boolean>;
  doctorMcpServers(
    servers: NonNullable<ConnectorSettingsLike["mcpServers"]>,
  ): unknown[];
}

export async function enableConnector(
  input: { presetId: string; env?: Record<string, string> },
  deps: ConnectorOpsDeps,
): Promise<Record<string, unknown>> {
  const prev = deps.getAll();
  const next = deps.enablePreset(input.presetId, input.env);
  const reloaded = await deps.applyEngineSettings(prev, next);
  return buildSettingsMutateResponse({
    settings: next,
    effectiveSkillsPaths: deps.getEffectiveSkillsPaths(),
    engineReloaded: reloaded,
  });
}

export async function disableConnector(
  presetId: string,
  deps: ConnectorOpsDeps,
): Promise<Record<string, unknown>> {
  const prev = deps.getAll();
  const next = deps.disablePreset(presetId);
  const reloaded = await deps.applyEngineSettings(prev, next);
  return buildSettingsMutateResponse({
    settings: next,
    effectiveSkillsPaths: deps.getEffectiveSkillsPaths(),
    engineReloaded: reloaded,
  });
}

export async function enableRecommendedConnectors(
  deps: ConnectorOpsDeps,
): Promise<Record<string, unknown>> {
  const prev = deps.getAll();
  const next = deps.enableRecommended();
  const reloaded = await deps.applyEngineSettings(prev, next);
  return buildSettingsMutateResponse({
    settings: next,
    effectiveSkillsPaths: deps.getEffectiveSkillsPaths(),
    engineReloaded: reloaded,
  });
}

/**
 * Static MCP preflight — never returns secret env values (CMD-03).
 */
export function doctorConnectors(
  deps: Pick<ConnectorOpsDeps, "getAll" | "doctorMcpServers">,
  serverId?: string,
): { reports: unknown[] } {
  const all = deps.getAll().mcpServers ?? [];
  const filtered =
    typeof serverId === "string" ? all.filter((s) => s.id === serverId) : all;
  return { reports: deps.doctorMcpServers(filtered) };
}
