import { describe, it, expect } from "vitest";
import { classifyEngineError, looksLikeEngineDump } from "./error-taxonomy.js";

describe("classifyEngineError", () => {
  it("detects usage pool exhausted", () => {
    expect(classifyEngineError("usage_pool_exhausted: no credits")).toEqual({
      kind: "usage_exhausted",
      retryable: false,
    });
  });

  it("detects out of credits phrasing", () => {
    expect(classifyEngineError("You are out of credits for this period")).toEqual({
      kind: "usage_exhausted",
      retryable: false,
    });
  });

  it("detects usage limit / spending cap", () => {
    expect(classifyEngineError("usage_limit_reached")).toEqual({
      kind: "usage_limit",
      retryable: false,
    });
    expect(classifyEngineError("You've hit your spending cap.")).toEqual({
      kind: "usage_limit",
      retryable: false,
    });
  });

  it("detects rate limit", () => {
    expect(classifyEngineError("Rate limited, try again")).toMatchObject({
      kind: "rate_limited",
      retryable: true,
    });
    expect(classifyEngineError("HTTP 429 too many requests")).toMatchObject({
      kind: "rate_limited",
      retryable: true,
    });
  });

  it("splits 429-style limits into capacity, team, and free usage", () => {
    expect(
      classifyEngineError("429 capacity overloaded, try again later"),
    ).toMatchObject({ kind: "rate_limited_capacity", retryable: true });
    expect(
      classifyEngineError("team limit reached for this workspace"),
    ).toMatchObject({ kind: "rate_limited_team", retryable: false });
    expect(
      classifyEngineError("free tier usage allowance exhausted"),
    ).toMatchObject({ kind: "rate_limited_free", retryable: false });
  });

  it("detects reauth", () => {
    expect(classifyEngineError("please log in / unauthorized")).toMatchObject({
      kind: "needs_reauth",
      retryable: false,
    });
    expect(classifyEngineError("401 invalid token")).toMatchObject({
      kind: "needs_reauth",
    });
  });

  it("detects context pressure", () => {
    expect(classifyEngineError("prompt too long for context window")).toMatchObject({
      kind: "context_pressure",
      retryable: true,
    });
  });

  it("defaults to generic", () => {
    expect(classifyEngineError("something weird happened")).toMatchObject({
      kind: "generic",
      retryable: false,
    });
  });

  it("flags JSON and stack dumps so UI never shows them", () => {
    expect(looksLikeEngineDump('{"error":"nope","code":-32601}')).toBe(true);
    expect(looksLikeEngineDump("Error\n    at runTurn (acp-session.ts:1:1)")).toBe(
      true,
    );
    expect(looksLikeEngineDump("Folder not found")).toBe(false);
  });

  it("detects desktop permission and disabled codes in messages", () => {
    expect(
      classifyEngineError("desktop_permission_capture: grant screen"),
    ).toMatchObject({ kind: "desktop_permission", retryable: false });
    expect(classifyEngineError("desktop_disabled_task")).toMatchObject({
      kind: "desktop_disabled",
    });
    expect(classifyEngineError("desktop_yielded")).toMatchObject({
      kind: "desktop_paused",
      retryable: true,
    });
  });
});

import { classifyDesktopCode, desktopRecoveryMessage } from "./error-taxonomy.js";

describe("classifyDesktopCode", () => {
  it("maps permission and yield codes", () => {
    expect(classifyDesktopCode("desktop_permission_input")).toMatchObject({
      kind: "desktop_permission",
    });
    expect(classifyDesktopCode("desktop_yielded")).toMatchObject({
      kind: "desktop_paused",
      retryable: true,
    });
    expect(desktopRecoveryMessage("desktop_disabled_machine")).toMatch(
      /Permissions/i,
    );
  });
});
