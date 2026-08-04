import { afterEach, describe, expect, it, vi } from "vitest";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createEntitlementBootstrap,
  ENTITLEMENT_STATE_PATH_ENV,
} from "./bootstrap.js";
import {
  createMemoryCredentialVault,
} from "./os-credential-vault.js";
import { ENTITLEMENT_STATE_FILENAME } from "./state-store.js";
import { EntitlementClient } from "@grokdesk/entitlement-client";


describe("createEntitlementBootstrap", () => {
  let tmp: string;
  let bootstrap: ReturnType<typeof createEntitlementBootstrap> | null = null;

  afterEach(async () => {
    bootstrap?.stop();
    bootstrap = null;
    if (tmp) {
      await fsp.rm(tmp, { recursive: true, force: true });
    }
  });

  it("composes manager, state path, and path-only env hints", async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "ent-boot-"));
    const vault = createMemoryCredentialVault();
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ keys: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    bootstrap = createEntitlementBootstrap({
      userDataDir: tmp,
      deskVersion: "0.0.0-test",
      baseUrl: "https://entitlement.test/",
      expectedIssuer: "https://entitlement.test",
      expectedAudience: "grok-desk",
      vault,
      fetch: fetchMock as unknown as typeof fetch,
      platform: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "14.0",
        deskVersion: "0.0.0-test",
      },
      refresh: {
        setTimer: () => 0 as unknown as ReturnType<typeof setTimeout>,
        clearTimer: () => {},
        randomUnit: () => 0,
      },
    });

    const statePath = bootstrap.getStatePath();
    expect(statePath).toBe(
      path.join(tmp, "entitlements", ENTITLEMENT_STATE_FILENAME),
    );
    expect(bootstrap.manager.statePath).toBe(statePath);

    const hints = bootstrap.getManagedEnvHints();
    expect(hints[ENTITLEMENT_STATE_PATH_ENV]).toBe(statePath);
    expect(hints).toMatchObject({
      [ENTITLEMENT_STATE_PATH_ENV]: statePath,
    });
    // Path + issuer/audience only until JWKS is merged after init.
    expect(Object.keys(hints)).not.toContain("GROKDESK_PRODUCT_KEY");
    expect(JSON.stringify(hints)).not.toMatch(/\bGD[123]\./);
    expect(JSON.stringify(hints)).not.toMatch(/private/i);
    expect(JSON.stringify(hints)).not.toMatch(/BEGIN PRIVATE/);
    expect(JSON.stringify(hints)).not.toMatch(/eyJ/);

    expect(bootstrap.vault).toBe(vault);
    expect(bootstrap.client).toBeInstanceOf(EntitlementClient);
    expect(typeof bootstrap.getLeasePublicJwksForGateway).toBe("function");
  });

  it("requires userDataDir and issuer/audience", () => {
    expect(() =>
      createEntitlementBootstrap({
        userDataDir: "",
        deskVersion: "1",
        baseUrl: "https://x.test",
        expectedIssuer: "iss",
        expectedAudience: "aud",
      }),
    ).toThrow(/userDataDir/);
  });
});
