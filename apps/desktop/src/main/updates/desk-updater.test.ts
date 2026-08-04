import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertExactFeed,
  createDeskUpdater,
  type ElectronUpdaterLike,
  type ExactDeskFeed,
} from "./desk-updater.js";

function sha256Hex(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

function feed(overrides: Partial<ExactDeskFeed> = {}): ExactDeskFeed {
  return {
    version: "1.1.0",
    feedUrl:
      "https://updates.example.com/desk/1.1.0/feed?grant=shortlived&version=1.1.0",
    artifactId: "art-desk-1.1.0",
    sha256: "d".repeat(64),
    sizeBytes: 12,
    ...overrides,
  };
}

function fakeUpdater(opts: {
  version?: string;
  paths?: string[];
  sha512?: string;
  checkError?: Error;
  downloadError?: Error;
  onQuit?: () => void;
} = {}): ElectronUpdaterLike & {
  quitCalls: number;
  feedUrl: string | null;
  cancelCalls: number;
} {
  const u: ElectronUpdaterLike & {
    quitCalls: number;
    feedUrl: string | null;
    cancelCalls: number;
    listeners: Map<string, Set<(...args: unknown[]) => void>>;
  } = {
    quitCalls: 0,
    feedUrl: null,
    cancelCalls: 0,
    listeners: new Map(),
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowDowngrade: true,
    setFeedURL(options) {
      u.feedUrl = options.url;
    },
    async checkForUpdates() {
      if (opts.checkError) throw opts.checkError;
      return {
        updateInfo: {
          version: opts.version ?? "1.1.0",
          sha512: opts.sha512,
          path: opts.paths?.[0],
          files: opts.paths?.map((p) => ({ url: p, size: 12 })),
        },
      };
    },
    async downloadUpdate() {
      if (opts.downloadError) throw opts.downloadError;
      return opts.paths ?? [];
    },
    quitAndInstall() {
      u.quitCalls += 1;
      opts.onQuit?.();
    },
    cancel() {
      u.cancelCalls += 1;
    },
    on(event, listener) {
      if (!u.listeners.has(event)) u.listeners.set(event, new Set());
      u.listeners.get(event)!.add(listener);
    },
    removeListener(event, listener) {
      u.listeners.get(event)?.delete(listener);
    },
  };
  return u;
}

describe("assertExactFeed", () => {
  it("rejects generic latest without version binding", () => {
    const r = assertExactFeed(
      feed({
        feedUrl: "https://updates.example.com/latest.yml",
      }),
    );
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.code).toBe("generic_latest_rejected");
  });

  it("accepts version-bound latest path with grant", () => {
    const r = assertExactFeed(
      feed({
        feedUrl:
          "https://updates.example.com/latest.yml?version=1.1.0&grant=abc",
      }),
    );
    expect(r).toBeNull();
  });

  it("rejects non-https feeds", () => {
    const r = assertExactFeed(
      feed({ feedUrl: "http://updates.example.com/desk/1.1.0/feed" }),
    );
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.code).toBe("invalid_feed");
  });
});

