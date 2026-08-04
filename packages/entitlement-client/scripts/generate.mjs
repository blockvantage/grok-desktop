#!/usr/bin/env node
/**
 * Deterministic OpenAPI → TypeScript generator for the public entitlement client.
 * Embeds the source OpenAPI SHA-256 and fails if required operation IDs disappear.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");
const openapiPath = path.join(pkgRoot, "openapi", "entitlement-api.v1.json");
const outPath = path.join(pkgRoot, "src", "generated", "api.ts");

/** Public desktop surface — must match frozen OpenAPI operationIds. */
const REQUIRED_OPERATION_IDS = [
  "getWellKnownGrokdeskKeys",
  "createActivationChallenge",
  "createActivation",
  "exchangeLegacyGd2",
  "createDeactivationChallenge",
  "deleteCurrentActivation",
  "createLeaseChallenge",
  "refreshLease",
  "getReleaseManifest",
  "resolveRelease",
  "createDownloadGrant",
  "redeemDownload",
  "getHealthz",
  "getReadyz",
];

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

function sha256Hex(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function refName(ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/components/schemas/")) {
    return null;
  }
  return ref.slice("#/components/schemas/".length);
}

function collectPublicSchemas(doc, operationIds) {
  const schemas = doc.components?.schemas ?? {};
  const needed = new Set();

  function addSchema(name) {
    if (!name || needed.has(name) || !schemas[name]) return;
    needed.add(name);
    walk(schemas[name]);
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node.$ref === "string") {
      const n = refName(node.$ref);
      if (n) addSchema(n);
      return;
    }
    for (const v of Object.values(node)) walk(v);
  }

  for (const [, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods ?? {})) {
      if (!HTTP_METHODS.has(method) || typeof op !== "object" || !op) continue;
      if (!operationIds.has(op.operationId)) continue;
      walk(op.requestBody);
      walk(op.responses);
      walk(op.parameters);
    }
  }

  // Always include Error + StableErrorCode for client error typing.
  addSchema("Error");
  addSchema("StableErrorCode");
  return [...needed].sort();
}

function tsTypeFromSchema(schema, schemas, depth = 0) {
  if (!schema || typeof schema !== "object") return "unknown";
  if (schema.$ref) {
    const n = refName(schema.$ref);
    return n ?? "unknown";
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  }
  if (schema.anyOf) {
    return schema.anyOf
      .map((s) => tsTypeFromSchema(s, schemas, depth + 1))
      .join(" | ");
  }
  if (schema.oneOf) {
    return schema.oneOf
      .map((s) => tsTypeFromSchema(s, schemas, depth + 1))
      .join(" | ");
  }
  if (schema.allOf) {
    return schema.allOf
      .map((s) => tsTypeFromSchema(s, schemas, depth + 1))
      .join(" & ");
  }

  const t = schema.type;
  if (Array.isArray(t)) {
    // OpenAPI 3.1 nullable unions e.g. ["string","null"]
    return t
      .map((part) =>
        tsTypeFromSchema({ ...schema, type: part }, schemas, depth + 1),
      )
      .join(" | ");
  }

  switch (t) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "null":
      return "null";
    case "array":
      return `Array<${tsTypeFromSchema(schema.items ?? {}, schemas, depth + 1)}>`;
    case "object":
    default: {
      if (schema.properties) {
        const required = new Set(schema.required ?? []);
        const lines = Object.entries(schema.properties).map(([key, prop]) => {
          const opt = required.has(key) ? "" : "?";
          const propType = tsTypeFromSchema(prop, schemas, depth + 1);
          return `  ${JSON.stringify(key)}${opt}: ${propType};`;
        });
        const extra =
          schema.additionalProperties === false
            ? ""
            : schema.additionalProperties &&
                typeof schema.additionalProperties === "object"
              ? `\n  [key: string]: ${tsTypeFromSchema(schema.additionalProperties, schemas, depth + 1)};`
              : schema.additionalProperties === true
                ? "\n  [key: string]: unknown;"
                : "";
        return `{\n${lines.join("\n")}${extra}\n}`;
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        return `Record<string, ${tsTypeFromSchema(schema.additionalProperties, schemas, depth + 1)}>`;
      }
      return t === "object" ? "Record<string, unknown>" : "unknown";
    }
  }
}

function successResponseSchema(op) {
  const responses = op.responses ?? {};
  for (const code of ["200", "201", "204"]) {
    const r = responses[code];
    if (!r) continue;
    const json = r.content?.["application/json"]?.schema;
    if (json) return json;
    if (code === "204") return null;
  }
  return null;
}

function requestBodySchema(op) {
  return op.requestBody?.content?.["application/json"]?.schema ?? null;
}

function queryParams(op) {
  return (op.parameters ?? []).filter((p) => p.in === "query");
}

