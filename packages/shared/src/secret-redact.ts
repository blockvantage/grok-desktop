/**
 * Redact secrets from settings / MCP config / diagnostics structures.
 * Pure helpers used by gateway settings.get and secret-canary tests.
 *
 * Commerce / entitlement material (GD1–GD3 keys, lease JWTs, private keys,
 * activation proofs, portal/magic/grant tokens) is redacted by structure and
 * by known field names so logs, IPC errors, and diagnostics never retain it.
 */

const SECRET_ENV_KEY =
  /^(.*_)?(API[_-]?KEY|ACCESS[_-]?TOKEN|SECRET|PASSWORD|PASSWD|TOKEN|AUTH|CREDENTIAL|PRIVATE[_-]?KEY)$/i;

/** Provider / general secret value patterns. */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{10,}/g,
  /\bxai-[A-Za-z0-9_-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi,
  /\bGD1\.[A-Za-z0-9._-]{8,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/**
 * Commerce secret value patterns (product keys, leases, crypto material, tokens).
 * Applied after general patterns. Order matters only for overlapping matches.
 */
const COMMERCE_SECRET_PATTERNS: RegExp[] = [
  // Product keys GD1 / GD2 / GD3 (claims + signature body)
  /\bGD[123]\.[A-Za-z0-9._-]{8,}/g,
  // Compact JWT / JWS (device lease tokens start with base64url header `eyJ`)
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // PEM private key blocks (any label)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Ed25519 PKCS#8 SPKI private DER base64 (Node export common prefix)
  /\bMC4CAQAwBQYDK2VwBCIE[A-Za-z0-9+/=]{16,}\b/g,
  // Private JWK `d` parameter
  /"d"\s*:\s*"[A-Za-z0-9_-]{16,}"/g,
  // JSON fields that must never appear with literal values
  /"(?:productKey|privateKey|privatePkcs8Base64|private_key|devicePrivateKey|signature|activationSignature|refreshSignature|sig|nonce|grant|grantToken|magicToken|magic|portalToken|portalSession|sessionToken|authorization|entitlementSecret|lease|product_key|pairSecret|pair_secret|deskToken|deviceToken)"\s*:\s*"[^"]*"/gi,
  // Assignment forms in free-form logs / errors
  /\b(?:productKey|privateKey|privatePkcs8Base64|private_key|devicePrivateKey|signature|activationSignature|refreshSignature|sig|nonce|grant|grantToken|magicToken|magic|portalToken|portalSession|sessionToken|authorization|lease|product_key|pairSecret|pair_secret|deskToken|deviceToken)\s*[=:]\s*["']?[^\s"',;}]{6,}/gi,
  // URL query tokens that may carry grants / magic links
  /([?&](?:grant|token|magic|session|sig)=)[^&\s"']+/gi,
];

/** Field names that must never carry literal secret values on wire/logs. */
export const COMMERCE_SECRET_FIELD_NAMES = [
  "productKey",
  "privateKey",
  "privatePkcs8Base64",
  "private_key",
  "devicePrivateKey",
  "signature",
  "activationSignature",
  "refreshSignature",
  "sig",
  "nonce",
  "grant",
  "grantToken",
  "magicToken",
  "magic",
  "portalToken",
  "portalSession",
  "sessionToken",
  "authorization",
  "entitlementSecret",
  "lease",
  "product_key",
  "pairSecret",
  "pair_secret",
  "deskToken",
  "deviceToken",
] as const;

/**
 * Stable canary fixtures for secret-canary suites.
 * These strings must never appear in IPC errors, gateway stdio frames, logs,
 * diagnostics, SQLite/WAL dumps, state/journal/temp files, or remote errors.
 */
export const COMMERCE_CANARY_FIXTURES = {
  gd1: "GD1.canary-body.CANARY_SIG_GD1_NEVER_LEAK",
  gd2: "GD2.canary-body.CANARY_SIG_GD2_NEVER_LEAK",
  gd3: "GD3.canary-claims.CANARY_SIG_GD3_NEVER_LEAK_xx",
  leaseJwt:
    "eyJhbGciOiJFZERTQSIsInR5cCI6Imdyb2tkZXNrLWxlYXNlK2p3dCJ9.eyJqdGkiOiJjYW5hcnktbGVhc2Utand0In0.CANARY_LEASE_SIG_NEVER_LEAK_ABCDEF",
  privatePkcs8Base64:
    "MC4CAQAwBQYDK2VwBCIEICanaryPrivateKeyPkcs8MaterialXXXX=",
  privateJwkD: "canary-private-jwk-d-parameter-xx",
  activationSignature: "canary-activation-sig-base64url-NEVER-LEAK",
  refreshSignature: "canary-refresh-sig-base64url-NEVER-LEAK",
  challengeNonce: "canary-challenge-nonce-fixed-NEVER-LEAK",
  portalToken: "canary-portal-session-token-NEVER-LEAK",
  magicToken: "canary-magic-link-token-NEVER-LEAK",
  grantToken: "canary-download-grant-token-NEVER-LEAK",
} as const;

export type CommerceCanaryKey = keyof typeof COMMERCE_CANARY_FIXTURES;

/** Flat list of every canary value for scanning surfaces. */
export function allCommerceCanaryValues(): string[] {
  return Object.values(COMMERCE_CANARY_FIXTURES);
}

export const VAULT_REF_PREFIX = "vault:";

/** Vault ids must be path-safe (no separators / traversal). */
export const VAULT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function isVaultRef(value: string): boolean {
  if (!value.startsWith(VAULT_REF_PREFIX)) return false;
  const id = value.slice(VAULT_REF_PREFIX.length);
  return VAULT_ID_PATTERN.test(id);
}

export function makeVaultRef(id: string): string {
  if (!VAULT_ID_PATTERN.test(id)) {
    throw new Error("invalid vault id");
  }
  return `${VAULT_REF_PREFIX}${id}`;
}

/**
 * Redact general + commerce secret material from free-form text.
 * Idempotent; vault refs pass through unchanged.
 */
export function redactSecretString(input: string): string {
  if (!input) return input;
  if (isVaultRef(input)) return input;
  return redactCommerceSecrets(applyPatterns(input, SECRET_VALUE_PATTERNS));
}

/**
 * Commerce-focused redaction (product keys, leases, private keys, tokens).
 * Safe to call on any log/IPC/diagnostic string.
 */
export function redactCommerceSecrets(input: string): string {
  if (!input) return input;
  if (isVaultRef(input)) return input;
  return applyPatterns(input, COMMERCE_SECRET_PATTERNS);
}

function applyPatterns(input: string, patterns: RegExp[]): string {
  let out = input;
  for (const re of patterns) {
    // Reset lastIndex for global regexes reused across calls.
    re.lastIndex = 0;
    out = out.replace(re, (match, g1) => {
      // Preserve query-param name for URL forms: `?grant=` + redaction.
      if (typeof g1 === "string" && match.startsWith(g1)) {
        return `${g1}[REDACTED]`;
      }
      return "[REDACTED]";
    });
  }
  return out;
}

export function looksLikeSecretEnvKey(key: string): boolean {
  return SECRET_ENV_KEY.test(key);
}

/**
 * Deep-clone settings-like objects, replacing secret env values with redaction
 * or vault refs unchanged.
 */
export function redactMcpServersForClient<
  T extends {
    id: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    enabled: boolean;
  },
>(servers: T[]): T[] {
  return servers.map((s) => {
    if (!s.env) return { ...s };
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(s.env)) {
      if (isVaultRef(v)) {
        env[k] = v;
      } else if (looksLikeSecretEnvKey(k) || looksLikeLiteralSecret(v)) {
        env[k] = "[REDACTED]";
      } else {
        env[k] = redactSecretString(v);
      }
    }
    return { ...s, env };
  });
}

function looksLikeLiteralSecret(value: string): boolean {
  if (!value || value.length < 8) return false;
  if (value.startsWith("${") && value.endsWith("}")) return false;
  if (isVaultRef(value)) return false;
  // Heuristic: long opaque tokens
  if (/^[A-Za-z0-9_\-./+=]{24,}$/.test(value)) return true;
  const all = [...SECRET_VALUE_PATTERNS, ...COMMERCE_SECRET_PATTERNS];
  return all.some((re) => {
    re.lastIndex = 0;
    return re.test(value);
  });
}

export function containsLiteralSecret(haystack: string, canary: string): boolean {
  return haystack.includes(canary);
}

/**
 * Return canary values still present in haystack (empty = clean).
 */
export function findCommerceCanaries(
  haystack: string,
  canaries: readonly string[] = allCommerceCanaryValues(),
): string[] {
  return canaries.filter((c) => haystack.includes(c));
}

/**
 * Fail closed when any canary remains in a surface dump.
 */
export function assertNoCommerceCanaries(
  haystack: string,
  label: string,
  canaries: readonly string[] = allCommerceCanaryValues(),
): void {
  const found = findCommerceCanaries(haystack, canaries);
  if (found.length > 0) {
    throw new Error(
      `${label}: commerce secret canary leaked (${found.length}): ${found
        .map((c) => c.slice(0, 24))
        .join(", ")}…`,
    );
  }
}

/**
 * Deep-walk plain objects/arrays and redact known commerce secret fields +
 * string values that match commerce patterns.
 */
export function redactCommerceValue<T>(value: T): T {
  return redactValueInner(value) as T;
}

function redactValueInner(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return redactSecretString(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactValueInner);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (isCommerceSecretFieldName(k)) {
      out[k] = typeof v === "string" && v.length > 0 ? "[REDACTED]" : v;
      continue;
    }
    out[k] = redactValueInner(v);
  }
  return out;
}

function isCommerceSecretFieldName(key: string): boolean {
  const lower = key.toLowerCase();
  // JWK private parameter `d` is secret when present on OKP/EC/RSA keys.
  if (lower === "d") return true;
  return (COMMERCE_SECRET_FIELD_NAMES as readonly string[]).some(
    (f) => f.toLowerCase() === lower,
  );
}

/** Retry class for safe entitlement telemetry (never free-form causes). */
export type EntitlementRetryClass =
  | "none"
  | "retryable"
  | "non_retryable";

/**
 * Safe entitlement log fields — only these may be written to logs/diagnostics.
 * Event name, stable result code, platform/architecture, retry class, correlation ID.
 * Never include fetch bodies, product keys, leases, nonces, or proofs.
 */
export type SafeEntitlementLogFields = {
  event: string;
  code?: string;
  platform?: string;
  architecture?: string;
  retryClass?: EntitlementRetryClass;
  correlationId?: string;
};

/**
 * Format a single structured log line for entitlement lifecycle events.
 * Extra unknown keys are dropped. Values are restricted to stable tokens so
 * free-form secrets cannot ride along in event/code/correlation fields.
 */
export function formatSafeEntitlementLog(
  fields: SafeEntitlementLogFields,
): string {
  const parts: string[] = [`event=${sanitizeEvent(fields.event)}`];
  if (fields.code) parts.push(`code=${sanitizeStableCode(fields.code)}`);
  if (fields.platform) {
    parts.push(`platform=${sanitizeStableCode(fields.platform)}`);
  }
  if (fields.architecture) {
    parts.push(`architecture=${sanitizeStableCode(fields.architecture)}`);
  }
  if (fields.retryClass) {
    const rc = fields.retryClass;
    if (rc === "none" || rc === "retryable" || rc === "non_retryable") {
      parts.push(`retryClass=${rc}`);
    }
  }
  if (fields.correlationId) {
    parts.push(`correlationId=${sanitizeCorrelationId(fields.correlationId)}`);
  }
  // Final commerce pass (defense in depth for any residual structural secrets).
  return redactCommerceSecrets(parts.join(" "));
}

/** Event names: dotted identifiers only (e.g. entitlement.activate). */
function sanitizeEvent(value: string): string {
  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 64);
  return cleaned.length > 0 ? cleaned : "unknown";
}

