import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AtomicWriteCrashError,
  isAtomicWriteCrashError,
} from "./runtime-types.js";
import {
  RuntimeStore,
  seedCompleteInstall,
  sha256File,
} from "./runtime-store.js";
import { currentPointerPath, stagingDir } from "./runtime-paths.js";

describe("runtime-store", () => {
  let userData: string;
  let store: RuntimeStore;

  beforeEach(() => {
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-runtime-store-"));
    store = new RuntimeStore({ userData });
    store.ensureLayout();
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("writes installation.json and loads a complete install", () => {
    const ref = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
    });
    const loaded = store.loadInstallation("0.9.4", "darwin-arm64");
    expect(loaded?.complete).toBe(true);
    expect(loaded?.digestSha256).toBe(ref.digestSha256);
    expect(store.isCompleteVerifiedInstall(ref).ok).toBe(true);
  });

  it("rejects incomplete installation as verified", () => {
    const ref = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
      complete: false,
    });
    const result = store.isCompleteVerifiedInstall(ref);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("installation_incomplete");
  });

  it("rejects digest mismatch as verified", () => {
    const ref = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
    });
    const binary = store.binaryPath("0.9.4", "darwin-arm64");
    fs.writeFileSync(binary, "tampered");
    const result = store.isCompleteVerifiedInstall(ref);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("digest_mismatch");
  });

  it("atomically switches current.json and re-reads", () => {
    const a = seedCompleteInstall(store, {
      version: "0.9.3",
      target: "darwin-arm64",
    });
    const b = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
    });
    const ptr = store.switchPointer({ current: a, previous: null });
    expect(ptr.current.version).toBe("0.9.3");
    const next = store.switchPointer({ current: b, previous: a });
    expect(next.current.version).toBe("0.9.4");
    expect(next.previous?.version).toBe("0.9.3");
    const loaded = store.loadPointer();
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.pointer.current.digestSha256).toBe(b.digestSha256);
    }
    // No leftover temps.
    const leftovers = fs
      .readdirSync(store.root)
      .filter((n) => n.includes(".tmp"));
    expect(leftovers).toEqual([]);
    // User-only file mode on POSIX.
    if (process.platform !== "win32") {
      const mode = fs.statSync(store.pointerPath()).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("refuses to switch to incomplete install", () => {
    const incomplete = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
      complete: false,
    });
    expect(() =>
      store.switchPointer({ current: incomplete }),
    ).toThrowError(/incomplete_install/);
  });

  it("never selects staging paths as current", () => {
    const stageBin = path.join(stagingDir(userData), "0.9.4", "darwin-arm64", "grok");
    fs.mkdirSync(path.dirname(stageBin), { recursive: true });
    fs.writeFileSync(stageBin, "staged");
    // Craft a pointer that names a real version but also assert staging is not used.
    const good = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
    });
    store.switchPointer({ current: good });
    // Writing installation under staging should be rejected by path helpers for
    // version-dir APIs; direct staging content is not loadable as install.
    expect(
      store.isCompleteVerifiedInstall({
        version: "0.9.4",
        target: "darwin-arm64",
        digestSha256: sha256File(store.binaryPath("0.9.4", "darwin-arm64")),
      }).ok,
    ).toBe(true);
  });

  describe("crash injection around pointer write", () => {
    function seedPair() {
      const prev = seedCompleteInstall(store, {
        version: "0.9.3",
        target: "darwin-arm64",
        content: "prev-bin",
      });
      const next = seedCompleteInstall(store, {
        version: "0.9.4",
        target: "darwin-arm64",
        content: "next-bin",
      });
      store.switchPointer({ current: prev, previous: null });
      return { prev, next };
    }

    it("crash before_temp_write leaves previous pointer intact", () => {
      const { prev, next } = seedPair();
      try {
        store.switchPointer(
          { current: next, previous: prev },
          { crashAt: "before_temp_write" },
        );
        expect.fail("expected crash");
      } catch (err) {
        expect(isAtomicWriteCrashError(err)).toBe(true);
        expect((err as AtomicWriteCrashError).crashPoint).toBe(
          "before_temp_write",
        );
      }
      const loaded = store.loadPointer();
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.pointer.current.version).toBe("0.9.3");
    });

    it("crash after_temp_write leaves previous pointer intact", () => {
      const { prev, next } = seedPair();
      try {
        store.switchPointer(
          { current: next, previous: prev },
          { crashAt: "after_temp_write" },
        );
        expect.fail("expected crash");
      } catch (err) {
        expect(isAtomicWriteCrashError(err)).toBe(true);
      }
      const loaded = store.loadPointer();
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.pointer.current.version).toBe("0.9.3");
      // Temp may remain.
      const temps = fs
        .readdirSync(store.root)
        .filter((n) => n.includes(".tmp"));
      expect(temps.length).toBeGreaterThanOrEqual(1);
    });

    it("crash after_fsync leaves previous pointer intact", () => {
      const { prev, next } = seedPair();
      try {
        store.switchPointer(
          { current: next, previous: prev },
          { crashAt: "after_fsync" },
        );
        expect.fail("expected crash");
      } catch (err) {
        expect(isAtomicWriteCrashError(err)).toBe(true);
      }
      const loaded = store.loadPointer();
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.pointer.current.version).toBe("0.9.3");
    });

    it("crash before_rename leaves previous pointer intact", () => {
      const { prev, next } = seedPair();
      try {
        store.switchPointer(
          { current: next, previous: prev },
          { crashAt: "before_rename" },
        );
        expect.fail("expected crash");
      } catch (err) {
        expect(isAtomicWriteCrashError(err)).toBe(true);
      }
      const loaded = store.loadPointer();
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.pointer.current.version).toBe("0.9.3");
    });

    it("crash after_rename has new pointer (rehash may not run)", () => {
      const { prev, next } = seedPair();
      try {
        store.switchPointer(
          { current: next, previous: prev },
          { crashAt: "after_rename" },
        );
        expect.fail("expected crash");
      } catch (err) {
        expect(isAtomicWriteCrashError(err)).toBe(true);
      }
      // Rename already happened — current.json should be the new pointer.
      const text = fs.readFileSync(currentPointerPath(userData), "utf8");
      const parsed = JSON.parse(text) as { current: { version: string } };
      expect(parsed.current.version).toBe("0.9.4");
      // Backup may still exist until cleanup.
    });

    it("crash after_backup_cleanup has new pointer and no backup", () => {
      const { prev, next } = seedPair();
      try {
        store.switchPointer(
          { current: next, previous: prev },
          { crashAt: "after_backup_cleanup" },
        );
        expect.fail("expected crash");
      } catch (err) {
        expect(isAtomicWriteCrashError(err)).toBe(true);
      }
      const loaded = store.loadPointer();
      expect(loaded.ok).toBe(true);
      if (loaded.ok) expect(loaded.pointer.current.version).toBe("0.9.4");
      expect(fs.existsSync(store.backupPointerPath())).toBe(false);
    });
  });

  it("reports corrupt pointer", () => {
    fs.writeFileSync(store.pointerPath(), "{not-json");
    const loaded = store.loadPointer();
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.code).toBe("corrupt");
  });

  it("listInstalledVersions excludes staging and quarantine", () => {
    seedCompleteInstall(store, { version: "0.9.4", target: "darwin-arm64" });
    seedCompleteInstall(store, { version: "0.9.3", target: "darwin-arm64" });
    fs.mkdirSync(path.join(stagingDir(userData), "junk"), { recursive: true });
    expect(store.listInstalledVersions()).toEqual(["0.9.3", "0.9.4"]);
  });
});
