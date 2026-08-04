import { afterEach, describe, expect, it } from "vitest";
import {
  getMainLocale,
  mt,
  onMainLocaleChange,
  setMainLocale,
} from "./main-i18n";

describe("main-i18n", () => {
  afterEach(() => {
    setMainLocale("en");
  });

  it("returns German tray strings after setMainLocale(de)", () => {
    setMainLocale("de");
    expect(getMainLocale()).toBe("de");
    expect(mt("trayQuit")).toBe("Beenden");
    expect(mt("trayOpen")).toBe("Grok Desk öffnen");
    expect(mt("engineReady")).toBe("Engine bereit");
  });

  it("ignores unknown locales and keeps the previous", () => {
    setMainLocale("de");
    setMainLocale("xx");
    expect(getMainLocale()).toBe("de");
    expect(mt("trayQuit")).toBe("Beenden");
  });

  it("falls back to English for known keys on en", () => {
    setMainLocale("en");
    expect(mt("dialogStartFailed")).toBe("Grok Desk failed to start");
  });

  it("uses real CJK copy that differs from English", () => {
    setMainLocale("ja");
    expect(mt("trayQuit")).toBe("終了");
    expect(mt("trayQuit")).not.toBe("Quit");
    setMainLocale("zh");
    expect(mt("trayPauseAll")).toBe("暂停所有任务");
    expect(mt("trayPauseAll")).not.toBe("Pause all tasks");
  });

  it("notifies listeners on locale change", () => {
    let n = 0;
    const off = onMainLocaleChange(() => {
      n += 1;
    });
    setMainLocale("fr");
    setMainLocale("fr"); // no-op
    setMainLocale("es");
    off();
    setMainLocale("de");
    expect(n).toBe(2);
  });
});