function generate() {
  const raw = readFileSync(openapiPath);
  const openApiSha256 = sha256Hex(raw);
  const doc = JSON.parse(raw.toString("utf8"));

  const found = new Map();
  for (const [p, methods] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(methods ?? {})) {
      if (!HTTP_METHODS.has(method) || typeof op !== "object" || !op) continue;
      if (!op.operationId) continue;
      found.set(op.operationId, { path: p, method: method.toUpperCase(), op });
    }
  }

  const missing = REQUIRED_OPERATION_IDS.filter((id) => !found.has(id));
  if (missing.length > 0) {
    console.error(
      `generate failed: required operationIds missing from OpenAPI: ${missing.join(", ")}`,
    );
    process.exit(1);
  }

  const publicOps = REQUIRED_OPERATION_IDS.map((id) => {
    const entry = found.get(id);
    return { operationId: id, ...entry };
  });

  const schemaNames = collectPublicSchemas(doc, new Set(REQUIRED_OPERATION_IDS));
  const schemas = doc.components?.schemas ?? {};

  const lines = [];
  lines.push("/* eslint-disable */");
  lines.push("/**");
  lines.push(" * GENERATED FILE — do not edit by hand.");
  lines.push(" * Source: packages/entitlement-client/openapi/entitlement-api.v1.json");
  lines.push(` * OpenAPI SHA-256: ${openApiSha256}`);
  lines.push(" * Regenerated by: pnpm --filter @grokdesk/entitlement-client run generate");
  lines.push(" */");
  lines.push("");
  lines.push(`export const OPENAPI_SHA256 = ${JSON.stringify(openApiSha256)} as const;`);
  lines.push("");
  lines.push(
    `export const REQUIRED_OPERATION_IDS = ${JSON.stringify(REQUIRED_OPERATION_IDS, null, 2)} as const;`,
  );
  lines.push("");
  lines.push(
    "export type PublicOperationId = (typeof REQUIRED_OPERATION_IDS)[number];",
  );
  lines.push("");

  for (const name of schemaNames) {
    const schema = schemas[name];
    const body = tsTypeFromSchema(schema, schemas);
    // Prefer type aliases for unions/enums; interfaces for object shapes.
    if (
      schema &&
      typeof schema === "object" &&
      !schema.$ref &&
      (schema.type === "object" || schema.properties) &&
      !schema.enum &&
      !schema.anyOf &&
      !schema.oneOf &&
      !schema.allOf
    ) {
      // tsTypeFromSchema returns `{ ... }` — strip outer braces for interface.
      const inner = body.startsWith("{\n") ? body.slice(2, -2) : `  // empty\n`;
      lines.push(`export interface ${name} {`);
      lines.push(inner);
      lines.push(`}`);
    } else {
      lines.push(`export type ${name} = ${body};`);
    }
    lines.push("");
  }

  lines.push("export type OperationMeta = {");
  lines.push('  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";');
  lines.push("  path: string;");
  lines.push("  allowsRedirect: boolean;");
  lines.push("};");
  lines.push("");
  lines.push("export const OPERATIONS: Record<PublicOperationId, OperationMeta> = {");
  for (const { operationId, path: p, method } of publicOps) {
    const allowsRedirect = operationId === "redeemDownload";
    lines.push(
      `  ${operationId}: { method: ${JSON.stringify(method)}, path: ${JSON.stringify(p)}, allowsRedirect: ${allowsRedirect} },`,
    );
  }
  lines.push("};");
  lines.push("");

  // Per-operation request/response types
  for (const { operationId, op } of publicOps) {
    const bodySchema = requestBodySchema(op);
    const qparams = queryParams(op);
    const success = successResponseSchema(op);

    if (bodySchema) {
      const t = tsTypeFromSchema(bodySchema, schemas);
      lines.push(`export type ${operationId}Request = ${t};`);
    } else {
      lines.push(`export type ${operationId}Request = void;`);
    }

    if (qparams.length > 0) {
      const fields = qparams.map((p) => {
        const opt = p.required ? "" : "?";
        const t = tsTypeFromSchema(p.schema ?? { type: "string" }, schemas);
        return `  ${JSON.stringify(p.name)}${opt}: ${t};`;
      });
      lines.push(`export type ${operationId}Query = {\n${fields.join("\n")}\n};`);
    }

    if (success) {
      const t = tsTypeFromSchema(success, schemas);
      lines.push(`export type ${operationId}Response = ${t};`);
    } else if (operationId === "redeemDownload") {
      // 302 is valid; JSON body may also be returned.
      lines.push(
        `export type ${operationId}Response = DownloadRedeemResponse | { readonly redirect: true; readonly location: string };`,
      );
    } else {
      lines.push(`export type ${operationId}Response = void;`);
    }
    lines.push("");
  }

  lines.push("/** Map of public operationId → request body type. */");
  lines.push("export type OperationRequestMap = {");
  for (const { operationId } of publicOps) {
    lines.push(`  ${operationId}: ${operationId}Request;`);
  }
  lines.push("};");
  lines.push("");
  lines.push("/** Map of public operationId → success response type. */");
  lines.push("export type OperationResponseMap = {");
  for (const { operationId } of publicOps) {
    lines.push(`  ${operationId}: ${operationId}Response;`);
  }
  lines.push("};");
  lines.push("");

  const out = lines.join("\n") + "\n";
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, out, "utf8");
  process.stdout.write(
    `wrote ${path.relative(pkgRoot, outPath)} (${out.length} bytes, sha256=${openApiSha256})\n`,
  );
}

generate();
