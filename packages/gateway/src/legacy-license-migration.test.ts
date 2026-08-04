import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LegacyActivationState } from "./services/settings.js";
import { openDatabase, type Db } from "./db.js";
import { SettingsService } from "./services/settings.js";
import {
  LEGACY_MIGRATION_SUNSET_ISO,
  LEGACY_MIGRATION_SUPPORT_URL,
  assertNoLicenseCanariesInDb,
  classifyLegacyKey,
  detectLegacyLicense,
  detectLegacyLicenseInDb,
  extractLegacyLicense,
  fingerprintLegacyMaterial,
  isLegacyExchangeOpen,
  openLegacyMigrationDb,
  purgeLegacyLicense,
  scanDbFilesForLicenseCanaries,
} from "./legacy-license-migration.js";

const GD2_KEY = "GD2.legacy-allowlist-body.SIG_LEGACY_GD2_CANARY";
const GD1_KEY = "GD1.legacy-body.SIG_LEGACY_GD1_CANARY";
const DEV_KEY = "DEV-unsigned-local-test-key";
const ACT_SIG = "H1.activation-sig-canary-NEVER-LEAK-ABCDEF";

function makeActivation(
  overrides: Partial<LegacyActivationState> & { key: string },
): LegacyActivationState {
  const now = new Date().toISOString();
  return {
    key: overrides.key,
    licenseId: overrides.licenseId ?? "lic-legacy-001",
    email: overrides.email ?? null,
    machineId: overrides.machineId ?? "machine-abc",
    activatedAt: overrides.activatedAt ?? now,
    lastVerifiedAt: overrides.lastVerifiedAt ?? now,
    graceUntil:
      overrides.graceUntil ??
      new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
    product: "grokdesk",
    activationSig: overrides.activationSig,
  };
}

describe("classifyLegacyKey", () => {
  it("classifies GD2 / GD1 / H1 / dev / unrecognized / none", () => {
    expect(classifyLegacyKey(GD2_KEY)).toBe("gd2");
    expect(classifyLegacyKey(GD1_KEY)).toBe("gd1");
    expect(classifyLegacyKey(ACT_SIG)).toBe("h1");
    expect(classifyLegacyKey(DEV_KEY)).toBe("dev");
    expect(classifyLegacyKey("test-local-key")).toBe("dev");
    expect(classifyLegacyKey("random-blob")).toBe("unrecognized");
    expect(classifyLegacyKey("")).toBe("none");
    expect(classifyLegacyKey(null)).toBe("none");
  });
});

describe("detectLegacyLicense", () => {
  it("returns none when no license", () => {
    expect(detectLegacyLicense(null)).toEqual({ status: "none" });
    expect(detectLegacyLicense(undefined)).toEqual({ status: "none" });
  });

  it("marks allowlisted-format GD2 as exchangeable", () => {
    const d = detectLegacyLicense(makeActivation({ key: GD2_KEY }));
    expect(d.status).toBe("exchangeable");
    if (d.status !== "exchangeable") return;
    expect(d.scheme).toBe("gd2");
    expect(d.material.key).toBe(GD2_KEY);
    expect(d.fingerprint).toMatch(/^[a-f0-9]{24}$/);
    expect(d.fingerprint).toBe(
      fingerprintLegacyMaterial({ key: GD2_KEY, licenseId: "lic-legacy-001" }),
    );
  });

  it("rejects GD1/H1/dev with support links and never marks exchangeable", () => {
    for (const [key, reason] of [
      [GD1_KEY, "gd1"],
      ["H1.only-sig-as-key", "h1"],
      [DEV_KEY, "dev"],
      ["weird-key-material", "unrecognized"],
    ] as const) {
      const d = detectLegacyLicense(
        makeActivation({ key, activationSig: ACT_SIG }),
      );
      expect(d.status).toBe("unsupported");
      if (d.status !== "unsupported") return;
      expect(d.reason).toBe(reason);
      expect(d.supportUrl).toBe(LEGACY_MIGRATION_SUPPORT_URL);
      expect(d.portalUrl).toContain("portal");
    }
  });
});

describe("isLegacyExchangeOpen", () => {
  it("is open before sunset and closed after", () => {
    expect(isLegacyExchangeOpen(new Date("2026-06-01T00:00:00.000Z"))).toBe(
      true,
    );
    expect(isLegacyExchangeOpen(new Date(LEGACY_MIGRATION_SUNSET_ISO))).toBe(
      true,
    );
    expect(isLegacyExchangeOpen(new Date("2027-01-01T00:00:00.000Z"))).toBe(
      false,
    );
  });
});

