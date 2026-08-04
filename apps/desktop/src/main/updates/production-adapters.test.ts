import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuntimeStore } from "../runtime/runtime-store.js";
import type { PlatformSigningResult } from "../runtime/runtime-types.js";
import type { ProbeRunResult } from "../runtime/runtime-verifier.js";
import {
  createProductionUpdateAdapters,
  isProductionUpdateConfigReady,
  resolveManifestUrlFromEnv,
  tryCreateProductionUpdateAdapters,
  type ProductionUpdateAdapters,
} from "./production-adapters.js";
import type {
  DeskDownloadResult,
  DeskUpdater,
  ExactDeskFeed,
} from "./desk-updater.js";
import {
  generateTestKey,
  samplePayload,
  signEnvelope,
} from "./manifest-test-helpers.js";
import { hashManifestPayload } from "./manifest-verifier.js";

const FIXED_NOW = Date.parse("2026-07-10T12:00:00.000Z");
const GROK_VERSION = "0.9.5";
const DESK_VERSION = "1.3.0";
const TARGET = "darwin-arm64" as const;

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function probeOk(stdout: string): ProbeRunResult {
  return {
    code: 0,
    stdout,
    stderr: "",
    durationMs: 2,
    timedOut: false,
  };
}

describe("resolveManifestUrlFromEnv / isProductionUpdateConfigReady", () => {
  it("returns null when neither manifest URL nor entitlement API is set", () => {
    expect(
      resolveManifestUrlFromEnv({
        GROKDESK_MANIFEST_URL: undefined,
        GROKDESK_ENTITLEMENT_API_URL: undefined,
      }),
    ).toBeNull();
    expect(
      isProductionUpdateConfigReady({
        env: {},
        keys: new Map(),
      }),
    ).toBe(false);
  });

  it("prefers GROKDESK_MANIFEST_URL", () => {
    expect(
      resolveManifestUrlFromEnv({
        GROKDESK_MANIFEST_URL: "https://cdn.example/manifest.json",
        GROKDESK_ENTITLEMENT_API_URL: "https://api.example",
      }),
    ).toBe("https://cdn.example/manifest.json");
  });

  it("derives manifest URL from entitlement API base", () => {
    expect(
      resolveManifestUrlFromEnv({
        GROKDESK_ENTITLEMENT_API_URL: "https://api.example/v1/",
      }),
    ).toBe("https://api.example/v1/releases/manifest");
  });

  it("requires non-empty release keys", () => {
    const key = generateTestKey("release-1");
    expect(
      isProductionUpdateConfigReady({
        env: { GROKDESK_MANIFEST_URL: "https://example/m.json" },
        keys: new Map(),
      }),
    ).toBe(false);
    expect(
      isProductionUpdateConfigReady({
        env: { GROKDESK_MANIFEST_URL: "https://example/m.json" },
        keys: new Map([[key.kid, key.publicJwk]]),
      }),
    ).toBe(true);
  });

  it("tryCreate returns null when config incomplete", () => {
    expect(
      tryCreateProductionUpdateAdapters({
        userDataDir: os.tmpdir(),
        env: {},
        keys: new Map(),
        isIdle: () => true,
      }),
    ).toBeNull();
  });
});

