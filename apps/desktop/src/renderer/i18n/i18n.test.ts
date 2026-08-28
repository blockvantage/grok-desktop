import { describe, it, expect } from "vitest";
import {
  ALL_LOCALES,
  CATALOG,
  DEFAULT_LOCALE,
  LOCALE_META,
  createTranslator,
  detectSystemLocale,
  flattenKeys,
  isLocaleCode,
} from "./catalog.js";
import { localizeConnector } from "./localize-connector.js";
import { setActiveLocale, t } from "./active.js";

const NON_EN_LOCALES = ALL_LOCALES.filter((c) => c !== "en");

describe("i18n safety copy", () => {
  it("onboarding Autopilot copy discloses unprompted deletes", () => {
    // Matches evaluateToolRequest: autopilot allows delete_file without approval.
    // Marketing must not claim every delete always waits for yes.
    const desc = (CATALOG.en as { onboarding?: { policyAutopilotDesc?: string } })
      .onboarding?.policyAutopilotDesc;
    expect(desc).toBeTruthy();
    expect(desc!.toLowerCase()).toMatch(/delete/);
  });

  it("memory subtitle discloses SuperGrok receives relevant items", () => {
    // Storage is local; runWithMemory still injects memory into the model preamble.
    const sub = (CATALOG.en as { memory?: { subtitle?: string } }).memory
      ?.subtitle;
    expect(sub).toBeTruthy();
    expect(sub!).toMatch(/SuperGrok/i);
    expect(sub!.toLowerCase()).toMatch(/sent|send/);
  });

  it("securityDesc names the encrypted vault and not OS keychain storage", () => {
    const desc = (
      CATALOG.en as { settings?: { securityDesc?: string } }
    ).settings?.securityDesc;
    expect(desc).toBeTruthy();
    expect(desc!.toLowerCase()).toMatch(/encrypted/);
    expect(desc!.toLowerCase()).toMatch(/not the macos keychain/);
  });
});

