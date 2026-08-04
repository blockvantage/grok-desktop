import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AUTHORITATIVE_STATES,
  EntitlementStateError,
  EntitlementStateStore,
  MAX_ENTITLEMENT_STATE_BYTES,
  STATE_DIR_MODE,
  STATE_FILE_MODE,
  defaultEntitlementStatePath,
  parseEntitlementStateFile,
  serializeEntitlementStateFile,
  type EntitlementStateFile,
} from "./state-store.js";

const isPosix = process.platform !== "win32";

function sampleState(
  overrides: Partial<EntitlementStateFile> = {},
): EntitlementStateFile {
  return {
    schema: 1,
    deviceId: "550e8400-e29b-41d4-a716-446655440000",
    devicePublicKeyThumbprint: "thumbprint-abc123",
    lease:
      "eyJhbGciOiJFZERTQSIsInR5cCI6Imdyb2tkZXNrLWxlYXNlK2p3dCJ9.eyJzdWIiOiJkZXYifQ.sig",
    authoritativeState: "none",
    updatedAt: "2026-07-16T12:00:00.000Z",
    requestId: "req-1",
    ...overrides,
  };
}

describe("entitlement state store", () => {
  let root: string;
  let filePath: string;
  let store: EntitlementStateStore;

  beforeEach(async () => {
    root = await fsp.mkdtemp(path.join(os.tmpdir(), "gd-entitlement-state-"));
    filePath = defaultEntitlementStatePath(root);
    store = new EntitlementStateStore(filePath);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  describe("envelope parse/serialize", () => {
    it("round-trips a valid state envelope", () => {
      const state = sampleState();
      const body = serializeEntitlementStateFile(state);
      const parsed = parseEntitlementStateFile(body);
      expect(parsed).toEqual({
        schema: 1,
        deviceId: state.deviceId,
        devicePublicKeyThumbprint: state.devicePublicKeyThumbprint,
        lease: state.lease,
        authoritativeState: "none",
        updatedAt: state.updatedAt,
        requestId: state.requestId,
      });
    });

    it("accepts all authoritative denial states", () => {
      for (const authoritativeState of AUTHORITATIVE_STATES) {
        const body = serializeEntitlementStateFile(
          sampleState({ authoritativeState, lease: null }),
        );
        expect(parseEntitlementStateFile(body).authoritativeState).toBe(
          authoritativeState,
        );
      }
    });

    it("rejects unknown schema", () => {
      expect(() =>
        parseEntitlementStateFile(
          JSON.stringify({ ...sampleState(), schema: 99 }),
        ),
      ).toThrowError(EntitlementStateError);
      try {
        parseEntitlementStateFile(
          JSON.stringify({ ...sampleState(), schema: 99 }),
        );
      } catch (err) {
        expect(err).toMatchObject({ code: "invalid_schema" });
      }
    });

    it("rejects oversized payloads", () => {
      const huge = "x".repeat(MAX_ENTITLEMENT_STATE_BYTES + 1);
      expect(() => parseEntitlementStateFile(huge)).toThrowError(
        expect.objectContaining({ code: "oversized" }),
      );
    });

    it("rejects unknown fields", () => {
      try {
        parseEntitlementStateFile(
          JSON.stringify({ ...sampleState(), extra: true }),
        );
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toMatchObject({ code: "corrupt" });
      }
    });

    it("rejects GD3 product keys and private key material (canary)", () => {
      try {
        parseEntitlementStateFile(
          JSON.stringify(sampleState({ lease: "GD3.claims.sig" })),
        );
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toMatchObject({ code: "contains_secrets" });
      }

      const withPrivate = {
        ...sampleState(),
        privatePkcs8Base64: "AAAA",
      };
      try {
        parseEntitlementStateFile(JSON.stringify(withPrivate));
        expect.fail("expected throw");
      } catch (err) {
        expect(err).toMatchObject({ code: "contains_secrets" });
      }

      expect(() =>
        serializeEntitlementStateFile(
          sampleState({ lease: "GD3.product.key" }),
        ),
      ).toThrowError(EntitlementStateError);
    });
  });

  describe("atomic write + durable read", () => {
    it("writes and reads lease + safe denial metadata", async () => {
      const state = sampleState({
        authoritativeState: "suspended",
        lease: null,
        requestId: "deny-1",
      });
      await store.write(state);
      const loaded = await store.read();
      expect(loaded).toEqual(state);

      const raw = await fsp.readFile(filePath, "utf8");
      // Canary: durable file must not hold product keys or private keys.
      expect(raw).not.toMatch(/GD3\./);
      expect(raw).not.toMatch(/privatePkcs8|privateKey|BEGIN PRIVATE KEY/i);
      expect(raw).toContain('"authoritativeState":"suspended"');
      expect(JSON.parse(raw)).not.toHaveProperty("productKey");
      expect(JSON.parse(raw)).not.toHaveProperty("privatePkcs8Base64");
    });

    it("returns null when the state file is absent", async () => {
      expect(await store.read()).toBeNull();
    });

    it("sets mode 0600 on POSIX and parent user-only (0700)", async () => {
      await store.write(sampleState());
      if (!isPosix) {
        // Still succeeds on Windows; mode assertions are POSIX-only.
        expect(await store.read()).not.toBeNull();
        return;
      }
      const fileStat = await fsp.stat(filePath);
      expect(fileStat.mode & 0o777).toBe(STATE_FILE_MODE);

      const dirStat = await fsp.stat(path.dirname(filePath));
      expect(dirStat.mode & 0o777).toBe(STATE_DIR_MODE);
      // Parent must not be group/world accessible.
      expect(dirStat.mode & 0o077).toBe(0);
      expect(fileStat.mode & 0o077).toBe(0);
    });

    it("rejects symlinked state files on read", async () => {
      if (!isPosix) return;
      await store.ensureParentDir();
      const real = path.join(path.dirname(filePath), "real-state.json");
      await fsp.writeFile(
        real,
        serializeEntitlementStateFile(sampleState()),
        { mode: 0o600 },
      );
      await fsp.symlink(real, filePath);
      await expect(store.read()).rejects.toMatchObject({ code: "symlink" });
    });

    it("rejects world/group-readable state files on POSIX", async () => {
      if (!isPosix) return;
      await store.ensureParentDir();
      await fsp.writeFile(
        filePath,
        serializeEntitlementStateFile(sampleState()),
        { mode: 0o644 },
      );
      // Explicitly open up group/other bits in case umask interfered.
      await fsp.chmod(filePath, 0o644);
      await expect(store.read()).rejects.toMatchObject({
        code: "insecure_permissions",
      });
    });

    it("rejects oversized on-disk files", async () => {
      await store.ensureParentDir();
      const huge = "x".repeat(MAX_ENTITLEMENT_STATE_BYTES + 8);
      await fsp.writeFile(filePath, huge, {
        mode: isPosix ? 0o600 : undefined,
      });
      await expect(store.read()).rejects.toMatchObject({ code: "oversized" });
    });

    it("rejects unknown schema on disk", async () => {
      await store.ensureParentDir();
      await fsp.writeFile(
        filePath,
        JSON.stringify({ ...sampleState(), schema: 2 }),
        { mode: isPosix ? 0o600 : undefined },
      );
      await expect(store.read()).rejects.toMatchObject({
        code: "invalid_schema",
      });
    });
  });

  describe("crash durability", () => {
    it("keeps previous valid file when failure is injected before write", async () => {
      const first = sampleState({
        lease: "lease-v1.token",
        updatedAt: "2026-07-16T10:00:00.000Z",
        requestId: "r1",
      });
      await store.write(first);

      const crashing = new EntitlementStateStore(filePath, {
        hooks: {
          beforeWrite: () => {
            throw new Error("injected: before write");
          },
        },
      });

      await expect(
        crashing.write(
          sampleState({
            lease: "lease-v2.token",
            updatedAt: "2026-07-16T11:00:00.000Z",
            requestId: "r2",
          }),
        ),
      ).rejects.toThrow(/before write|atomic state write failed/);

      const loaded = await store.read();
      expect(loaded).toEqual(first);
      // No leftover durable corruption.
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("keeps previous valid file when failure is injected after fsync", async () => {
      const first = sampleState({
        lease: "lease-v1.token",
        requestId: "before-fsync-crash",
      });
      await store.write(first);

      const crashing = new EntitlementStateStore(filePath, {
        hooks: {
          afterFsync: () => {
            throw new Error("injected: after fsync");
          },
        },
      });

      await expect(
        crashing.write(
          sampleState({
            lease: "lease-v2.should-not-commit",
            requestId: "after-fsync",
          }),
        ),
      ).rejects.toThrow(/after fsync|atomic state write failed/);

      const loaded = await store.read();
      expect(loaded?.lease).toBe("lease-v1.token");
      expect(loaded?.requestId).toBe("before-fsync-crash");
    });

    it("keeps previous valid file when failure is injected before rename", async () => {
      const first = sampleState({
        lease: "lease-v1.token",
        requestId: "before-rename-crash",
      });
      await store.write(first);

      const crashing = new EntitlementStateStore(filePath, {
        hooks: {
          beforeRename: () => {
            throw new Error("injected: before rename");
          },
        },
      });

      await expect(
        crashing.write(
          sampleState({
            lease: "lease-v2.should-not-commit",
            requestId: "would-rename",
          }),
        ),
      ).rejects.toThrow(/before rename|atomic state write failed/);

      const loaded = await store.read();
      expect(loaded).toEqual(first);

      // Temp files from the failed attempt should not replace the durable path.
      const dirents = await fsp.readdir(path.dirname(filePath));
      expect(dirents).toContain("state.json");
      // Cleanup removes tmp; if any remain they must not be the state file content.
      for (const name of dirents) {
        if (name.endsWith(".tmp")) {
          const tmpBody = await fsp.readFile(
            path.join(path.dirname(filePath), name),
            "utf8",
          );
          expect(tmpBody).not.toContain("lease-v1.token");
        }
      }
    });

    it("commits only after successful rename", async () => {
      await store.write(sampleState({ lease: "lease-v1.token" }));
      await store.write(
        sampleState({
          lease: "lease-v2.token",
          updatedAt: "2026-07-16T13:00:00.000Z",
          requestId: "ok",
        }),
      );
      const loaded = await store.read();
      expect(loaded?.lease).toBe("lease-v2.token");
      expect(loaded?.requestId).toBe("ok");
    });
  });

  describe("transient refresh failure preserves lease", () => {
    it("keeps previous valid lease when transient refresh fails", async () => {
      const active = sampleState({
        lease: "still-valid-lease.jwt",
        authoritativeState: "none",
        updatedAt: "2026-07-16T08:00:00.000Z",
        requestId: "activate-1",
      });
      await store.write(active);

      const next = await store.writeTransientRefreshFailure({
        updatedAt: "2026-07-16T09:00:00.000Z",
        requestId: "refresh-timeout-1",
      });

      expect(next.lease).toBe("still-valid-lease.jwt");
      expect(next.authoritativeState).toBe("none");
      expect(next.deviceId).toBe(active.deviceId);
      expect(next.devicePublicKeyThumbprint).toBe(
        active.devicePublicKeyThumbprint,
      );
      expect(next.updatedAt).toBe("2026-07-16T09:00:00.000Z");
      expect(next.requestId).toBe("refresh-timeout-1");

      const reloaded = await store.read();
      expect(reloaded?.lease).toBe("still-valid-lease.jwt");
    });

    it("does not clear a lease that existed before authoritative none update path", async () => {
      // Direct write with null lease is allowed (authoritative denial path),
      // but transient helper must not invent null over a prior lease.
      await store.write(
        sampleState({ lease: "keep-me", authoritativeState: "none" }),
      );
      const after = await store.writeTransientRefreshFailure({
        updatedAt: "2026-07-16T10:00:00.000Z",
        requestId: null,
      });
      expect(after.lease).toBe("keep-me");
    });

    it("preserves prior authoritative denial across transient failures", async () => {
      await store.write(
        sampleState({
          lease: null,
          authoritativeState: "refunded",
          requestId: "refund-evt",
        }),
      );
      const after = await store.writeTransientRefreshFailure({
        updatedAt: "2026-07-16T11:00:00.000Z",
        requestId: "later-refresh",
      });
      expect(after.authoritativeState).toBe("refunded");
      expect(after.lease).toBeNull();
    });
  });

  describe("default path helper", () => {
    it("places state under entitlements/state.json", () => {
      expect(defaultEntitlementStatePath("/tmp/user-data")).toBe(
        path.join("/tmp/user-data", "entitlements", "state.json"),
      );
    });
  });
});
