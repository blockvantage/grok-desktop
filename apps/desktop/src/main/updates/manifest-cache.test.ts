import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ManifestCache,
  atomicWriteFile,
  readRawCacheFile,
} from "./manifest-cache.js";
import {
  generateTestKey,
  samplePayload,
  signEnvelope,
} from "./manifest-test-helpers.js";
import { hashManifestPayload } from "./manifest-verifier.js";

describe("manifest-cache", () => {
  let dir: string;
  const key = generateTestKey("release-1");

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-manifest-cache-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function signedRecord(sequence: number, supportUrl?: string) {
    const payload = samplePayload({
      sequence,
      ...(supportUrl ? { supportUrl } : {}),
    });
    const envelope = signEnvelope(payload, [key]);
    return {
      envelope,
      payloadSha256: hashManifestPayload(envelope.payloadBase64Url),
      highestSequence: sequence,
      checkedAt: "2026-07-10T12:00:00.000Z",
      etag: `"seq-${sequence}"`,
    };
  }

  it("returns absent when no cache file exists", () => {
    const cache = new ManifestCache({ directory: dir });
    const loaded = cache.load();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.code).toBe("absent");
  });

  it("atomically stores and reloads a verified record", () => {
    const cache = new ManifestCache({ directory: dir });
    const record = signedRecord(42);
    cache.store(record);
    const loaded = cache.load();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.record.highestSequence).toBe(42);
    expect(loaded.record.payloadSha256).toBe(record.payloadSha256);
    expect(loaded.record.etag).toBe(`"seq-42"`);
    expect(loaded.record.envelope.schemaVersion).toBe(1);
    // No leftover temp files.
    const leftovers = fs
      .readdirSync(dir)
      .filter((n) => n.includes(".tmp"));
    expect(leftovers).toEqual([]);
  });

  it("rejects sequence rollback on store", () => {
    const cache = new ManifestCache({ directory: dir });
    cache.store(signedRecord(10));
    expect(() => cache.store(signedRecord(9))).toThrowError("sequence_rollback");
    const loaded = cache.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.record.highestSequence).toBe(10);
  });

  it("rejects same sequence with different hash on store", () => {
    const cache = new ManifestCache({ directory: dir });
    cache.store(signedRecord(10, "https://a.example/s"));
    expect(() =>
      cache.store(signedRecord(10, "https://b.example/s")),
    ).toThrowError("sequence_hash_mismatch");
  });

  it("allows same sequence with identical hash (idempotent)", () => {
    const cache = new ManifestCache({ directory: dir });
    const record = signedRecord(10);
    cache.store(record);
    cache.store({ ...record, checkedAt: "2026-07-11T00:00:00.000Z" });
    const loaded = cache.load();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.record.highestSequence).toBe(10);
      expect(loaded.record.checkedAt).toBe("2026-07-11T00:00:00.000Z");
    }
  });

  it("reports corrupt cache for invalid JSON", () => {
    const cache = new ManifestCache({ directory: dir });
    atomicWriteFile(cache.filePath, "{not-json");
    const loaded = cache.load();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.code).toBe("corrupt");
  });

  it("reports corrupt cache for wrong shape", () => {
    const cache = new ManifestCache({ directory: dir });
    atomicWriteFile(
      cache.filePath,
      JSON.stringify({ highestSequence: 1, payloadSha256: "abc" }),
    );
    const loaded = cache.load();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.code).toBe("corrupt");
  });

  it("atomicWriteFile replaces existing content safely", () => {
    const file = path.join(dir, "x.json");
    atomicWriteFile(file, "one");
    atomicWriteFile(file, "two");
    expect(readRawCacheFile(file)).toBe("two");
  });
});
