/**
 * Safe MCP connector preflight (CMD-03) — never returns secret values.
 */
import { looksLikeSecretEnvKey, isVaultRef } from "./secret-redact.js";

export interface McpServerProbeInput {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export type McpDoctorSeverity = "ok" | "warn" | "error";

export interface McpDoctorFinding {
  code: string;
  severity: McpDoctorSeverity;
  message: string;
  /** Redacted env key names only — never values. */
  envKeys?: string[];
}

export interface McpDoctorReport {
  serverId: string;
  ok: boolean;
  findings: McpDoctorFinding[];
  /** Sanitized command line (no env values). */
  commandSummary: string;
}

/**
 * Static preflight: shape, enablement, secret-looking env keys present as
 * placeholders vs literals. Does not spawn processes or return secrets.
 */
export function doctorMcpServer(server: McpServerProbeInput): McpDoctorReport {
  const findings: McpDoctorFinding[] = [];

  if (!server.id?.trim()) {
    findings.push({
      code: "missing_id",
      severity: "error",
      message: "Server id is required",
    });
  }
  if (!server.command?.trim()) {
    findings.push({
      code: "missing_command",
      severity: "error",
      message: "Command is required",
    });
  }
  if (!server.enabled) {
    findings.push({
      code: "disabled",
      severity: "warn",
      message: "Server is disabled",
    });
  }

  const envKeys = Object.keys(server.env ?? {});
  const secretKeys = envKeys.filter(looksLikeSecretEnvKey);
  const literalSecrets = secretKeys.filter((k) => {
    const v = server.env?.[k] ?? "";
    if (!v) return false;
    if (isVaultRef(v)) return false;
    if (v.startsWith("${") && v.endsWith("}")) return false;
    return true;
  });

  if (secretKeys.length > 0) {
    findings.push({
      code: "secret_env_keys",
      severity: "ok",
      message: "Secret-like env keys present (values not shown)",
      envKeys: secretKeys,
    });
  }
  if (literalSecrets.length > 0) {
    findings.push({
      code: "literal_secret_values",
      severity: "warn",
      message:
        "Secret-like env keys appear to hold literals — prefer vault refs or ${ENV} placeholders",
      envKeys: literalSecrets,
    });
  }

  const commandSummary = [server.command, ...(server.args ?? [])]
    .map((p) => (p.includes(" ") ? JSON.stringify(p) : p))
    .join(" ");

  const ok = !findings.some((f) => f.severity === "error");
  return {
    serverId: server.id || "(missing)",
    ok,
    findings,
    commandSummary,
  };
}

/** Batch doctor — redacts by construction (no secret values in report). */
export function doctorMcpServers(
  servers: McpServerProbeInput[],
): McpDoctorReport[] {
  return servers.map(doctorMcpServer);
}
