/**
 * Entitlement composition adapter for Electron main.
 *
 * Owns vault + state-store + client + manager construction so index.ts can
 * call one function later without embedding entitlement internals.
 *
 * Never puts product keys or device private keys into env hints for the gateway.
 */

import os from "node:os";
import type { EntitlementClient } from "@grokdesk/entitlement-client";
import type { PublicJwk } from "@grokdesk/license";
import {
  createDesktopEntitlementClient,
  createEntitlementManager,
  type EntitlementManager,
  type EntitlementStatus,
} from "./entitlement-manager.js";
import type { PlatformInfo } from "./activation-flow.js";
import type { OsCredentialVault } from "./os-credential-vault.js";
import {
  createSafeStorageCredentialVault,
  type CreateSafeStorageVaultOptions,
} from "./safe-storage-vault.js";
import {
  defaultEntitlementStatePath,
  EntitlementStateStore,
  type EntitlementStateStoreOptions,
} from "./state-store.js";

/** Env keys the gateway may receive from main (path + public JWKS only; no secrets). */
export const ENTITLEMENT_STATE_PATH_ENV = "GROKDESK_ENTITLEMENT_STATE_PATH" as const;
export const LEASE_PUBLIC_JWKS_ENV = "GROKDESK_LEASE_PUBLIC_JWKS" as const;
export const ENTITLEMENT_ISSUER_ENV = "GROKDESK_ENTITLEMENT_ISSUER" as const;
export const ENTITLEMENT_AUDIENCE_ENV = "GROKDESK_ENTITLEMENT_AUDIENCE" as const;
/** Dev default entitlement API base (override with GROKDESK_ENTITLEMENT_API_URL). */
export const DEFAULT_ENTITLEMENT_API_URL = "http://127.0.0.1:8791" as const;
export const DEFAULT_ENTITLEMENT_AUDIENCE = "grok-desk" as const;

export type EntitlementBootstrapOptions = {
  /** Electron `app.getPath("userData")` (or test temp dir). */
  userDataDir: string;
  /** Desk app version for User-Agent / activation proof. */
  deskVersion: string;
  /** Entitlement API base URL. */
  baseUrl: URL | string;
  expectedIssuer: string;
  expectedAudience: string;
  /** Override platform fields (tests / packaging). */
  platform?: Partial<PlatformInfo>;
  /** Inject vault (tests); production omits to use the local file vault. */
  vault?: OsCredentialVault;
  vaultOptions?: Omit<CreateSafeStorageVaultOptions, "userDataDir">;
  stateStoreOptions?: EntitlementStateStoreOptions;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  now?: () => Date;
  onStatusChange?: (status: EntitlementStatus) => void;
  /**
   * DEV-ONLY: report a synthetic active status so local runs skip the activation
   * wall. Set only for unpackaged `GROKDESK_DEV_UNLOCK=1` or explicit
   * compile-time `GROKDESK_BAKE_DEV_UNLOCK=1` review install builds.
   */
  devUnlock?: boolean;
  /** Prebuilt client (tests). */
  client?: EntitlementClient;
  refresh?: {
    setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
    randomUnit?: () => number;
  };
};

export type EntitlementManagedEnvHints = {
  [ENTITLEMENT_STATE_PATH_ENV]: string;
  [ENTITLEMENT_ISSUER_ENV]?: string;
  [ENTITLEMENT_AUDIENCE_ENV]?: string;
  /** Populated after init when lease public keys are available. */
  [LEASE_PUBLIC_JWKS_ENV]?: string;
};

export type EntitlementBootstrap = {
  manager: EntitlementManager;
  vault: OsCredentialVault;
  stateStore: EntitlementStateStore;
  client: EntitlementClient;
  expectedIssuer: string;
  expectedAudience: string;
  /** Absolute path of the durable entitlement state file. */
  getStatePath: () => string;
  /**
   * Safe env fragment for gateway spawn. Path + public JWKS only —
   * never product key, private key, or lease JWT contents.
   */
  getManagedEnvHints: () => EntitlementManagedEnvHints;
  /**
   * Public lease JWKs for gateway env (`GROKDESK_LEASE_PUBLIC_JWKS`).
   * Empty when the well-known set could not be loaded.
   */
  getLeasePublicJwksForGateway: () => Promise<PublicJwk[]>;
  /** Stop refresh timers. */
  stop: () => void;
};

function resolvePlatform(
  deskVersion: string,
  partial?: Partial<PlatformInfo>,
): PlatformInfo {
  return {
    platform: partial?.platform ?? process.platform,
    arch: partial?.arch ?? process.arch,
    osVersion:
      partial?.osVersion ??
      `${process.platform} ${os.release()}`.trim(),
    deskVersion: partial?.deskVersion ?? deskVersion,
  };
}

/**
 * Compose entitlement main-process services.
 * Call `manager.initialize()` before starting the gateway.
 */
export function createEntitlementBootstrap(
  opts: EntitlementBootstrapOptions,
): EntitlementBootstrap {
  if (!opts.userDataDir || typeof opts.userDataDir !== "string") {
    throw new TypeError("userDataDir is required");
  }
  if (!opts.deskVersion || typeof opts.deskVersion !== "string") {
    throw new TypeError("deskVersion is required");
  }
  if (!opts.expectedIssuer || !opts.expectedAudience) {
    throw new TypeError("expectedIssuer and expectedAudience are required");
  }

  const vault =
    opts.vault ??
    // Local AES file vault under userData (no Keychain / keytar prompts).
    createSafeStorageCredentialVault({
      userDataDir: opts.userDataDir,
      ...opts.vaultOptions,
    });

  const statePath = defaultEntitlementStatePath(opts.userDataDir);
  const stateStore = new EntitlementStateStore(
    statePath,
    opts.stateStoreOptions,
  );

  const client =
    opts.client ??
    createDesktopEntitlementClient({
      baseUrl: opts.baseUrl,
      deskVersion: opts.deskVersion,
      fetch: opts.fetch,
      timeoutMs: opts.timeoutMs,
    });

  const platform = resolvePlatform(opts.deskVersion, opts.platform);

  const manager = createEntitlementManager({
    vault,
    stateStore,
    client,
    platform,
    expectedIssuer: opts.expectedIssuer,
    expectedAudience: opts.expectedAudience,
    now: opts.now,
    refresh: opts.refresh,
    onStatusChange: opts.onStatusChange,
    devUnlock: opts.devUnlock,
  });

  return {
    manager,
    vault,
    stateStore,
    client,
    expectedIssuer: opts.expectedIssuer,
    expectedAudience: opts.expectedAudience,
    getStatePath: () => manager.statePath,
    getManagedEnvHints: () => {
      const pathOnly = manager.statePath;
      // Defensive: never allow GD3 / private key strings into gateway env.
      if (/\bGD[123]\./i.test(pathOnly) || /private/i.test(pathOnly)) {
        throw new Error("entitlement state path looks unsafe");
      }
      return {
        [ENTITLEMENT_STATE_PATH_ENV]: pathOnly,
        [ENTITLEMENT_ISSUER_ENV]: opts.expectedIssuer,
        [ENTITLEMENT_AUDIENCE_ENV]: opts.expectedAudience,
      };
    },
    getLeasePublicJwksForGateway: () => manager.getLeasePublicJwksForGateway(),
    stop: () => manager.stop(),
  };
}
