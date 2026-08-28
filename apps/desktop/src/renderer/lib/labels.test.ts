import { describe, it, expect, beforeEach } from "vitest";
import {
  accountSubtitle,
  describeCron,
  engineStatusLabel,
  getCronPresets,
  setLabelsLocale,
  taskStatusLabel,
} from "./labels.js";

describe("labels", () => {
  beforeEach(() => {
    setLabelsLocale("en");
  });

  it("humanizes task status", () => {
    expect(taskStatusLabel("running")).toBe("Working");
    expect(taskStatusLabel("done")).toBe("Done");
    expect(taskStatusLabel("waiting_approval")).toBe("Needs approval");
  });

  it("humanizes engine status", () => {
    expect(engineStatusLabel("ready")).toBe("Connected");
    expect(engineStatusLabel("needs_auth")).toBe("Sign in required");
    expect(engineStatusLabel("signed_out")).toBe("Not signed in");
    expect(engineStatusLabel(null)).toBe("Checking…");
    expect(engineStatusLabel("unknown")).toBe("Checking…");
  });

  it("account subtitle is user-facing", () => {
    expect(accountSubtitle({ signedIn: true, engineStatus: "ready" })).toBe(
      "SuperGrok",
    );
    expect(accountSubtitle({ signedIn: false })).toBe("Not signed in");
    expect(
      accountSubtitle({ signedIn: false, engineStatus: "signed_out" }),
    ).toBe("Not signed in");
    expect(
      accountSubtitle({ signedIn: true, engineStatus: "needs_auth" }),
    ).toBe("Session expired");
  });

  it("switches language with setLabelsLocale", () => {
    setLabelsLocale("es");
    expect(taskStatusLabel("running")).toBe("Trabajando");
    expect(accountSubtitle({ signedIn: false })).toBe("Sin sesión");
  });

  it("localizes cron presets and describeCron", () => {
    expect(describeCron("0 8 * * *")).toBe("Daily");
    expect(getCronPresets()[0]!.label).toMatch(/weekday|9/i);
    setLabelsLocale("es");
    expect(describeCron("0 8 * * *")).toBe("Diario");
    expect(getCronPresets().some((p) => p.label === "Diario")).toBe(true);
  });

  it("prefixes unknown cron as custom schedule", () => {
    setLabelsLocale("en");
    expect(describeCron("15 3 * * 2")).toMatch(/Custom schedule/);
    expect(describeCron("15 3 * * 2")).toContain("15 3 * * 2");
  });
});
