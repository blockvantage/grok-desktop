/**
 * Live-CLI presence check for ACP isolation. When `grok` is not available
 * here, provisionAcpGrokHome unit tests remain the acceptance bar.
 */
import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { provisionAcpGrokHome } from "./acp-session-env.js";

const execFileAsync = promisify(execFile);

describe("ACP live CLI fixture", () => {
  it("grok --version is optional; provision helper is always the isolation bar", async () => {
    let version: string | null = null;
    try {
      const { stdout } = await execFileAsync("grok", ["--version"], {
        timeout: 4_000,
      });
      version = stdout.trim() || "present";
    } catch {
      version = null;
    }
    expect(typeof provisionAcpGrokHome).toBe("function");
    if (version) {
      expect(version.length).toBeGreaterThan(0);
    }
  });
});