describe("production update adapters", () => {
  let dir: string;
  let key: ReturnType<typeof generateTestKey>;
  let keys: Map<string, ReturnType<typeof generateTestKey>["publicJwk"]>;
  let artifactBody: Buffer;
  let artifactSha: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-prod-adapters-"));
    key = generateTestKey("release-1");
    keys = new Map([[key.kid, key.publicJwk]]);
    artifactBody = Buffer.from("managed-grok-binary-0.9.5\n");
    artifactSha = sha256Hex(artifactBody);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makePayload(sequence = 50) {
    const deskArt = {
      artifactId: `desk-${DESK_VERSION}-${TARGET}`,
      kind: "desk" as const,
      version: DESK_VERSION,
      target: TARGET,
      channel: "stable" as const,
      grantEndpoint: "/v1/download-grants",
      sizeBytes: 2048,
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      provenance: {
        source: "official",
        retrievedAt: "2026-07-01T00:00:00.000Z",
      },
      signingPolicy: {
        requirePlatformSignature: true,
        macTeamId: "TEAM1",
      },
      capabilities: ["desk"],
    };
    const grokArt = {
      artifactId: `grok-${GROK_VERSION}-${TARGET}`,
      kind: "grok" as const,
      version: GROK_VERSION,
      target: TARGET,
      channel: "stable" as const,
      grantEndpoint: "/v1/download-grants",
      sizeBytes: artifactBody.length,
      sha256: artifactSha,
      provenance: {
        source: "official",
        retrievedAt: "2026-07-01T00:00:00.000Z",
        officialUrl: "https://example.com/grok",
      },
      signingPolicy: {
        requirePlatformSignature: true,
        macTeamId: "TEAM1",
      },
      capabilities: ["agent", "managed-no-self-update"],
    };
    return samplePayload({
      sequence,
      issuedAt: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      channels: {
        stable: {
          desk: [deskArt],
          grok: [grokArt],
          pairs: [
            {
              pairId: `stable-${TARGET}-${DESK_VERSION}-${GROK_VERSION}`,
              channel: "stable",
              target: TARGET,
              deskVersion: DESK_VERSION,
              grokVersion: GROK_VERSION,
              deskArtifactId: deskArt.artifactId,
              grokArtifactId: grokArt.artifactId,
              capabilities: ["agent", "managed-no-self-update"],
              recommended: true,
            },
          ],
        },
      },
    });
  }

  async function withServer(
    handler: (
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) => void | Promise<void>,
    run: (baseUrl: string) => Promise<void>,
  ) {
    const server = http.createServer((req, res) => {
      void Promise.resolve(handler(req, res)).catch(() => {
        res.statusCode = 500;
        res.end("err");
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  }

  function goodSig(): PlatformSigningResult {
    return { checked: true, valid: true, teamId: "TEAM1" };
  }

  function createAdapters(
    baseUrl: string,
    overrides: Partial<Parameters<typeof createProductionUpdateAdapters>[0]> = {},
  ): ProductionUpdateAdapters {
    const store = new RuntimeStore({ userData: dir });
    store.ensureLayout();
    return createProductionUpdateAdapters({
      userDataDir: dir,
      store,
      isIdle: () => true,
      keys,
      manifestUrl: `${baseUrl}/v1/releases/manifest`,
      entitlementApiBase: baseUrl,
      isPackaged: false,
      allowDevFixtureUrls: false,
      allowHttpDownloads: true,
      getDeviceCohortId: () => "cohort-device-1",
      getActivationId: () => "act-1",
      now: () => new Date(FIXED_NOW),
      nowMs: FIXED_NOW,
      verifierDeps: {
        platform: "darwin",
        verifySignature: async () => goodSig(),
        setExecutable: (p) => {
          try {
            fs.chmodSync(p, 0o755);
          } catch {
            /* win */
          }
        },
        runProbe: async (_bin, args) => {
          if (args[0] === "--version") return probeOk(`grok ${GROK_VERSION}`);
          if (args[0] === "--help") {
            return probeOk("usage agent managed-no-self-update");
          }
          if (args[0] === "agent") {
            return probeOk("agent help managed-no-self-update");
          }
          return probeOk("");
        },
      },
      ...overrides,
    });
  }

  it("resolvePair fetches/verifies/caches manifest and returns ResolvedPairSnapshot", async () => {
    const payload = makePayload(50);
    const envelope = signEnvelope(payload, [key]);
    const expectedSha = hashManifestPayload(envelope.payloadBase64Url);

    await withServer(
      (req, res) => {
        if (req.url?.startsWith("/v1/releases/manifest")) {
          res.writeHead(200, {
            "content-type": "application/json",
            etag: '"seq-50"',
          });
          res.end(JSON.stringify(envelope));
          return;
        }
        res.statusCode = 404;
        res.end("missing");
      },
      async (baseUrl) => {
        const adapters = createAdapters(baseUrl);
        const snap = await adapters.resolvePair({
          installed: { deskVersion: "1.2.0", grokVersion: "0.9.4" },
          channel: "stable",
          target: TARGET,
        });
        expect(snap).not.toBeNull();
        expect(snap).toMatchObject({
          pairId: `stable-${TARGET}-${DESK_VERSION}-${GROK_VERSION}`,
          deskVersion: DESK_VERSION,
          grokVersion: GROK_VERSION,
          deskArtifactId: `desk-${DESK_VERSION}-${TARGET}`,
          grokArtifactId: `grok-${GROK_VERSION}-${TARGET}`,
          grokSha256: artifactSha,
          manifestSequence: 50,
          manifestPayloadSha256: expectedSha,
          updateKind: "paired",
        });
      },
    );
  });

  it("resolvePair returns null on expectedSequence drift", async () => {
    const envelope = signEnvelope(makePayload(51), [key]);
    await withServer(
      (req, res) => {
        if (req.url?.startsWith("/v1/releases/manifest")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(envelope));
          return;
        }
        res.statusCode = 404;
        res.end();
      },
      async (baseUrl) => {
        const adapters = createAdapters(baseUrl);
        const snap = await adapters.resolvePair({
          installed: { deskVersion: "1.2.0", grokVersion: "0.9.4" },
          channel: "stable",
          target: TARGET,
          expectedSequence: 50,
        });
        expect(snap).toBeNull();
      },
    );
  });

  it("resolvePair classifies grok_only when desk version matches", async () => {
    const envelope = signEnvelope(makePayload(50), [key]);
    await withServer(
      (req, res) => {
        if (req.url?.startsWith("/v1/releases/manifest")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(envelope));
          return;
        }
        res.statusCode = 404;
        res.end();
      },
      async (baseUrl) => {
        const adapters = createAdapters(baseUrl);
        const snap = await adapters.resolvePair({
          installed: { deskVersion: DESK_VERSION, grokVersion: "0.9.4" },
          channel: "stable",
          target: TARGET,
        });
        expect(snap?.updateKind).toBe("grok_only");
      },
    );
  });

  it("stageGrok grants, downloads, installs without switching pointer", async () => {
    const envelope = signEnvelope(makePayload(50), [key]);
    let grantPosts = 0;

    await withServer(
      (req, res) => {
        const url = req.url ?? "";
        if (url.startsWith("/v1/releases/manifest")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(envelope));
          return;
        }
        if (url === "/v1/download-grants" && req.method === "POST") {
          grantPosts += 1;
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              grant: "opaque-grant-token",
              expiresAt: "2026-07-10T13:00:00.000Z",
              redeemPath: "/v1/downloads/redeem",
            }),
          );
          return;
        }
        if (url.startsWith("/v1/downloads/redeem")) {
          // 302 to artifact URL on same host
          res.writeHead(302, {
            location: `http://127.0.0.1:${(req.socket.localPort as number)}/artifacts/grok.bin`,
          });
          res.end();
          return;
        }
        if (url === "/artifacts/grok.bin") {
          res.writeHead(200, {
            "content-type": "application/octet-stream",
            "content-length": String(artifactBody.length),
          });
          res.end(artifactBody);
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      },
      async (baseUrl) => {
        const adapters = createAdapters(baseUrl);
        const snap = await adapters.resolvePair({
          installed: { deskVersion: "1.2.0", grokVersion: "0.9.4" },
          channel: "stable",
          target: TARGET,
        });
        expect(snap).not.toBeNull();
        if (!snap) return;

        const staged = await adapters.stageGrok(snap);
        expect(staged.ok).toBe(true);
        if (!staged.ok) return;
        expect(staged.switched).toBe(false);
        expect(staged.staged).toMatchObject({
          kind: "grok",
          version: GROK_VERSION,
          digestSha256: artifactSha,
          sizeBytes: artifactBody.length,
        });
        expect(staged.staged.path.length).toBeGreaterThan(0);
        expect(fs.existsSync(staged.staged.path)).toBe(true);
        expect(grantPosts).toBe(1);

        // Pointer must not switch during stage.
        const store = new RuntimeStore({ userData: dir });
        expect(store.loadPointer().ok).toBe(false);

        // Switch only when coordinator authorizes.
        const switched = await adapters.switchGrokRuntime(staged.staged);
        expect(switched.ok).toBe(true);
        if (!switched.ok) return;
        const ptr = store.loadPointer();
        expect(ptr.ok).toBe(true);
        if (ptr.ok) {
          expect(ptr.pointer.current.version).toBe(GROK_VERSION);
          expect(ptr.pointer.current.digestSha256).toBe(artifactSha);
        }
      },
    );
  });

  it("stageGrok fails closed when grant is unavailable", async () => {
    const envelope = signEnvelope(makePayload(50), [key]);
    await withServer(
      (req, res) => {
        if (req.url?.startsWith("/v1/releases/manifest")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(envelope));
          return;
        }
        if (req.url === "/v1/download-grants") {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              code: "entitlement_suspended",
              message: "suspended",
              requestId: "r1",
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end();
      },
      async (baseUrl) => {
        const adapters = createAdapters(baseUrl);
        const snap = await adapters.resolvePair({
          installed: { deskVersion: "1.2.0", grokVersion: "0.9.4" },
          channel: "stable",
          target: TARGET,
        });
        expect(snap).not.toBeNull();
        if (!snap) return;
        const staged = await adapters.stageGrok(snap);
        expect(staged.ok).toBe(false);
        if (staged.ok) return;
        expect(staged.code).toMatch(/grant|download|entitlement|http|stage/i);
      },
    );
  });

  it("stageDesk grants, builds exact feed, and stages via deskUpdater", async () => {
    const envelope = signEnvelope(makePayload(50), [key]);
    const deskSha =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let grantPosts = 0;
    let lastGrantBody: { artifactId?: string } | null = null;
    const feeds: ExactDeskFeed[] = [];
    let authorized = false;
    let installCalls = 0;
    let downloaded: Extract<DeskDownloadResult, { ok: true }> | null = null;
    let stagedInstallerPath = "";

    const deskUpdater: DeskUpdater = {
      async downloadExact(feed) {
        feeds.push(feed);
        downloaded = {
          ok: true,
          version: feed.version,
          artifactId: feed.artifactId,
          sha256: feed.sha256.toLowerCase(),
          sizeBytes: feed.sizeBytes,
          path: stagedInstallerPath,
        };
        return downloaded;
      },
      authorizeInstall() {
        authorized = true;
      },
      async installOnRestart() {
        installCalls += 1;
        if (!downloaded?.ok) {
          return {
            ok: false,
            code: "not_downloaded",
            message: "no exact desk download staged",
          };
        }
        if (!authorized) {
          return {
            ok: false,
            code: "unauthorized_install",
            message: "coordinator has not authorized installOnRestart",
          };
        }
        return downloaded;
      },
      cancelDownload() {},
      isReadyToInstall: () => Boolean(downloaded?.ok && authorized),
      getDownloaded: () => downloaded,
    };

    await withServer(
      (req, res) => {
        const url = req.url ?? "";
        if (url.startsWith("/v1/releases/manifest")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(envelope));
          return;
        }
        if (url === "/v1/download-grants" && req.method === "POST") {
          grantPosts += 1;
          let body = "";
          req.on("data", (c) => {
            body += c;
          });
          req.on("end", () => {
            try {
              lastGrantBody = JSON.parse(body) as { artifactId?: string };
            } catch {
              lastGrantBody = null;
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                grant: "opaque-desk-grant",
                expiresAt: "2026-07-10T13:00:00.000Z",
                redeemPath: "/v1/downloads/redeem",
              }),
            );
          });
          return;
        }
        if (url.startsWith("/v1/downloads/redeem")) {
          // Protected exact-version Desk feed (HTTPS-shaped for production;
          // fake deskUpdater never hits the network).
          res.writeHead(200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              url: `https://updates.example.com/desk/${DESK_VERSION}/latest.yml?version=${DESK_VERSION}&grant=shortlived`,
              expiresAt: "2026-07-10T12:30:00.000Z",
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end("not found");
      },
      async (baseUrl) => {
        stagedInstallerPath = path.join(dir, "Desk-1.1.0.zip");
        const adapters = createAdapters(baseUrl, { deskUpdater });
        expect(adapters.stageDesk).toBeTypeOf("function");
        expect(adapters.installDeskOnRestart).toBeTypeOf("function");

        const snap = await adapters.resolvePair({
          installed: { deskVersion: "1.2.0", grokVersion: GROK_VERSION },
          channel: "stable",
          target: TARGET,
        });
        expect(snap).not.toBeNull();
        if (!snap) return;
        expect(snap.updateKind).toBe("desk_only");

        const authorizedDowngrade = {
          ...snap,
          allowDeskDowngrade: true,
        };

        const staged = await adapters.stageDesk(authorizedDowngrade);
        expect(staged.ok).toBe(true);
        if (!staged.ok) return;
        expect(staged.staged).toMatchObject({
          kind: "desk",
          artifactId: `desk-${DESK_VERSION}-${TARGET}`,
          version: DESK_VERSION,
          digestSha256: deskSha,
          sizeBytes: 2048,
        });
        expect(grantPosts).toBe(1);
        expect(lastGrantBody?.artifactId).toBe(`desk-${DESK_VERSION}-${TARGET}`);
        expect(feeds).toHaveLength(1);
        expect(feeds[0]).toMatchObject({
          version: DESK_VERSION,
          artifactId: `desk-${DESK_VERSION}-${TARGET}`,
          sha256: deskSha,
          sizeBytes: 2048,
          allowDowngrade: true,
        });
        expect(feeds[0]?.feedUrl).toContain(`version=${DESK_VERSION}`);
        expect(feeds[0]?.feedUrl.startsWith("https://")).toBe(true);
        // Grant tokens must not be journaled on staged path refs.
        expect(JSON.stringify(staged.staged)).not.toContain("opaque-desk-grant");
        expect(JSON.stringify(staged.staged)).not.toContain("shortlived");

        // Install only after coordinator-style authorize path.
        expect(authorized).toBe(false);
        const installed = await adapters.installDeskOnRestart(staged.staged);
        expect(installed.ok).toBe(true);
        if (!installed.ok) return;
        expect(installed.willRestart).toBe(true);
        expect(authorized).toBe(true);
        expect(installCalls).toBe(1);
      },
    );
  });

  it("stageDesk fails closed when desk grant is unavailable", async () => {
    const envelope = signEnvelope(makePayload(50), [key]);
    const deskUpdater: DeskUpdater = {
      async downloadExact() {
        throw new Error("downloadExact must not run without a grant");
      },
      authorizeInstall() {},
      async installOnRestart() {
        return { ok: false, code: "not_downloaded", message: "none" };
      },
      cancelDownload() {},
      isReadyToInstall: () => false,
      getDownloaded: () => null,
    };

    await withServer(
      (req, res) => {
        if (req.url?.startsWith("/v1/releases/manifest")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(envelope));
          return;
        }
        if (req.url === "/v1/download-grants") {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              code: "entitlement_suspended",
              message: "suspended",
              requestId: "r2",
            }),
          );
          return;
        }
        res.statusCode = 404;
        res.end();
      },
      async (baseUrl) => {
        const adapters = createAdapters(baseUrl, { deskUpdater });
        const snap = await adapters.resolvePair({
          installed: { deskVersion: "1.2.0", grokVersion: GROK_VERSION },
          channel: "stable",
          target: TARGET,
        });
        expect(snap).not.toBeNull();
        if (!snap) return;
        const staged = await adapters.stageDesk(snap);
        expect(staged.ok).toBe(false);
        if (staged.ok) return;
        expect(staged.code).toMatch(/grant|download|entitlement|http|stage/i);
      },
    );
  });

  it("installDeskOnRestart refuses when nothing was staged via deskUpdater", async () => {
    const deskUpdater: DeskUpdater = {
      async downloadExact() {
        return { ok: false, code: "not_downloaded", message: "none" };
      },
      authorizeInstall() {},
      async installOnRestart() {
        return {
          ok: false,
          code: "not_downloaded",
          message: "no exact desk download staged",
        };
      },
      cancelDownload() {},
      isReadyToInstall: () => false,
      getDownloaded: () => null,
    };
    const store = new RuntimeStore({ userData: dir });
    store.ensureLayout();
    const adapters = createProductionUpdateAdapters({
      userDataDir: dir,
      store,
      isIdle: () => true,
      keys,
      manifestUrl: "https://example.test/v1/releases/manifest",
      entitlementApiBase: "https://example.test",
      isPackaged: false,
      deskUpdater,
      now: () => new Date(FIXED_NOW),
      nowMs: FIXED_NOW,
    });

    const r = await adapters.installDeskOnRestart({
      kind: "desk",
      artifactId: `desk-${DESK_VERSION}-${TARGET}`,
      version: DESK_VERSION,
      digestSha256: "a".repeat(64),
      sizeBytes: 2048,
      path: "",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toMatch(/not_downloaded|staged_mismatch|unauthorized/i);
  });
});