describe("i18n catalog (100% key coverage)", () => {
  const enKeys = flattenKeys(CATALOG.en);

  it("bans leftover i18n placeholder tokens in source", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(__dirname, "..");
    // Construct needle so this test file itself is not a false positive.
    const needle = "{" + "/* i18n */" + "}";
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === "node_modules" || name === "dist") continue;
          walk(p);
        } else if (/\.(tsx?|jsx?)$/.test(name)) {
          const text = readFileSync(p, "utf8");
          if (text.includes(needle)) hits.push(p);
        }
      }
    };
    walk(root);
    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("ALL_LOCALES matches CATALOG and LOCALE_META", () => {
    expect(ALL_LOCALES.length).toBe(LOCALE_META.length);
    expect([...ALL_LOCALES].sort()).toEqual(
      LOCALE_META.map((m) => m.code).sort(),
    );
    expect([...ALL_LOCALES].sort()).toEqual(Object.keys(CATALOG).sort());
  });

  it("ships a large English dictionary", () => {
    expect(enKeys.length).toBeGreaterThan(200);
    expect(enKeys).toContain("nav.home");
    expect(enKeys).toContain("home.ideaBrief");
    expect(enKeys).toContain("connector.filesystem.name");
    expect(enKeys).toContain("stream.working");
    expect(enKeys).toContain("workspace.approve");
    expect(enKeys).toContain("readiness.signIn.title");
    expect(enKeys).toContain("toast.regionLabel");
    expect(enKeys).toContain("toast.dismiss");
    expect(enKeys).toContain("meter.contextUsage");
    expect(enKeys).toContain("markdown.remoteImagesBlocked");
    expect(enKeys).toContain("contribute.support");
    expect(enKeys).toContain("contribute.payWhatYouWant");
    expect(enKeys).toContain("contribute.featureRequest");
  });

  it("every locale covers all English keys", () => {
    for (const code of ALL_LOCALES) {
      if (code === "en") continue;
      const keys = new Set(flattenKeys(CATALOG[code]));
      const missing = enKeys.filter((k) => !keys.has(k));
      expect(missing, `${code} missing keys: ${missing.slice(0, 8).join(", ")}`).toEqual(
        [],
      );
    }
  });

  it("desktop permissions strings are localized (not English clones)", () => {
    const enTitle = createTranslator("en")("settings.permissions.title");
    const enHud = createTranslator("en")("desktop.hudActive");
    for (const code of NON_EN_LOCALES) {
      const tr = createTranslator(code);
      expect(tr("settings.permissions.title"), code).not.toBe(enTitle);
      expect(tr("desktop.hudActive"), code).not.toBe(enHud);
      expect(tr("settings.permissions.statusGranted")).not.toBe(
        "settings.permissions.statusGranted",
      );
      expect(tr("settings.tabPermissions")).not.toBe("settings.tabPermissions");
    }
  });


  it("prose keys are translated (not English clones) across locales", () => {
    // High-signal user-facing prose that must not remain English outside en.
    const proseKeys = [
      "home.smartStarts",
      "home.composerHint",
      "tasks.emptyTitle",
      "tasks.emptyDesc",
      "memory.emptyTitle",
      "scheduled.emptyTitle",
      "inbox.emptyTitle",
      "workspace.nextActionsTitle",
      "workspace.previewTruncated",
      "stream.thoughtForAMoment",
      "stream.couldNotPreviewHint",
      "command.goTo",
      "command.stopHeading",
      "nav.chatsEmpty",
      "nav.quickChats",
      "topbar.accountSettings",
      "onboarding.stepWelcome",
      "settings.remote.title",
      "settings.tabRemote",
      "thinking.through",
      "thinking.connecting",
      "activity.openingPage",
      "activity.runningCommand",
      "activity.browsingWeb",
      "scheduled.cronWeekday9",
      "scheduled.cronDaily",
      "settings.remote.never",
      "connector.fetch.setupNotes",
      "time.justNow",
      "time.minutesAgo",
      "fileKind.file",
      "workspace.queueSendFailed",
      "workspace.queueSubmitting",
      "workspace.queueRecovering",
      "settings.remote.relayConnected",
      "settings.remote.relayConnecting",
      "toast.signedInAs",
      "nav.runsCount",
      "artifacts.count",
      "workspace.questionPick",
      "tasks.subtitle",
      "tasks.scheduled",
      "errors.generic",
      "settings.connectorsDesc",
      "scheduled.goalPlaceholder",
      "onboarding.workspaceSkip",
      "settings.tabAdvanced",
      "readiness.signIn.title",
      "toast.regionLabel",
      "toast.dismiss",
      "meter.contextUsage",
      "markdown.remoteImagesBlocked",
      // Keyboard-shortcuts sheet + onboarding copy added in the UX-review round.
      "command.shortcuts",
      "shortcuts.title",
      "shortcuts.subtitle",
      "shortcuts.groupGeneral",
      "shortcuts.groupNav",
      "shortcuts.groupChat",
      "shortcuts.groupComposer",
      "shortcuts.palette",
      "shortcuts.newChat",
      "shortcuts.help",
      "shortcuts.escape",
      "shortcuts.nav",
      "shortcuts.stop",
      "shortcuts.inbox",
      "shortcuts.copy",
      "shortcuts.pin",
      "shortcuts.slash",
      "shortcuts.mention",
      "onboarding.launchReadyFolderManaged",
    ] as const;
    const en = createTranslator("en");
    for (const code of NON_EN_LOCALES) {
      const tr = createTranslator(code);
      for (const key of proseKeys) {
        const enVal = en(key);
        const locVal = tr(key);
        expect(locVal, `${code} missing ${key}`).not.toBe(key);
        expect(locVal.length, `${code} empty ${key}`).toBeGreaterThan(0);
        // Non-Latin scripts must never equal English for these keys.
        if (code === "ja" || code === "zh") {
          expect(locVal, `${code} still English: ${key}`).not.toBe(enVal);
        } else {
          // Latin locales: at least half of prose keys must differ (cognates ok for a few).
          // Individual: if English is multi-word sentence, require translation.
          if (enVal.includes(" ") && enVal.length > 20) {
            expect(locVal, `${code} still English: ${key}`).not.toBe(enVal);
          }
        }
      }
    }
  });

  it("no locale ships empty user-facing values (except intentional empty caps/notes)", () => {
    const intentionalEmpty = new Set([
      "connector.filesystem.setupNotes",
      "connector.memory-mcp.setupNotes",
      "connector.sequential-thinking.setupNotes",
      "connector.everything.setupNotes",
      "connector.puppeteer.setupNotes",
      "connector.aws-kb.cap2",
      "connector.everything.cap2",
      "connector.postgres.cap2",
      "connector.sqlite.cap2",
    ]);
    for (const code of ALL_LOCALES) {
      const flat = flattenKeys(CATALOG[code]);
      // flattenKeys returns string[] of keys only — re-resolve via translator
      const tr = createTranslator(code);
      const empties = flat.filter((k) => {
        if (intentionalEmpty.has(k)) return false;
        const v = tr(k);
        return v === "" || v == null;
      });
      expect(empties, `${code} empty: ${empties.join(", ")}`).toEqual([]);
    }
  });

  it("createTranslator interpolates and falls back", () => {
    const tes = createTranslator("es");
    expect(tes("nav.home")).toBe("Inicio");
    expect(tes("nav.totallyMissingKey")).toBe("nav.totallyMissingKey");
    const ten = createTranslator("en");
    expect(ten("settings.title")).toBe("Settings");
    expect(ten("stream.createdOne", { name: "a.md" })).toContain("a.md");
  });

  it("detectSystemLocale maps language tags", () => {
    expect(detectSystemLocale(["es-MX", "en"])).toBe("es");
    expect(detectSystemLocale(["zh-CN"])).toBe("zh");
    expect(detectSystemLocale(["pt-BR"])).toBe("pt");
    expect(detectSystemLocale(["xx-YY"])).toBe(DEFAULT_LOCALE);
    expect(isLocaleCode("ja")).toBe(true);
    expect(isLocaleCode("nope")).toBe(false);
  });

  it("active locale drives t() and connector localization", () => {
    setActiveLocale("es");
    expect(t("nav.home")).toBe("Inicio");
    setActiveLocale("en");
    expect(t("nav.home")).toBe("Home");

    const localized = localizeConnector(
      {
        id: "filesystem",
        name: "Filesystem",
        description: "EN",
        longDescription: "EN long",
        capabilities: ["a"],
        category: "essentials",
        recommended: true,
        requiresAuth: false,
        serverId: "filesystem",
        runtime: "npx",
        command: "npx",
        args: [],
        packageName: "@modelcontextprotocol/server-filesystem",
        status: "active",
        tags: [],
        sortOrder: 1,
      },
      createTranslator("es"),
    );
    expect(localized.name).not.toBe("Filesystem");
    expect(localized.name.length).toBeGreaterThan(2);
  });
});
