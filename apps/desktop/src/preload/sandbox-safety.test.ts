import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Regression guard for the sandboxed preload (webPreferences.sandbox = true).
 *
 * In a sandboxed preload, `require` only resolves electron/events/timers/url.
 * Importing the `@grokdesk/shared` BARREL transitively pulls in Node-only
 * modules that `require("node:fs")` at load time, which throws and prevents
 * `contextBridge.exposeInMainWorld` from ever running — the renderer then sees
 * "grokdesk IPC bridge is not available" and the whole app is dead.
 *
 * The preload must import the pure channel constants from the sandbox-safe
 * leaf (`@grokdesk/shared/ipc-channels`), never the barrel.
 */
describe("preload sandbox safety", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "index.ts"),
    "utf8",
  );

  it("does not import the @grokdesk/shared barrel (drags in node:fs)", () => {
    // Matches `from "@grokdesk/shared"` but not `.../ipc-channels`, `.../node`, etc.
    const barrelImport = /from\s+["']@grokdesk\/shared["']/;
    expect(barrelImport.test(src)).toBe(false);
  });

  it("imports IPC channel constants from the sandbox-safe leaf", () => {
    expect(src).toMatch(/from\s+["']@grokdesk\/shared\/ipc-channels["']/);
  });

  it("exposes webUtils.getPathForFile for drag-and-drop", () => {
    expect(src).toMatch(/webUtils/);
    expect(src).toMatch(/getPathForFile/);
  });

  it("only requires electron built-ins (no Node core modules)", () => {
    // The preload source itself must not import Node built-ins directly.
    const nodeBuiltinImport =
      /from\s+["'](?:node:)?(?:fs|path|os|crypto|child_process|net|http|https|stream)["']/;
    expect(nodeBuiltinImport.test(src)).toBe(false);
  });
});
