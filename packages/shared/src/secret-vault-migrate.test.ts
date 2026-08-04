import { describe, it, expect } from "vitest";
import {
  scanMcpLiteralSecrets,
  migrateMcpLiteralSecretsToVaultRefs,
  resolveMcpVaultRefs,
  isLiteralSecretValue,
} from "./secret-vault-migrate.js";
import { isVaultRef, makeVaultRef } from "./secret-redact.js";

const CANARY = "sk-migrate-CANARY-token-aabbccdd1122";

describe("secret vault migrate (pure)", () => {
  it("detects secret-named literals and patterns", () => {
    const hits = scanMcpLiteralSecrets([
      {
        id: "s1",
        env: {
          API_KEY: CANARY,
          SAFE: "hello",
          GITHUB_TOKEN: "${GITHUB_TOKEN}",
          STORED: makeVaultRef("abc"),
        },
      },
    ]);
    expect(hits).toEqual([
      expect.objectContaining({ serverId: "s1", envKey: "API_KEY" }),
    ]);
    expect(isLiteralSecretValue(CANARY)).toBe(true);
    expect(isLiteralSecretValue("${X}")).toBe(false);
  });

  it("dry-run reports without rewriting", () => {
    const put = (s: string) => {
      throw new Error(`put should not run: ${s.slice(0, 4)}`);
    };
    const { servers, report } = migrateMcpLiteralSecretsToVaultRefs(
      [
        {
          id: "s1",
          command: "npx",
          args: [],
          env: { API_KEY: CANARY },
          enabled: true,
        },
      ],
      put,
      { dryRun: true },
    );
    expect(report.dryRun).toBe(true);
    expect(report.migrated).toHaveLength(1);
    expect(servers[0]!.env?.API_KEY).toBe(CANARY);
    expect(report.hasRemainingLiterals).toBe(true);
  });

  it("migrates literals to vault refs and resolves them back", () => {
    const store = new Map<string, string>();
    let n = 0;
    const put = (secret: string) => {
      const id = `id-${++n}`;
      store.set(id, secret);
      return makeVaultRef(id);
    };
    const get = (ref: string) => {
      if (!isVaultRef(ref)) return null;
      return store.get(ref.slice("vault:".length)) ?? null;
    };

    const { servers, report } = migrateMcpLiteralSecretsToVaultRefs(
      [
        {
          id: "sec",
          command: "npx",
          args: [],
          env: { API_KEY: CANARY, NOTE: "plain" },
          enabled: true,
        },
      ],
      put,
    );
    expect(report.migrated).toHaveLength(1);
    expect(report.hasRemainingLiterals).toBe(false);
    const ref = servers[0]!.env?.API_KEY;
    expect(ref).toBeDefined();
    expect(isVaultRef(ref!)).toBe(true);
    expect(JSON.stringify(servers)).not.toContain(CANARY);

    const resolved = resolveMcpVaultRefs(servers, get);
    expect(resolved[0]!.env?.API_KEY).toBe(CANARY);
  });
});
