import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupAbandonedStaging,
  garbageCollectRuntimes,
  loadRecoverablePointer,
  recoverRuntime,
  selectVerifiedFromPointer,
} from "./runtime-recovery.js";
import { RuntimeStore, seedCompleteInstall } from "./runtime-store.js";
import {
  CURRENT_POINTER_BACKUP_FILENAME,
  stagingDir,
} from "./runtime-paths.js";
import { isAtomicWriteCrashError } from "./runtime-types.js";

describe("runtime-recovery", () => {
  let userData: string;
  let store: RuntimeStore;

  beforeEach(() => {
    userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "grokdesk-runtime-recovery-"),
    );
    store = new RuntimeStore({ userData });
    store.ensureLayout();
  });

  afterEach(() => {
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("recovery selects only complete verified installation", () => {
    const complete = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
      content: "complete",
    });
    const incomplete = seedCompleteInstall(store, {
      version: "0.9.5",
      target: "darwin-arm64",
      content: "incomplete",
      complete: false,
    });

    // Force pointer at incomplete current with complete previous.
    const pointerPath = store.pointerPath();
    fs.writeFileSync(
      pointerPath,
      JSON.stringify({
        schemaVersion: 1,
        current: incomplete,
        previous: complete,
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
    );

    const result = recoverRuntime({ store, gc: false, cleanStaging: false });
    expect(result.binaryPath).toBe(
      store.binaryPath("0.9.4", "darwin-arm64"),
    );
    expect(result.pointer?.current.version).toBe("0.9.4");
    expect(result.notes.some((n) => n.includes("selected_previous"))).toBe(
      true,
    );

    // Incomplete-only yields no selection.
    fs.writeFileSync(
      pointerPath,
      JSON.stringify({
        schemaVersion: 1,
        current: incomplete,
        previous: null,
        updatedAt: "2026-07-16T00:00:00.000Z",
      }),
    );
    const none = recoverRuntime({ store, gc: false, cleanStaging: false });
    expect(none.binaryPath).toBeNull();
    expect(none.pointer).toBeNull();
  });

  it("never selects staging or quarantine binaries", () => {
    const good = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
    });
    store.switchPointer({ current: good });

    // Plant a staging tree that looks like a version.
    const stage = path.join(
      stagingDir(userData),
      "0.9.9",
      "darwin-arm64",
    );
    fs.mkdirSync(stage, { recursive: true });
    fs.writeFileSync(path.join(stage, "grok"), "evil");
    fs.writeFileSync(
      path.join(stage, "installation.json"),
      JSON.stringify({
        schemaVersion: 1,
        artifactId: "x",
        version: "0.9.9",
        target: "darwin-arm64",
        digestSha256: "a".repeat(64),
        sizeBytes: 4,
        provenance: { source: "t", retrievedAt: "t" },
        manifestSequence: 1,
        manifestKeyId: "k",
        installedAt: "t",
        platformSigning: { checked: true, valid: true },
        probes: [],
        complete: true,
      }),
    );

    const result = recoverRuntime({ store, gc: false });
    expect(result.pointer?.current.version).toBe("0.9.4");
    expect(result.binaryPath).not.toContain(`${path.sep}staging${path.sep}`);
  });

  it("recovers pointer after crash before rename via surviving current.json", () => {
    const prev = seedCompleteInstall(store, {
      version: "0.9.3",
      target: "darwin-arm64",
      content: "a",
    });
    const next = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
      content: "b",
    });
    store.switchPointer({ current: prev });

    try {
      store.switchPointer(
        { current: next, previous: prev },
        { crashAt: "after_fsync" },
      );
      expect.fail("expected crash");
    } catch (err) {
      expect(isAtomicWriteCrashError(err)).toBe(true);
    }

    const recovered = recoverRuntime({ store, gc: false });
    expect(recovered.pointer?.current.version).toBe("0.9.3");
    expect(recovered.binaryPath).toBe(
      store.binaryPath("0.9.3", "darwin-arm64"),
    );
    // Temps cleaned.
    const temps = fs
      .readdirSync(store.root)
      .filter((n) => n.includes(".tmp"));
    expect(temps).toEqual([]);
  });

  it("recovers from backup when current.json missing mid-switch", () => {
    const prev = seedCompleteInstall(store, {
      version: "0.9.3",
      target: "darwin-arm64",
      content: "a",
    });
    seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
      content: "b",
    });
    store.switchPointer({ current: prev });

    // Simulate: current renamed to bak, temp not yet promoted.
    const bak = path.join(store.root, CURRENT_POINTER_BACKUP_FILENAME);
    fs.renameSync(store.pointerPath(), bak);

    const loaded = loadRecoverablePointer(store);
    expect(loaded.pointer?.current.version).toBe("0.9.3");

    const recovered = recoverRuntime({ store, gc: false });
    expect(recovered.pointer?.current.version).toBe("0.9.3");
    expect(recovered.binaryPath).not.toBeNull();
  });

  it("recovers after crash after_rename to the new complete install", () => {
    const prev = seedCompleteInstall(store, {
      version: "0.9.3",
      target: "darwin-arm64",
      content: "a",
    });
    const next = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
      content: "b",
    });
    store.switchPointer({ current: prev });

    try {
      store.switchPointer(
        { current: next, previous: prev },
        { crashAt: "after_rename" },
      );
      expect.fail("expected crash");
    } catch (err) {
      expect(isAtomicWriteCrashError(err)).toBe(true);
    }

    const recovered = recoverRuntime({ store, gc: false });
    expect(recovered.pointer?.current.version).toBe("0.9.4");
    expect(recovered.binaryPath).toBe(
      store.binaryPath("0.9.4", "darwin-arm64"),
    );
  });

  it("GC retains current, previous, and journal-referenced versions", () => {
    const v92 = seedCompleteInstall(store, {
      version: "0.9.2",
      target: "darwin-arm64",
      content: "92",
    });
    const v93 = seedCompleteInstall(store, {
      version: "0.9.3",
      target: "darwin-arm64",
      content: "93",
    });
    const v94 = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
      content: "94",
    });
    seedCompleteInstall(store, {
      version: "0.9.5",
      target: "darwin-arm64",
      content: "95",
    });
    seedCompleteInstall(store, {
      version: "0.8.0",
      target: "darwin-arm64",
      content: "80",
    });

    store.switchPointer({ current: v94, previous: v93 });

    const removed = garbageCollectRuntimes(store, {
      current: v94,
      previous: v93,
      journalVersions: ["0.9.5"],
    });

    expect(removed.sort()).toEqual(["0.8.0", "0.9.2"]);
    expect(store.listInstalledVersions()).toEqual([
      "0.9.3",
      "0.9.4",
      "0.9.5",
    ]);

    // Full recoverRuntime GC path with journal.
    seedCompleteInstall(store, {
      version: "0.7.0",
      target: "darwin-arm64",
      content: "70",
    });
    const result = recoverRuntime({
      store,
      journal: { versions: ["0.9.5"] },
    });
    expect(result.gcRemoved).toContain("0.7.0");
    expect(store.listInstalledVersions()).toEqual([
      "0.9.3",
      "0.9.4",
      "0.9.5",
    ]);
    expect(result.pointer?.current.version).toBe("0.9.4");
    void v92;
  });

  it("startup removes abandoned staging only when not in the update journal", () => {
    const abandoned = path.join(stagingDir(userData), "dl-abandoned");
    const kept = path.join(stagingDir(userData), "dl-journaled");
    fs.mkdirSync(abandoned, { recursive: true });
    fs.mkdirSync(kept, { recursive: true });
    fs.writeFileSync(path.join(abandoned, "part"), "x");
    fs.writeFileSync(path.join(kept, "part"), "y");

    // Journal-referenced version name under staging.
    const stagedVersion = path.join(stagingDir(userData), "0.9.9");
    fs.mkdirSync(stagedVersion, { recursive: true });
    fs.writeFileSync(path.join(stagedVersion, "grok"), "z");

    const cleaned = cleanupAbandonedStaging(store, {
      versions: ["0.9.9"],
      stagingPaths: [kept],
    });

    expect(cleaned).toContain(abandoned);
    expect(fs.existsSync(abandoned)).toBe(false);
    expect(fs.existsSync(kept)).toBe(true);
    expect(fs.existsSync(stagedVersion)).toBe(true);
  });

  it("selectVerifiedFromPointer prefers current over previous", () => {
    const prev = seedCompleteInstall(store, {
      version: "0.9.3",
      target: "darwin-arm64",
      content: "p",
    });
    const cur = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
      content: "c",
    });
    const selected = selectVerifiedFromPointer(store, {
      schemaVersion: 1,
      current: cur,
      previous: prev,
      updatedAt: "2026-07-16T00:00:00.000Z",
    });
    expect(selected.pointer?.current.version).toBe("0.9.4");
    expect(selected.notes).toContain("selected_current");
  });

  it("rejects digest-mismatched current and falls back to previous", () => {
    const prev = seedCompleteInstall(store, {
      version: "0.9.3",
      target: "darwin-arm64",
      content: "p",
    });
    const cur = seedCompleteInstall(store, {
      version: "0.9.4",
      target: "darwin-arm64",
      content: "c",
    });
    store.switchPointer({ current: cur, previous: prev });
    // Tamper after pointer write so verification fails on recovery.
    fs.writeFileSync(store.binaryPath("0.9.4", "darwin-arm64"), "tampered");

    const result = recoverRuntime({ store, gc: false, cleanStaging: false });
    expect(result.pointer?.current.version).toBe("0.9.3");
    expect(result.binaryPath).toBe(
      store.binaryPath("0.9.3", "darwin-arm64"),
    );
  });
});