/** Stable codes / platform tokens: snake_case / short alnum only. */
function sanitizeStableCode(value: string): string {
  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 64);
  // Reject values that still look like product keys after sanitization.
  if (!cleaned || /^gd[123]_/.test(cleaned) || cleaned.includes("canary")) {
    return "redacted";
  }
  return cleaned;
}

/** Correlation IDs: UUID / short opaque id — never long grant-like tokens. */
function sanitizeCorrelationId(value: string): string {
  const raw = String(value).trim();
  // UUID (with or without dashes) or short request ids.
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      raw,
    ) ||
    /^[A-Za-z0-9._:-]{1,64}$/.test(raw)
  ) {
    // Reject anything that embeds a product-key or JWT shape.
    if (/\bGD[123]\./i.test(raw) || raw.startsWith("eyJ") || raw.length > 64) {
      return "redacted";
    }
    // Reject known commerce field-shaped smuggling.
    if (/canary|grant|magic|portal|nonce|pkcs|private/i.test(raw)) {
      return "redacted";
    }
    return raw.slice(0, 64);
  }
  return "redacted";
}

/**
 * Build a gateway/remote-safe error payload from an entitlement denial.
 * Wire surface is always a stable code — never internal causes or secrets.
 */
export function toSafeEntitlementWireError(input: {
  code: string;
  state?: string;
  action?: string;
  capability?: string;
  denialCode?: string;
}): {
  code: string;
  state?: string;
  action?: string;
  capability?: string;
  denialCode?: string;
} {
  const out: {
    code: string;
    state?: string;
    action?: string;
    capability?: string;
    denialCode?: string;
  } = { code: sanitizeStableCode(input.code) || "service_unavailable" };
  if (input.state) out.state = sanitizeStableCode(input.state);
  if (input.action) out.action = sanitizeEvent(input.action);
  if (input.capability) out.capability = sanitizeStableCode(input.capability);
  if (input.denialCode) out.denialCode = sanitizeStableCode(input.denialCode);
  return out;
}
