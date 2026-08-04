import { describe, it, expect } from "vitest";
import { resolveDataPaths, resolveDataPathsFromProcess } from "./config.js";
import path from "node:path";

describe("resolveDataPaths", () => {
  it("uses Application Support on darwin", () => {
    const p = resolveDataPaths({
      platform: "darwin",
      home: "/Users/me",
      appData: "",
      localAppData: "",
    });
    expect(p.dataDir).toBe(
      path.join("/Users/me", "Library", "Application Support", "GrokDesk"),
    );
    expect(p.logsDir).toContain("Logs");
    expect(p.dbPath).toBe(path.join(p.dataDir, "grokdesk.sqlite"));
  });

  it("uses APPDATA on win32", () => {
    const p = resolveDataPaths({
      platform: "win32",
      home: "C:\\Users\\me",
      appData: "C:\\Users\\me\\AppData\\Roaming",
      localAppData: "C:\\Users\\me\\AppData\\Local",
    });
    expect(p.dataDir.replace(/\\/g, "/")).toMatch(/GrokDesk$/);
    expect(p.logsDir.replace(/\\/g, "/")).toMatch(/logs$/i);
    expect(p.dbPath.replace(/\\/g, "/")).toMatch(/grokdesk\.sqlite$/);
  });

  it("uses XDG-style paths on linux", () => {
    const p = resolveDataPaths({
      platform: "linux",
      home: "/home/me",
      appData: "",
      localAppData: "",
    });
    expect(p.dataDir).toBe(
      path.join("/home/me", ".local", "share", "GrokDesk"),
    );
    expect(p.logsDir).toContain("logs");
    expect(p.dbPath).toBe(path.join(p.dataDir, "grokdesk.sqlite"));
  });

  it("honors the explicit gateway data directory used by isolated E2E profiles", () => {
    const previous = process.env.GROKDESK_DATA_DIR;
    process.env.GROKDESK_DATA_DIR = "/tmp/grokdesk-isolated-gateway";
    try {
      const resolved = resolveDataPathsFromProcess();
      expect(resolved).toEqual({
        dataDir: path.resolve("/tmp/grokdesk-isolated-gateway"),
        logsDir: path.resolve("/tmp/grokdesk-isolated-gateway", "logs"),
        dbPath: path.resolve(
          "/tmp/grokdesk-isolated-gateway",
          "grokdesk.sqlite",
        ),
      });
    } finally {
      if (previous === undefined) delete process.env.GROKDESK_DATA_DIR;
      else process.env.GROKDESK_DATA_DIR = previous;
    }
  });
});