describe("legacy extract + purge (SQLite)", () => {
  let dir: string;
  let dbPath: string;
  let db: Db;
  let settings: SettingsService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-legacy-mig-"));
    dbPath = path.join(dir, "grokdesk.sqlite");
    db = openDatabase(dbPath);
    settings = new SettingsService(db);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function seedPreservedData(): void {
    settings.set({
      maxConcurrentTasks: 5,
      defaultModel: "grok-preserve-me",
      onboardingCompleted: true,
      preferProviderEngine: true,
    });
    // SuperGrok / remote-ish rows that must survive.
    db.prepare(
      `INSERT INTO conversations (id, title, provider_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "conv-1",
      "keep-me",
      "grok",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.prepare(
      `INSERT INTO tasks (
         id, goal, mode, status, model, effort, policy_json,
         skills_json, mcp_json, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "task-1",
      "preserve goal",
      "agent",
      "done",
      "grok-4.5",
      "normal",
      "{}",
      "[]",
      "[]",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    db.prepare(
      `INSERT INTO artifacts (id, task_id, title, kind, path, mime_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "art-1",
      "task-1",
      "report",
      "file",
      "/tmp/report.md",
      "text/markdown",
      new Date().toISOString(),
    );
    db.prepare(
      `INSERT INTO remote_devices (
         id, label, public_key, device_token_hash, created_at
       ) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "remote-1",
      "phone",
      "pk",
      "hash",
      new Date().toISOString(),
    );
    // Preference-like memory / inbox
    db.prepare(
      `INSERT INTO memory_items (id, kind, title, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "mem-1",
      "note",
      "pref",
      "user likes dark mode",
      new Date().toISOString(),
      new Date().toISOString(),
    );
  }

  it("detects no legacy data", () => {
    expect(detectLegacyLicenseInDb(db)).toEqual({ status: "none" });
    const extracted = extractLegacyLicense(db);
    expect(extracted.extracted).toBe(false);
    expect(extracted.detection.status).toBe("none");
  });

  it("extracts allowlisted-format GD2 once without mutating SQLite", () => {
    seedPreservedData();
    settings.setLicense(
      makeActivation({ key: GD2_KEY, activationSig: ACT_SIG }),
    );

    const first = extractLegacyLicense(db);
    expect(first.extracted).toBe(true);
    expect(first.detection.status).toBe("exchangeable");
    if (first.detection.status !== "exchangeable") return;
    expect(first.detection.material.key).toBe(GD2_KEY);
    expect(first.detection.material.activationSig).toBe(ACT_SIG);

    // Still present until purge
    expect(settings.getAll().license?.key).toBe(GD2_KEY);
    expect(scanDbFilesForLicenseCanaries(dbPath).length).toBeGreaterThan(0);
  });

  it("purges GD2 with secure_delete + WAL checkpoint and leaves no canaries", () => {
    seedPreservedData();
    settings.setLicense(
      makeActivation({ key: GD2_KEY, activationSig: ACT_SIG }),
    );
    // Force WAL content
    settings.set({ defaultEffort: "heavy" });

    const result = purgeLegacyLicense(db, { vacuum: true });
    expect(result.purged).toBe(true);
    expect(result.alreadyClean).toBe(false);
    expect(result.secureDelete).toBe(true);
    expect(result.walCheckpoint).toBe(true);
    expect(result.vacuumed).toBe(true);
    expect(settings.getAll().license).toBeNull();

    // Flush and canary-scan on-disk files
    db.close();
    assertNoLicenseCanariesInDb(dbPath);
    expect(scanDbFilesForLicenseCanaries(dbPath)).toEqual([]);

    // Reopen and verify preservation
    db = openDatabase(dbPath);
    settings = new SettingsService(db);
    const all = settings.getAll();
    expect(all.license).toBeNull();
    expect(all.maxConcurrentTasks).toBe(5);
    expect(all.defaultModel).toBe("grok-preserve-me");
    expect(all.onboardingCompleted).toBe(true);
    expect(all.preferProviderEngine).toBe(true);

    const conv = db
      .prepare(`SELECT title FROM conversations WHERE id = ?`)
      .get("conv-1") as { title: string };
    expect(conv.title).toBe("keep-me");
    const task = db
      .prepare(`SELECT goal FROM tasks WHERE id = ?`)
      .get("task-1") as { goal: string };
    expect(task.goal).toBe("preserve goal");
    const art = db
      .prepare(`SELECT title FROM artifacts WHERE id = ?`)
      .get("art-1") as { title: string };
    expect(art.title).toBe("report");
    const remote = db
      .prepare(`SELECT label FROM remote_devices WHERE id = ?`)
      .get("remote-1") as { label: string };
    expect(remote.label).toBe("phone");
    const mem = db
      .prepare(`SELECT content FROM memory_items WHERE id = ?`)
      .get("mem-1") as { content: string };
    expect(mem.content).toBe("user likes dark mode");
  });

  it("purges GD1/dev material and is idempotent", () => {
    settings.setLicense(makeActivation({ key: GD1_KEY, activationSig: ACT_SIG }));
    const once = purgeLegacyLicense(db, { vacuum: true });
    expect(once.purged).toBe(true);
    const twice = purgeLegacyLicense(db, { vacuum: true });
    expect(twice.purged).toBe(false);
    expect(twice.alreadyClean).toBe(true);
    db.close();
    assertNoLicenseCanariesInDb(dbPath);
    db = openDatabase(dbPath);
  });

  it("openLegacyMigrationDb provides detect/extract/purge without full Gateway", () => {
    const handle = openLegacyMigrationDb(path.join(dir, "alt.sqlite"), openDatabase);
    try {
      expect(handle.detect().status).toBe("none");
      new SettingsService(handle.db).setLicense(
        makeActivation({ key: GD2_KEY }),
      );
      const ex = handle.extract();
      expect(ex.detection.status).toBe("exchangeable");
      const purged = handle.purge({ vacuum: true });
      expect(purged.purged).toBe(true);
    } finally {
      handle.close();
    }
  });
});
