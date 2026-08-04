import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dictationLanguage } from "./use-dictation";

const here = dirname(fileURLToPath(import.meta.url));
const hookSrc = readFileSync(join(here, "use-dictation.ts"), "utf8");

describe("useDictation lifecycle", () => {
  it("stops capture and dictation IPC on unmount", () => {
    // Navigating away mid-utterance must not leave the mic / STT session open.
    expect(hookSrc).toMatch(/getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
    expect(hookSrc).toMatch(
      /void window\.grokdesk\?\.dictation\?\.stop\?\.\(\)/,
    );
  });
});

describe("dictationLanguage", () => {
  it("uses the active UI locale when no override is set", () => {
    expect(dictationLanguage(undefined, "es")).toBe("es");
    expect(dictationLanguage(undefined, "de")).toBe("de");
    expect(dictationLanguage(undefined, "ja")).toBe("ja");
  });

  it("prefers an explicit language override", () => {
    expect(dictationLanguage("fr", "es")).toBe("fr");
  });

  it("strips BCP-47 region tags (main does the same)", () => {
    expect(dictationLanguage("es-ES", "en")).toBe("es");
    expect(dictationLanguage("zh-CN", "en")).toBe("zh");
  });

  it("falls back to en on empty input", () => {
    expect(dictationLanguage("", "")).toBe("en");
    expect(dictationLanguage("   ", "  ")).toBe("en");
  });
});
