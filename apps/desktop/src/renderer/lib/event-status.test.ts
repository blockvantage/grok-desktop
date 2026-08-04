import { describe, it, expect, beforeEach } from "vitest";
import {
  emptyStreamCopy,
  eventRowIconStatus,
  isTaskActivelyWorking,
} from "./event-status.js";
import { setActiveLocale } from "@/i18n/active";

describe("eventRowIconStatus (shipped helper)", () => {
  it("maps step start to running (spinner)", () => {
    expect(eventRowIconStatus("step", { status: "start" })).toBe("running");
  });

  it("maps step end to done (check, not spinner)", () => {
    expect(eventRowIconStatus("step", { status: "end" })).toBe("done");
    expect(eventRowIconStatus("step", { status: "completed" })).toBe("done");
  });

  it("maps error to failed", () => {
    expect(eventRowIconStatus("error", { message: "boom" })).toBe("failed");
  });

  it("maps tool_result ok false to failed, ok true to done", () => {
    expect(eventRowIconStatus("tool_result", { ok: false })).toBe("failed");
    expect(eventRowIconStatus("tool_result", { ok: true })).toBe("done");
  });

  it("does not treat message as running spinner", () => {
    expect(eventRowIconStatus("message", { text: "hi" })).toBe("queued");
  });
});

describe("emptyStreamCopy (shipped helper)", () => {
  beforeEach(() => {
    setActiveLocale("en");
  });

  it("shows spinning only while the engine is running", () => {
    const c = emptyStreamCopy("running");
    expect(c.spinning).toBe(true);
    expect(c.title.length).toBeGreaterThan(3);
  });

  it("shows queued as waiting, not active thinking", () => {
    const c = emptyStreamCopy("queued");
    expect(c.spinning).toBe(false);
    expect(c.title).toBe("Queued");
    expect(c.description).toContain("not started");
  });

  it("ships localized waiting copy for queued work in every locale", () => {
    for (const locale of ["en", "de", "es", "fr", "ja", "pt", "zh"] as const) {
      setActiveLocale(locale);
      const c = emptyStreamCopy("queued");
      expect(c.spinning, locale).toBe(false);
      expect(c.title, locale).not.toBe("status.queued");
      expect(c.description, locale).not.toBe("workspace.queuedDesc");
      expect(c.description.length, locale).toBeGreaterThan(20);
    }
  });

  it("does not show spinner when task is done", () => {
    const c = emptyStreamCopy("done");
    expect(c.spinning).toBe(false);
    expect(c.title.length).toBeGreaterThan(3);
  });

  it("does not show spinner when task failed or cancelled", () => {
    expect(emptyStreamCopy("failed").spinning).toBe(false);
    expect(emptyStreamCopy("failed").title.length).toBeGreaterThan(3);
    expect(emptyStreamCopy("cancelled").spinning).toBe(false);
    expect(emptyStreamCopy("cancelled").title.length).toBeGreaterThan(3);
  });
});

describe("isTaskActivelyWorking", () => {
  it("is true only when the engine is running", () => {
    expect(isTaskActivelyWorking("running")).toBe(true);
    expect(isTaskActivelyWorking("queued")).toBe(false);
    expect(isTaskActivelyWorking("waiting_approval")).toBe(false);
    expect(isTaskActivelyWorking("done")).toBe(false);
  });
});
