/**
 * Streaming artifact download with bounded resume, size/digest checks,
 * redirect allowlist, timeout, cancel, and cleanup.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  downloadArtifact,
  loadPartMetadata,
  partFilePath,
  partMetaPath,
  type ArtifactDownloadRequest,
} from "./artifact-downloader.js";
import { ensureRuntimeLayout, quarantineDir, stagingDir } from "./runtime-paths.js";

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

describe("artifact-downloader", () => {
  let userData: string;
  let destDir: string;
  let quarantine: string;

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-artifact-dl-"));
    ensureRuntimeLayout(userData);
    destDir = path.join(stagingDir(userData), "art-1");
    quarantine = quarantineDir(userData);
    fs.mkdirSync(destDir, { recursive: true, mode: 0o700 });
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  async function withServer(
    handler: (
      req: http.IncomingMessage,
      res: http.ServerResponse,
    ) => void | Promise<void>,
    run: (baseUrl: string) => Promise<void>,
  ): Promise<void> {
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

  function baseRequest(
    baseUrl: string,
    body: Buffer,
    overrides: Partial<ArtifactDownloadRequest> = {},
  ): ArtifactDownloadRequest {
    return {
      artifactId: "art-1",
      url: `${baseUrl}/artifact.bin`,
      expectedSize: body.length,
      expectedSha256: sha256Hex(body),
      allowedHosts: ["127.0.0.1"],
      destDir,
      fileName: "grok",
      ...overrides,
    };
  }

  it("downloads exact length and verifies SHA-256 into final path", async () => {
    const body = Buffer.from("grok-runtime-binary-v0.9.4\n");
    await withServer(
      (req, res) => {
        expect(req.url).toBe("/artifact.bin");
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        res.setHeader("ETag", '"etag-exact"');
        res.end(body);
      },
      async (baseUrl) => {
        const result = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.sizeBytes).toBe(body.length);
        expect(result.sha256).toBe(sha256Hex(body));
        expect(result.resumed).toBe(false);
        expect(result.etag).toBe('"etag-exact"');
        expect(fs.readFileSync(result.path)).toEqual(body);
        expect(result.path).toBe(path.join(destDir, "grok"));
        // No leftover partial/meta.
        expect(fs.existsSync(partFilePath(destDir, "grok"))).toBe(false);
        expect(fs.existsSync(partMetaPath(destDir, "grok"))).toBe(false);
        if (process.platform !== "win32") {
          const mode = fs.statSync(result.path).mode & 0o777;
          expect(mode).toBe(0o600);
        }
      },
    );
  });

  it("rejects size overrun mid-stream and cleans partial", async () => {
    const expected = Buffer.from("short");
    const actual = Buffer.from("short-and-much-longer-payload");
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        // Chunked / full advertised length: client must abort at expectedSize+1
        // regardless of Content-Length (undici truncates when CL is short).
        res.setHeader("Content-Length", String(actual.length));
        res.end(actual);
      },
      async (baseUrl) => {
        const result = await downloadArtifact(
          baseRequest(baseUrl, expected, {
            expectedSize: expected.length,
            expectedSha256: sha256Hex(expected),
          }),
          { allowHttp: true },
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("size_overrun");
        expect(fs.existsSync(partFilePath(destDir, "grok"))).toBe(false);
        expect(fs.existsSync(path.join(destDir, "grok"))).toBe(false);
      },
    );
  });

  it("rejects size underrun when stream ends early", async () => {
    const full = Buffer.from("0123456789abcdef");
    const short = full.subarray(0, 8);
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        // No Content-Length: stream ends after short body so undici does not hang.
        res.end(short);
      },
      async (baseUrl) => {
        const result = await downloadArtifact(
          baseRequest(baseUrl, full, {
            expectedSize: full.length,
            expectedSha256: sha256Hex(full),
          }),
          { allowHttp: true, timeoutMs: 3_000 },
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("size_underrun");
        expect(fs.existsSync(path.join(destDir, "grok"))).toBe(false);
      },
    );
  });

  it("rejects digest mismatch and quarantines the bad partial", async () => {
    const body = Buffer.from("tampered-binary-contents\n");
    const wrongDigest = sha256Hex("expected-but-different");
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        res.end(body);
      },
      async (baseUrl) => {
        const result = await downloadArtifact(
          baseRequest(baseUrl, body, { expectedSha256: wrongDigest }),
          { allowHttp: true, quarantineDir: quarantine },
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("digest_mismatch");
        expect(fs.existsSync(path.join(destDir, "grok"))).toBe(false);
        expect(fs.existsSync(partFilePath(destDir, "grok"))).toBe(false);
        const qEntries = fs.readdirSync(quarantine);
        expect(qEntries.length).toBeGreaterThan(0);
        // Quarantined payload matches what was downloaded.
        const qFile = path.join(
          quarantine,
          qEntries.find((n) => !n.endsWith(".json")) ?? qEntries[0]!,
        );
        expect(fs.readFileSync(qFile)).toEqual(body);
      },
    );
  });

  it("rejects redirects to hosts outside the allowlist", async () => {
    const body = Buffer.from("payload");
    await withServer(
      (req, res) => {
        if (req.url === "/artifact.bin") {
          res.statusCode = 302;
          res.setHeader("Location", "http://evil.example/steal.bin");
          res.end();
          return;
        }
        res.statusCode = 404;
        res.end();
      },
      async (baseUrl) => {
        const result = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("redirect_not_allowed");
      },
    );
  });

  it("follows at most three HTTPS/HTTP redirects within allowlist", async () => {
    const body = Buffer.from("redirected-payload");
    await withServer(
      (req, res) => {
        if (req.url === "/artifact.bin") {
          res.statusCode = 302;
          res.setHeader("Location", "/r1");
          res.end();
          return;
        }
        if (req.url === "/r1") {
          res.statusCode = 302;
          res.setHeader("Location", "/r2");
          res.end();
          return;
        }
        if (req.url === "/r2") {
          res.statusCode = 302;
          res.setHeader("Location", "/r3");
          res.end();
          return;
        }
        if (req.url === "/r3") {
          res.statusCode = 200;
          res.setHeader("Content-Length", String(body.length));
          res.end(body);
          return;
        }
        // fourth hop would be too many if requested
        res.statusCode = 500;
        res.end("nope");
      },
      async (baseUrl) => {
        const ok = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
          maxRedirects: 3,
        });
        expect(ok.ok).toBe(true);

        // One more redirect exceeds the cap.
        const result = await downloadArtifact(
          {
            ...baseRequest(baseUrl, body),
            url: `${baseUrl}/artifact.bin`,
          },
          {
            allowHttp: true,
            maxRedirects: 2,
          },
        );
        // With maxRedirects=2, /artifact → /r1 → /r2 → /r3 needs 3 hops → fail
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("too_many_redirects");
      },
    );
  });

  it("does not forward auth headers across origin change on redirect", async () => {
    const body = Buffer.from("cdn-payload");
    const seenAuth: Array<string | undefined> = [];

    // Two servers: grant origin and storage origin (same host different ports = different origin).
    const storageBody = body;
    const storage = http.createServer((req, res) => {
      seenAuth.push(
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : undefined,
      );
      res.statusCode = 200;
      res.setHeader("Content-Length", String(storageBody.length));
      res.end(storageBody);
    });
    await new Promise<void>((resolve) =>
      storage.listen(0, "127.0.0.1", resolve),
    );
    const storagePort = (storage.address() as AddressInfo).port;

    try {
      await withServer(
        (req, res) => {
          seenAuth.push(
            typeof req.headers.authorization === "string"
              ? req.headers.authorization
              : undefined,
          );
          res.statusCode = 302;
          res.setHeader(
            "Location",
            `http://127.0.0.1:${storagePort}/object.bin`,
          );
          res.end();
        },
        async (baseUrl) => {
          const result = await downloadArtifact(baseRequest(baseUrl, body), {
            allowHttp: true,
            authHeaders: { Authorization: "Bearer secret-grant-token" },
          });
          expect(result.ok).toBe(true);
          // First hop (grant) had auth; second hop (storage) must not.
          expect(seenAuth[0]).toBe("Bearer secret-grant-token");
          expect(seenAuth[1]).toBeUndefined();
        },
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        storage.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("times out slow responses", async () => {
    const body = Buffer.from("slow");
    await withServer(
      (_req, res) => {
        // Never end — hang until client aborts.
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        // deliberately no res.end
      },
      async (baseUrl) => {
        const result = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
          timeoutMs: 50,
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("timeout");
      },
    );
  });

  it("honors cancellation via AbortSignal", async () => {
    const body = Buffer.from("cancel-me-please-with-enough-bytes");
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        // Stream slowly so cancel can win.
        let i = 0;
        const id = setInterval(() => {
          if (i >= body.length) {
            clearInterval(id);
            res.end();
            return;
          }
          res.write(body.subarray(i, i + 1));
          i += 1;
        }, 30);
        res.on("close", () => clearInterval(id));
      },
      async (baseUrl) => {
        const controller = new AbortController();
        const pending = downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
          signal: controller.signal,
          timeoutMs: 10_000,
        });
        setTimeout(() => controller.abort(), 40);
        const result = await pending;
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("cancelled");
      },
    );
  });

  it("maps ENOSPC to disk_full and cleans partial", async () => {
    const body = Buffer.from("disk-full-payload");
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        res.end(body);
      },
      async (baseUrl) => {
        const result = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
          writeChunk: () => {
            const err = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
            err.code = "ENOSPC";
            throw err;
          },
        });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.code).toBe("disk_full");
        expect(fs.existsSync(partFilePath(destDir, "grok"))).toBe(false);
      },
    );
  });

  it("restarts from byte 0 when server does not support ranges", async () => {
    const body = Buffer.from("full-body-without-range-support");
    // Seed a partial that would try to resume.
    const part = partFilePath(destDir, "grok");
    fs.writeFileSync(part, body.subarray(0, 8));
    fs.writeFileSync(
      partMetaPath(destDir, "grok"),
      JSON.stringify({
        schemaVersion: 1,
        artifactId: "art-1",
        expectedSha256: sha256Hex(body),
        expectedSize: body.length,
        etag: '"etag-1"',
        sourceHost: "127.0.0.1",
        sourceUrl: "http://placeholder/artifact.bin",
        bytesWritten: 8,
      }),
    );

    let sawRange = false;
    let requests = 0;
    await withServer(
      (req, res) => {
        requests += 1;
        if (req.headers.range) {
          sawRange = true;
          // Ignore range — return full 200.
          res.statusCode = 200;
          res.setHeader("Content-Length", String(body.length));
          res.setHeader("ETag", '"etag-1"');
          res.end(body);
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        res.setHeader("ETag", '"etag-1"');
        res.end(body);
      },
      async (baseUrl) => {
        // Fix meta sourceUrl to match.
        fs.writeFileSync(
          partMetaPath(destDir, "grok"),
          JSON.stringify({
            schemaVersion: 1,
            artifactId: "art-1",
            expectedSha256: sha256Hex(body),
            expectedSize: body.length,
            etag: '"etag-1"',
            sourceHost: "127.0.0.1",
            sourceUrl: `${baseUrl}/artifact.bin`,
            bytesWritten: 8,
          }),
        );
        const result = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.resumed).toBe(false);
        expect(fs.readFileSync(result.path)).toEqual(body);
        expect(sawRange).toBe(true);
        expect(requests).toBeGreaterThanOrEqual(1);
      },
    );
  });

  it("resumes with valid 206 and exact Content-Range", async () => {
    const body = Buffer.from("0123456789abcdefghij"); // 20 bytes
    const prefix = body.subarray(0, 10);
    const part = partFilePath(destDir, "grok");
    fs.writeFileSync(part, prefix);

    let rangeHeader: string | undefined;
    await withServer(
      (req, res) => {
        rangeHeader =
          typeof req.headers.range === "string" ? req.headers.range : undefined;
        if (req.headers.range === "bytes=10-") {
          const slice = body.subarray(10);
          res.statusCode = 206;
          res.setHeader(
            "Content-Range",
            `bytes 10-${body.length - 1}/${body.length}`,
          );
          res.setHeader("Content-Length", String(slice.length));
          res.setHeader("ETag", '"etag-resume"');
          res.end(slice);
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        res.setHeader("ETag", '"etag-resume"');
        res.end(body);
      },
      async (baseUrl) => {
        fs.writeFileSync(
          partMetaPath(destDir, "grok"),
          JSON.stringify({
            schemaVersion: 1,
            artifactId: "art-1",
            expectedSha256: sha256Hex(body),
            expectedSize: body.length,
            etag: '"etag-resume"',
            sourceHost: "127.0.0.1",
            sourceUrl: `${baseUrl}/artifact.bin`,
            bytesWritten: 10,
          }),
        );
        const result = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.resumed).toBe(true);
        expect(rangeHeader).toBe("bytes=10-");
        expect(fs.readFileSync(result.path)).toEqual(body);
        expect(result.sha256).toBe(sha256Hex(body));
      },
    );
  });

  it("deletes partial and restarts when ETag/artifact/digest changed", async () => {
    const oldBody = Buffer.from("old-artifact-content-xxxx");
    const newBody = Buffer.from("new-artifact-content-yyyy");
    const part = partFilePath(destDir, "grok");
    fs.writeFileSync(part, oldBody.subarray(0, 8));

    let rangeSeen = false;
    await withServer(
      (req, res) => {
        if (req.headers.range) {
          rangeSeen = true;
          res.statusCode = 200; // should not be asked after meta invalidation
          res.end(newBody);
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Length", String(newBody.length));
        res.setHeader("ETag", '"etag-new"');
        res.end(newBody);
      },
      async (baseUrl) => {
        // Meta points at different digest/etag than the request.
        fs.writeFileSync(
          partMetaPath(destDir, "grok"),
          JSON.stringify({
            schemaVersion: 1,
            artifactId: "art-OLD",
            expectedSha256: sha256Hex(oldBody),
            expectedSize: oldBody.length,
            etag: '"etag-old"',
            sourceHost: "127.0.0.1",
            sourceUrl: `${baseUrl}/artifact.bin`,
            bytesWritten: 8,
          }),
        );
        const result = await downloadArtifact(
          baseRequest(baseUrl, newBody, {
            artifactId: "art-1",
            expectedSha256: sha256Hex(newBody),
            expectedSize: newBody.length,
          }),
          { allowHttp: true },
        );
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.resumed).toBe(false);
        expect(rangeSeen).toBe(false);
        expect(fs.readFileSync(result.path)).toEqual(newBody);
      },
    );
  });

  // Second leg uses timeoutMs: 5_000; give the case headroom under suite load.
  it(
    "interrupted download leaves resumable partial + metadata",
    async () => {
    const body = Buffer.from("0123456789ABCDEFGHIJ"); // 20
    await withServer(
      (req, res) => {
        if (req.headers.range) {
          // Second attempt: complete the rest.
          const start = Number(
            String(req.headers.range).replace("bytes=", "").replace("-", ""),
          );
          const slice = body.subarray(start);
          res.statusCode = 206;
          res.setHeader(
            "Content-Range",
            `bytes ${start}-${body.length - 1}/${body.length}`,
          );
          res.setHeader("Content-Length", String(slice.length));
          res.setHeader("ETag", '"etag-int"');
          res.end(slice);
          return;
        }
        // First attempt: only send half, then hang until client timeout closes.
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        res.setHeader("ETag", '"etag-int"');
        res.write(body.subarray(0, 10));
        // never end — client times out
      },
      async (baseUrl) => {
        const first = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
          timeoutMs: 80,
        });
        expect(first.ok).toBe(false);
        if (first.ok) return;
        expect(["timeout", "size_underrun", "network_error"]).toContain(
          first.code,
        );

        // Partial should exist for resume when bytes were written.
        const part = partFilePath(destDir, "grok");
        if (fs.existsSync(part)) {
          const meta = loadPartMetadata(partMetaPath(destDir, "grok"));
          expect(meta?.artifactId).toBe("art-1");
          expect(meta?.bytesWritten).toBeGreaterThan(0);
          expect(meta?.etag).toBe('"etag-int"');
        }

        // Full download succeeds on retry (resume or restart).
        const second = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
          timeoutMs: 5_000,
        });
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(fs.readFileSync(second.path)).toEqual(body);
      },
    );
  },
    15_000,
  );

  it("rejects invalid Content-Range on 206 and restarts cleanly", async () => {
    const body = Buffer.from("range-invalid-body-data");
    fs.writeFileSync(partFilePath(destDir, "grok"), body.subarray(0, 5));
    let attempts = 0;
    await withServer(
      (req, res) => {
        attempts += 1;
        if (req.headers.range && attempts === 1) {
          res.statusCode = 206;
          res.setHeader("Content-Range", "bytes 99-199/200"); // wrong
          res.setHeader("Content-Length", "5");
          res.end("xxxxx");
          return;
        }
        // After invalid range, client restarts at 0.
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        res.setHeader("ETag", '"etag-fix"');
        res.end(body);
      },
      async (baseUrl) => {
        fs.writeFileSync(
          partMetaPath(destDir, "grok"),
          JSON.stringify({
            schemaVersion: 1,
            artifactId: "art-1",
            expectedSha256: sha256Hex(body),
            expectedSize: body.length,
            etag: '"etag-fix"',
            sourceHost: "127.0.0.1",
            sourceUrl: `${baseUrl}/artifact.bin`,
            bytesWritten: 5,
          }),
        );
        const result = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
        });
        // Either fails with range_invalid, or recovers by restarting.
        if (result.ok) {
          expect(fs.readFileSync(result.path)).toEqual(body);
        } else {
          expect(result.code).toBe("range_invalid");
        }
      },
    );
  });

  it("rejects non-allowlisted initial host", async () => {
    const body = Buffer.from("x");
    const result = await downloadArtifact(
      {
        artifactId: "art-1",
        url: "https://evil.example/artifact.bin",
        expectedSize: 1,
        expectedSha256: sha256Hex(body),
        allowedHosts: ["cdn.grokdesk.app"],
        destDir,
        fileName: "grok",
      },
      { allowHttp: false },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("host_not_allowed");
  });

  it("rejects http URLs unless allowHttp is set", async () => {
    const body = Buffer.from("x");
    const result = await downloadArtifact({
      artifactId: "art-1",
      url: "http://127.0.0.1/artifact.bin",
      expectedSize: 1,
      expectedSha256: sha256Hex(body),
      allowedHosts: ["127.0.0.1"],
      destDir,
      fileName: "grok",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_url");
  });

  it("rejects URLs with embedded credentials", async () => {
    const body = Buffer.from("x");
    const result = await downloadArtifact({
      artifactId: "art-1",
      url: "https://user:pass@cdn.example/artifact.bin",
      expectedSize: 1,
      expectedSha256: sha256Hex(body),
      allowedHosts: ["cdn.example"],
      destDir,
      fileName: "grok",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("invalid_url");
  });

  it("reports progress while streaming", async () => {
    const body = Buffer.alloc(64, 0xab);
    const progress: number[] = [];
    await withServer(
      (_req, res) => {
        res.statusCode = 200;
        res.setHeader("Content-Length", String(body.length));
        res.end(body);
      },
      async (baseUrl) => {
        const result = await downloadArtifact(baseRequest(baseUrl, body), {
          allowHttp: true,
          onProgress: (p) => progress.push(p.bytesReceived),
        });
        expect(result.ok).toBe(true);
        expect(progress.length).toBeGreaterThan(0);
        expect(progress[progress.length - 1]).toBe(body.length);
      },
    );
  });
});
