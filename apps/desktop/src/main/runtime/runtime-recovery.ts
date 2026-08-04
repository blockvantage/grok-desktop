/**
 * Startup recovery for side-by-side Grok runtime selection.
 *
 * - Selects only a complete verified installation (never staging/quarantine).
 * - Recovers from mid-switch pointer state via backup / previous.
 * - Cleans abandoned staging when not journal-referenced.
 * - GC retains current, previous, and journal-referenced versions.
 */
import { existsSync, readdirSync, rmSync, renameSync } from "node:fs";
import path from "node:path";
import {
  assertSafeRuntimeVersion,
  grokRuntimeRoot,
  isStagingOrQuarantinePath,
  quarantineDir,
  stagingDir,
} from "./runtime-paths.js";
import {
  RuntimeStore,
  parseRuntimeCurrentPointer,
  type LoadPointerResult,
} from "./runtime-store.js";
import type {
  RuntimeCurrentPointer,
  RuntimeInstallationRef,
  RuntimeJournalRefs,
  RuntimeRecoveryResult,
} from "./runtime-types.js";

export type RecoverRuntimeOptions = {
  store: RuntimeStore;
  /** Durable update-journal references that must be retained. */
  journal?: RuntimeJournalRefs;
  /**
   * When true (default), remove abandoned staging entries not listed in
   * `journal.stagingPaths` and not under an active journal version.
   */
  cleanStaging?: boolean;
  /** When true (default), garbage-collect unreferenced version dirs. */
  gc?: boolean;
};

function trySelect(
  store: RuntimeStore,
  ref: RuntimeInstallationRef,
): { ok: true; binaryPath: string } | { ok: false; reason: string } {
  if (isStagingOrQuarantinePath(store.userData, store.binaryPath(ref.version, ref.target))) {
    return { ok: false, reason: "staging_or_quarantine" };
  }
  const result = store.isCompleteVerifiedInstall(ref);
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, binaryPath: result.binaryPath };
}

function pointerFromLoad(loaded: LoadPointerResult): RuntimeCurrentPointer | null {
  return loaded.ok ? loaded.pointer : null;
}

/**
 * Choose the best available complete installation given a candidate pointer.
 * Prefer current; fall back to previous. Never invent a third candidate.
 */
export function selectVerifiedFromPointer(
  store: RuntimeStore,
  pointer: RuntimeCurrentPointer | null,
): {
  pointer: RuntimeCurrentPointer | null;
  binaryPath: string | null;
  notes: string[];
} {
  const notes: string[] = [];
  if (!pointer) {
    notes.push("no_pointer");
    return { pointer: null, binaryPath: null, notes };
  }

  const current = trySelect(store, pointer.current);
  if (current.ok) {
    notes.push("selected_current");
    return { pointer, binaryPath: current.binaryPath, notes };
  }
  notes.push(`current_unusable:${current.reason}`);

  if (pointer.previous) {
    const prev = trySelect(store, pointer.previous);
    if (prev.ok) {
      notes.push("selected_previous");
      // Promote previous to current in the recovered view (caller may persist).
      const recovered: RuntimeCurrentPointer = {
        schemaVersion: 1,
        current: pointer.previous,
        previous: null,
        updatedAt: new Date().toISOString(),
      };
      return { pointer: recovered, binaryPath: prev.binaryPath, notes };
    }
    notes.push(`previous_unusable:${prev.reason}`);
  }

  return { pointer: null, binaryPath: null, notes };
}

/**
 * Resolve pointer after crash: prefer valid current.json, else backup, else none.
 * Strips leftover temp files.
 */
export function loadRecoverablePointer(store: RuntimeStore): {
  pointer: RuntimeCurrentPointer | null;
  notes: string[];
} {
  const notes: string[] = [];
  const temps = store.cleanupPointerTemps();
  if (temps.length > 0) {
    notes.push(`cleaned_pointer_temps:${temps.length}`);
  }

  const primary = store.loadPointer();
  if (primary.ok) {
    notes.push("loaded_current_json");
    return { pointer: primary.pointer, notes };
  }
  notes.push(`current_json:${primary.code}`);

  const backup = store.loadBackupPointer();
  if (backup.ok) {
    notes.push("loaded_backup_pointer");
    return { pointer: backup.pointer, notes };
  }
  notes.push(`backup:${backup.code}`);

  return { pointer: null, notes };
}

/**
 * Remove abandoned staging entries that are not referenced by the journal.
 */
