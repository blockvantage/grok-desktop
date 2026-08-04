import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { probeGrokCli } from "../discover.js";
import { seedIsolatedGrokHome } from "../session.js";
import { policyToGrokArgs } from "@grokdesk/shared";

const temps: string[] = [];

afterEach(() => {
  for (const d of temps.splice(0)) {
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("Grok CLI probe + isolation (GROK-01/03)", () => {
  it("probeGrokCli parses version and capability flags from a fake binary", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-probe-"));
    temps.push(dir);
    // .mjs fixture — launched via node on every platform (Windows has no shebang).
    const bin = path.join(dir, "fake-grok.mjs");
    fs.writeFileSync(
      bin,
      `const a = process.argv.slice(2);
if (a[0] === "--version") { console.log("0.2.101 (5bc4b5dfadcf)"); process.exit(0); }
if (a[0] === "--help") { console.log("Usage: grok --no-auto-update --sandbox ..."); process.exit(0); }
if (a[0] === "agent") { console.log("agent stdio mode"); process.exit(0); }
process.exit(1);
`,
      { mode: 0o755 },
    );
    const probe = await probeGrokCli(bin, { HOME: dir, PATH: dir });
    expect(probe.version).toBe("0.2.101");
    expect(probe.supportsNoAutoUpdate).toBe(true);
    expect(probe.supportsSandbox).toBe(true);
    expect(probe.supportsAgentStdio).toBe(true);
  });

  it("policyToGrokArgs includes --no-auto-update when requested", () => {
    const args = policyToGrokArgs({
      policy: {
        approvalMode: "balanced",
        workspaceRoots: ["/w"],
        allowShell: true,
        allowNetworkTools: true,
      },
      primaryCwd: "/w",
      noAutoUpdate: true,
    });
    expect(args).toContain("--no-auto-update");
  });

  it("seedIsolatedGrokHome copies auth into GROK_HOME root, not nested .grok", () => {
    // GROK_HOME defaults to ~/.grok — isolated home is a stand-in for that dir.
    const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "gd-uh-"));
    const iso = fs.mkdtempSync(path.join(os.tmpdir(), "gd-iso-"));
    temps.push(userHome, iso);
    const grok = path.join(userHome, ".grok");
    fs.mkdirSync(path.join(grok, "hooks"), { recursive: true });
    fs.mkdirSync(path.join(grok, "plugins"), { recursive: true });
    fs.writeFileSync(path.join(grok, "auth.json"), '{"ok":true}', "utf8");
    fs.writeFileSync(path.join(grok, "hooks", "evil.sh"), "echo pwn", "utf8");
    fs.writeFileSync(path.join(grok, "plugins", "x.js"), "1", "utf8");

    seedIsolatedGrokHome(iso, userHome);
    // Auth at $GROK_HOME/auth.json (CLI path), NOT $GROK_HOME/.grok/auth.json
    expect(fs.existsSync(path.join(iso, "auth.json"))).toBe(true);
    expect(fs.readFileSync(path.join(iso, "auth.json"), "utf8")).toBe(
      '{"ok":true}',
    );
    expect(fs.existsSync(path.join(iso, ".grok", "auth.json"))).toBe(false);
    expect(fs.existsSync(path.join(iso, "hooks"))).toBe(false);
    expect(fs.existsSync(path.join(iso, "plugins"))).toBe(false);
  });
});