describe("createDeskUpdater", () => {
  let dir: string;
  let artifact: string;
  let digest: string;
  const content = Buffer.from("desk-binary!!");

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-desk-updater-"));
    artifact = path.join(dir, "Desk-1.1.0.zip");
    fs.writeFileSync(artifact, content);
    digest = sha256Hex(content);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("downloads exact version and verifies sha256", async () => {
    const auto = fakeUpdater({ version: "1.1.0", paths: [artifact] });
    const updater = createDeskUpdater({ autoUpdater: auto });
    const progress: number[] = [];

    const r = await updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
      {
        onProgress: (p) => progress.push(p.receivedBytes),
      },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.version).toBe("1.1.0");
    expect(r.sha256).toBe(digest);
    expect(r.path).toBe(artifact);
    expect(auto.autoDownload).toBe(false);
    expect(auto.autoInstallOnAppQuit).toBe(false);
    expect(auto.allowDowngrade).toBe(false);
    expect(auto.feedUrl).toContain("grant=shortlived");
  });

  it("rejects a download without a concrete installer path", async () => {
    const auto = fakeUpdater({ version: "1.1.0", paths: [] });
    const updater = createDeskUpdater({ autoUpdater: auto });
    const r = await updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("installer_path_missing");
    expect(updater.getDownloaded()).toBeNull();
  });

  it("enables downgrade only for an authorized downgrade feed", async () => {
    const auto = fakeUpdater({ version: "1.1.0", paths: [artifact] });
    const updater = createDeskUpdater({ autoUpdater: auto });
    await updater.downloadExact(
      feed({
        sha256: digest,
        sizeBytes: content.length,
        allowDowngrade: true,
      }),
    );
    expect(auto.allowDowngrade).toBe(true);
  });

  it("rejects feed that offers a different version than the resolved pair", async () => {
    const auto = fakeUpdater({ version: "9.9.9", paths: [artifact] });
    const updater = createDeskUpdater({ autoUpdater: auto });
    const r = await updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("version_mismatch");
  });

  it("rejects digest mismatch against the compatibility manifest", async () => {
    const auto = fakeUpdater({ version: "1.1.0", paths: [artifact] });
    const updater = createDeskUpdater({ autoUpdater: auto });
    const r = await updater.downloadExact(
      feed({ sha256: "0".repeat(64), sizeBytes: content.length }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("digest_mismatch");
  });

  it("cannot install without coordinator authorization", async () => {
    const auto = fakeUpdater({ version: "1.1.0", paths: [artifact] });
    const updater = createDeskUpdater({ autoUpdater: auto });
    await updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
    );
    const r = await updater.installOnRestart();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("unauthorized_install");
    expect(auto.quitCalls).toBe(0);
  });

  it("installOnRestart only after authorizeInstall and matching digest", async () => {
    const auto = fakeUpdater({ version: "1.1.0", paths: [artifact] });
    const updater = createDeskUpdater({ autoUpdater: auto });
    await updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
    );
    updater.authorizeInstall();
    const r = await updater.installOnRestart();
    expect(r.ok).toBe(true);
    expect(auto.quitCalls).toBe(1);
  });

  it("re-verifies sha256 immediately before install", async () => {
    const auto = fakeUpdater({ version: "1.1.0", paths: [artifact] });
    const updater = createDeskUpdater({ autoUpdater: auto });
    const downloaded = await updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
    );
    expect(downloaded.ok).toBe(true);
    fs.writeFileSync(artifact, Buffer.alloc(content.length, 0x78));
    updater.authorizeInstall();
    const r = await updater.installOnRestart();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("digest_mismatch");
    expect(auto.quitCalls).toBe(0);
  });

  it("cancelDownload aborts an in-flight download", async () => {
    let finishCheck!: () => void;
    const checkGate = new Promise<void>((r) => {
      finishCheck = r;
    });
    const auto = fakeUpdater({ version: "1.1.0", paths: [artifact] });
    auto.checkForUpdates = async () => {
      await checkGate;
      return { updateInfo: { version: "1.1.0", path: artifact } };
    };
    const updater = createDeskUpdater({ autoUpdater: auto });
    const pending = updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
    );
    updater.cancelDownload();
    finishCheck();
    const r = await pending;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("cancelled");
    expect(auto.cancelCalls).toBe(1);
  });

  it("single-flight download", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((r) => {
      finish = r;
    });
    const auto = fakeUpdater({ version: "1.1.0", paths: [artifact] });
    auto.checkForUpdates = async () => {
      await gate;
      return { updateInfo: { version: "1.1.0", path: artifact } };
    };
    const updater = createDeskUpdater({ autoUpdater: auto });
    const first = updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
    );
    const second = await updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("busy");
    finish();
    const done = await first;
    expect(done.ok).toBe(true);
  });

  it("rejects expired short-lived feed on install", async () => {
    let t = 1_000_000;
    const auto = fakeUpdater({ version: "1.1.0", paths: [artifact] });
    const updater = createDeskUpdater({
      autoUpdater: auto,
      now: () => t,
      maxFeedAgeMs: 1000,
    });
    await updater.downloadExact(
      feed({ sha256: digest, sizeBytes: content.length }),
    );
    updater.authorizeInstall();
    t += 5000;
    const r = await updater.installOnRestart();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("invalid_feed");
    expect(auto.quitCalls).toBe(0);
  });

  it("rejects sha512 mismatch when both sides publish it", async () => {
    const auto = fakeUpdater({
      version: "1.1.0",
      paths: [artifact],
      sha512: "aa".repeat(32),
    });
    const updater = createDeskUpdater({ autoUpdater: auto });
    const r = await updater.downloadExact(
      feed({
        sha256: digest,
        sizeBytes: content.length,
        sha512: "bb".repeat(32),
      }),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe("digest_mismatch");
  });
});
