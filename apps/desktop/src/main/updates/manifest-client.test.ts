import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ManifestCache } from "./manifest-cache.js";
import {
  DEFAULT_MANIFEST_MAX_BYTES,
  fetchReleaseManifest,
  fixtureUrlFromPath,
  resolveManifestUrl,
} from "./manifest-client.js";
import {
  generateTestKey,
  samplePayload,
  signEnvelope,
} from "./manifest-test-helpers.js";
import { hashManifestPayload } from "./manifest-verifier.js";

const FIXED_NOW = Date.parse("2026-07-10T12:00:00.000Z");

describe("manifest-client", () => {
  let dir: string;
  const key = generateTestKey("release-1");
  const keys = new Map([[key.kid, key.publicJwk]]);

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-manifest-client-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function makeEnvelope(sequence = 42, supportUrl?: string) {
    return signEnvelope(
      samplePayload({
        sequence,
        ...(supportUrl ? { supportUrl } : {}),
      }),
      [key],
    );
  }

  function seedCache(sequence = 42, etag = `"etag-${sequence}"`) {
    const cache = new ManifestCache({ directory: dir });
    const envelope = makeEnvelope(sequence);
    cache.store({
      envelope,
      payloadSha256: hashManifestPayload(envelope.payloadBase64Url),
      highestSequence: sequence,
      etag,
      checkedAt: "2026-07-09T00:00:00.000Z",
    });
    return { cache, envelope, etag };
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
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await run(`http://127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  }

  it("resolveManifestUrl rejects local files when packaged", () => {
    const r = resolveManifestUrl("/tmp/manifest.json", {
      isPackaged: true,
      allowDevFixtureUrls: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("local_file_rejected");
  });

  it("resolveManifestUrl rejects local files without explicit test flag", () => {
    const r = resolveManifestUrl("file:///tmp/manifest.json", {
      isPackaged: false,
      allowDevFixtureUrls: false,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("local_file_rejected");
  });

  it("packaged local-file rejection via fetchReleaseManifest", async () => {
    const cache = new ManifestCache({ directory: dir });
    const fixture = path.join(dir, "m.json");
    fs.writeFileSync(fixture, JSON.stringify(makeEnvelope()));
    const result = await fetchReleaseManifest({
      url: fixture,
      keys,
      cache,
      env: { isPackaged: true, allowDevFixtureUrls: true },
      nowMs: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("local_file_rejected");
  });

  it("loads unpackaged fixture when explicit test flag is set", async () => {
    const cache = new ManifestCache({ directory: dir });
    const fixture = path.join(dir, "m.json");
    const envelope = makeEnvelope(55);
    fs.writeFileSync(fixture, JSON.stringify(envelope));
    const result = await fetchReleaseManifest({
      url: fixtureUrlFromPath(fixture),
      keys,
      cache,
      env: { isPackaged: false, allowDevFixtureUrls: true },
      nowMs: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("fixture");
    expect(result.sequence).toBe(55);
    const loaded = cache.load();
    expect(loaded.ok).toBe(true);
  });

  it("HTTP ETag/304 reuses verified cache", async () => {
    const { cache, etag } = seedCache(42);
    let sawIfNoneMatch: string | null = null;
    await withServer(
      (req, res) => {
        sawIfNoneMatch = req.headers["if-none-match"] ?? null;
        res.statusCode = 304;
        res.end();
      },
      async (baseUrl) => {
        const result = await fetchReleaseManifest({
          url: `${baseUrl}/manifest.json`,
          keys,
          cache,
          env: { isPackaged: false },
          nowMs: FIXED_NOW,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.source).toBe("not_modified");
        expect(result.sequence).toBe(42);
        expect(sawIfNoneMatch).toBe(etag);
      },
    );
  });

  it("fetches network envelope and caches etag/sequence", async () => {
    const cache = new ManifestCache({ directory: dir });
    const envelope = makeEnvelope(70);
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader("etag", '"net-70"');
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(envelope));
      },
      async (baseUrl) => {
        const result = await fetchReleaseManifest({
          url: `${baseUrl}/manifest.json`,
          keys,
          cache,
          env: { isPackaged: false },
          nowMs: FIXED_NOW,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.source).toBe("network");
        expect(result.sequence).toBe(70);
        expect(result.etag).toBe('"net-70"');
        const loaded = cache.load();
        expect(loaded.ok).toBe(true);
        if (loaded.ok) {
          expect(loaded.record.highestSequence).toBe(70);
          expect(loaded.record.etag).toBe('"net-70"');
        }
      },
    );
  });

  it("offline valid cache serves last verified envelope", async () => {
    const { cache } = seedCache(42);
    const result = await fetchReleaseManifest({
      url: "http://127.0.0.1:1/unreachable",
      keys,
      cache,
      env: { isPackaged: false },
      nowMs: FIXED_NOW,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("cache");
    expect(result.sequence).toBe(42);
  });

  it("timed-out fetch falls back to offline cache", async () => {
    const { cache } = seedCache(42);
    const result = await fetchReleaseManifest({
      url: "http://127.0.0.1:9/hang",
      keys,
      cache,
      env: { isPackaged: false },
      nowMs: FIXED_NOW,
      timeoutMs: 30,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error("should have aborted"));
          }, 5_000);
          init?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.source).toBe("cache");
    expect(result.sequence).toBe(42);
  });

  it("timed-out fetch without cache returns network failure shape", async () => {
    const cache = new ManifestCache({ directory: dir });
    const result = await fetchReleaseManifest({
      url: "http://127.0.0.1:9/hang",
      keys,
      cache,
      env: { isPackaged: false },
      nowMs: FIXED_NOW,
      timeoutMs: 30,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["network_error", "offline_no_cache"]).toContain(result.code);
    }
  });

  it("offline with corrupt cache fails closed", async () => {
    const cache = new ManifestCache({ directory: dir });
    fs.writeFileSync(cache.filePath, "{broken");
    const result = await fetchReleaseManifest({
      url: "http://127.0.0.1:1/unreachable",
      keys,
      cache,
      env: { isPackaged: false },
      nowMs: FIXED_NOW,
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["cache_corrupt", "network_error"]).toContain(result.code);
    }
  });

  it("rejects oversized response by Content-Length", async () => {
    const cache = new ManifestCache({ directory: dir });
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-length", String(DEFAULT_MANIFEST_MAX_BYTES + 1));
        res.end("x".repeat(100));
      },
      async (baseUrl) => {
        const result = await fetchReleaseManifest({
          url: `${baseUrl}/manifest.json`,
          keys,
          cache,
          env: { isPackaged: false },
          nowMs: FIXED_NOW,
          maxBytes: 1024,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("oversized_response");
      },
    );
  });

  it("rejects oversized streamed body", async () => {
    const cache = new ManifestCache({ directory: dir });
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        // No content-length; stream a large body.
        res.write('{"schemaVersion":1,"payloadBase64Url":"');
        res.write("a".repeat(4096));
        res.end('","signatures":[]}');
      },
      async (baseUrl) => {
        const result = await fetchReleaseManifest({
          url: `${baseUrl}/manifest.json`,
          keys,
          cache,
          env: { isPackaged: false },
          nowMs: FIXED_NOW,
          maxBytes: 512,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("oversized_response");
      },
    );
  });

  it("rejects network sequence rollback against cache", async () => {
    const { cache } = seedCache(50);
    const lower = makeEnvelope(40);
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.end(JSON.stringify(lower));
      },
      async (baseUrl) => {
        const result = await fetchReleaseManifest({
          url: `${baseUrl}/manifest.json`,
          keys,
          cache,
          env: { isPackaged: false },
          nowMs: FIXED_NOW,
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.code).toBe("sequence_rollback");
      },
    );
  });

  it("rejects packaged http (non-https) URLs", () => {
    const r = resolveManifestUrl("http://example.com/m.json", {
      isPackaged: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_url");
  });
});
