/**
 * Pure helpers to scan MCP env for literal secrets and rewrite them to vault refs.
 * No I/O — callers supply put/get/delete against a CredentialVault.
 */
import {
  isVaultRef,
  looksLikeSecretEnvKey,
  makeVaultRef,
} from "./secret-redact.js";

export type McpServerEnvRow = {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
};

export type LiteralSecretHit = {
  serverId: string;
  envKey: string;
  /** Classification only — never the secret value. */
  kind: "secret_env_key" | "literal_pattern";
};

export type VaultMigrateReport = {
  /** Hits that were (or would be) rewritten to vault refs. */
  migrated: LiteralSecretHit[];
  /** Entries already vault refs or placeholders. */
  alreadySafe: LiteralSecretHit[];
  dryRun: boolean;
  /** True when at least one literal remains after the operation. */
  hasRemainingLiterals: boolean;
};

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}/,
  /\bxai-[A-Za-z0-9_-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._\-+=/]+/i,
  /\bGD1\.[A-Za-z0-9._-]{8,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

/** True when value looks like a live secret (not vault ref / ${ENV} placeholder). */
export function isLiteralSecretValue(value: string): boolean {
  if (!value || value.length < 8) return false;
  if (isVaultRef(value)) return false;
  if (value.startsWith("${") && value.endsWith("}")) return false;
  if (/^[A-Za-z0-9_\-./+=]{24,}$/.test(value)) return true;
  return SECRET_VALUE_PATTERNS.some((re) => re.test(value));
}

/**
 * Classify whether an env entry should be vaulted.
 * Secret-named keys with any non-empty non-placeholder value count as literals.
 */
export function classifyEnvSecretValue(
  envKey: string,
  value: string,
): LiteralSecretHit["kind"] | null {
  if (!value) return null;
  if (isVaultRef(value)) return null;
  if (value.startsWith("${") && value.endsWith("}")) return null;
  if (looksLikeSecretEnvKey(envKey)) return "secret_env_key";
  if (isLiteralSecretValue(value)) return "literal_pattern";
  return null;
}

/** Scan MCP servers for literal secrets (keys only — never values in the report). */
export function scanMcpLiteralSecrets(
  servers: ReadonlyArray<Pick<McpServerEnvRow, "id" | "env">>,
): LiteralSecretHit[] {
  const hits: LiteralSecretHit[] = [];
  for (const s of servers) {
    if (!s.env) continue;
    for (const [k, v] of Object.entries(s.env)) {
      const kind = classifyEnvSecretValue(k, v);
      if (kind) hits.push({ serverId: s.id, envKey: k, kind });
    }
  }
  return hits;
}

/**
 * Rewrite literal secrets to vault refs via `put`.
 * When `dryRun` is true, no put calls and servers are unchanged.
 */
export function migrateMcpLiteralSecretsToVaultRefs(
  servers: McpServerEnvRow[],
  put: (secret: string, meta: { label: string }) => string,
  opts?: { dryRun?: boolean },
): { servers: McpServerEnvRow[]; report: VaultMigrateReport } {
  const dryRun = opts?.dryRun === true;
  const migrated: LiteralSecretHit[] = [];
  const alreadySafe: LiteralSecretHit[] = [];

  const next = servers.map((s) => {
    if (!s.env) return { ...s };
    const env: Record<string, string> = { ...s.env };
    for (const [k, v] of Object.entries(s.env)) {
      if (isVaultRef(v)) {
        alreadySafe.push({
          serverId: s.id,
          envKey: k,
          kind: "secret_env_key",
        });
        continue;
      }
      if (v.startsWith("${") && v.endsWith("}")) {
        alreadySafe.push({
          serverId: s.id,
          envKey: k,
          kind: "secret_env_key",
        });
        continue;
      }
      const kind = classifyEnvSecretValue(k, v);
      if (!kind) continue;
      const hit: LiteralSecretHit = { serverId: s.id, envKey: k, kind };
      migrated.push(hit);
      if (!dryRun) {
        env[k] = put(v, { label: `mcp:${s.id}:${k}` });
      }
    }
    return { ...s, env };
  });

  const remaining = dryRun
    ? migrated
    : scanMcpLiteralSecrets(next);

  return {
    servers: dryRun ? servers.map((s) => ({ ...s, env: s.env ? { ...s.env } : undefined })) : next,
    report: {
      migrated,
      alreadySafe,
      dryRun,
      hasRemainingLiterals: remaining.length > 0,
    },
  };
}

/**
 * Resolve vault refs in MCP env for engine/ephemeral use only.
 * Unresolvable refs are left as-is (caller may fail closed).
 */
export function resolveMcpVaultRefs(
  servers: McpServerEnvRow[],
  get: (ref: string) => string | null,
): McpServerEnvRow[] {
  return servers.map((s) => {
    if (!s.env) return { ...s };
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.env)) {
      if (isVaultRef(v)) {
        env[k] = get(v) ?? v;
      } else {
        env[k] = v;
      }
    }
    return { ...s, env };
  });
}

/** Re-export for callers that need to construct refs without importing secret-redact. */
export { makeVaultRef, isVaultRef };