export function cleanupAbandonedStaging(
  store: RuntimeStore,
  journal?: RuntimeJournalRefs,
): string[] {
  const staging = stagingDir(store.userData);
  if (!existsSync(staging)) return [];

  const retainPaths = new Set(
    (journal?.stagingPaths ?? []).map((p) => path.resolve(p)),
  );
  const retainVersions = new Set(journal?.versions ?? []);
  const cleaned: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(staging);
  } catch {
    return [];
  }

  for (const name of entries) {
    const full = path.resolve(staging, name);
    if (retainPaths.has(full)) continue;
    // Journal may reference a version name that is still being staged.
    if (retainVersions.has(name)) continue;
    try {
      // Move to quarantine then delete, so a concurrent reader never executes
      // a half-removed tree as if it were a runtime.
      const qRoot = quarantineDir(store.userData);
      const dest = path.join(qRoot, `staging-${name}-${Date.now()}`);
      try {
        renameSync(full, dest);
        rmSync(dest, { recursive: true, force: true });
      } catch {
        rmSync(full, { recursive: true, force: true });
      }
      cleaned.push(full);
    } catch {
      /* locked — leave for next startup */
    }
  }
  return cleaned;
}

/**
 * Garbage-collect version directories not in the retain set
 * (current, previous, journal-referenced).
 */
export function garbageCollectRuntimes(
  store: RuntimeStore,
  retain: {
    current?: RuntimeInstallationRef | null;
    previous?: RuntimeInstallationRef | null;
    journalVersions?: readonly string[];
  },
): string[] {
  const keep = new Set<string>();
  if (retain.current) {
    try {
      keep.add(assertSafeRuntimeVersion(retain.current.version));
    } catch {
      /* ignore */
    }
  }
  if (retain.previous) {
    try {
      keep.add(assertSafeRuntimeVersion(retain.previous.version));
    } catch {
      /* ignore */
    }
  }
  for (const v of retain.journalVersions ?? []) {
    try {
      keep.add(assertSafeRuntimeVersion(v));
    } catch {
      /* ignore invalid journal entries */
    }
  }

  const removed: string[] = [];
  for (const version of store.listInstalledVersions()) {
    if (keep.has(version)) continue;
    try {
      store.removeVersion(version, { force: true });
      removed.push(version);
    } catch {
      /* skip */
    }
  }
  return removed;
}

/**
 * Full startup recovery: load pointer, select complete install, clean staging, GC.
 * When previous is promoted over a broken current, rewrites current.json.
 */
export function recoverRuntime(
  options: RecoverRuntimeOptions,
): RuntimeRecoveryResult {
  const { store } = options;
  store.ensureLayout();

  const notes: string[] = [];
  const { pointer: rawPointer, notes: loadNotes } =
    loadRecoverablePointer(store);
  notes.push(...loadNotes);

  const selected = selectVerifiedFromPointer(store, rawPointer);
  notes.push(...selected.notes);

  // Persist promotion of previous → current when current was unusable.
  let pointer = selected.pointer;
  if (
    pointer &&
    rawPointer &&
    (rawPointer.current.version !== pointer.current.version ||
      rawPointer.current.digestSha256 !== pointer.current.digestSha256)
  ) {
    try {
      // previous became current; keep raw current only if it was complete (it wasn't).
      pointer = store.switchPointer({
        current: pointer.current,
        previous: null,
      });
      notes.push("persisted_previous_promotion");
    } catch (err) {
      notes.push(
        `persist_promotion_failed:${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const stagingCleaned =
    options.cleanStaging === false
      ? []
      : cleanupAbandonedStaging(store, options.journal);
  if (stagingCleaned.length > 0) {
    notes.push(`staging_cleaned:${stagingCleaned.length}`);
  }

  const gcRemoved =
    options.gc === false
      ? []
      : garbageCollectRuntimes(store, {
          current: pointer?.current,
          previous: pointer?.previous ?? rawPointer?.previous,
          journalVersions: options.journal?.versions,
        });
  if (gcRemoved.length > 0) {
    notes.push(`gc_removed:${gcRemoved.join(",")}`);
  }

  // Final guard: never return a binary under staging/quarantine.
  let binaryPath = selected.binaryPath;
  if (
    binaryPath &&
    isStagingOrQuarantinePath(store.userData, binaryPath)
  ) {
    notes.push("rejected_staging_binary");
    binaryPath = null;
    pointer = null;
  }

  return {
    pointer,
    binaryPath,
    notes,
    gcRemoved,
    stagingCleaned,
  };
}

/** Re-export parse helper for diagnostics. */
export { parseRuntimeCurrentPointer };

/** Absolute path helpers used by callers/tests. */
export function runtimeRootFor(userData: string): string {
  return grokRuntimeRoot(userData);
}
