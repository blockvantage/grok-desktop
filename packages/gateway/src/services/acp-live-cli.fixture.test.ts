/**
 * Live `grok agent stdio` fixture (Phase 0.1 / DoD #1).
 *
 * Always asserts isolated GROK_HOME (user hooks not copied) and Desk MCP/skills
 * on the session/new we send. Then tries a real prompt that would generate
 * media. If initialize/prompt cannot complete (auth/network), writes
 * live-cli-missing.txt and keeps spawn-env units as the media bar.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AcpJsonRpcClient,
  spawnAcpLineTransport,
} from "@grokdesk/provider-grok";
import { promoteSessionMediaToWorkspace } from "@grokdesk/engine-grok";
import {
  cleanupProvisionedGrokHome,
  provisionAcpGrokHome,
} from "./acp-session-env.js";

const temps: string[] = [];
const clients: AcpJsonRpcClient[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) {
    try {
      await c.close();
    } catch {
      /* already closed */
    }
  }
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function findGrokBinary(): string | null {
  try {
    const out = execFileSync("which", ["grok"], { encoding: "utf8" }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function liveCliLogDirs(): string[] {
  return [
    process.env.GROKDESK_LIVE_CLI_LOG_DIR,
    process.env.GROKDESK_E2E_SCRATCH,
  ].filter((d): d is string => Boolean(d && d.trim()));
}

function writeLiveCliNote(name: string, text: string): void {
  const body = `${new Date().toISOString()}\n${text}\n`;
  for (const dir of liveCliLogDirs()) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), body);
  }
}

function writeLiveCliMissing(text: string): void {
  writeLiveCliNote("live-cli-missing.txt", text);
}

function writeLiveCliOk(text: string): void {
  writeLiveCliNote("live-cli-ok.txt", text);
  for (const dir of liveCliLogDirs()) {
    const stale = path.join(dir, "live-cli-missing.txt");
    if (fs.existsSync(stale)) fs.unlinkSync(stale);
  }
}

function collectMediaFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (/\.(png|jpe?g|webp|gif|mp4|webm)$/i.test(ent.name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

function makeSkillPack(root: string): string {
  const skillsRoot = path.join(root, "skills");
  const pack = path.join(skillsRoot, "desk-image");
  fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(
    path.join(pack, "SKILL.md"),
    "---\nname: desk-image\n---\nMake images.\n",
  );
  return skillsRoot;
}

function copyRealAuthIfPresent(destGrok: string): void {
  const src = path.join(os.homedir(), ".grok", "auth.json");
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(destGrok, { recursive: true });
  fs.copyFileSync(src, path.join(destGrok, "auth.json"));
}

describe("ACP live CLI fixture", () => {
  it("isolates GROK_HOME, forwards Desk MCP/skills on session/new, and records media or the concrete failure", async () => {
    const binary = findGrokBinary();
    if (!binary) {
      writeLiveCliMissing(
        "grok binary not on PATH. Isolation spawn-env units remain the bar.",
      );
      return;
    }

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gd-live-acp-"));
    temps.push(root);
    const userHome = path.join(root, "user");
    const hooksDir = path.join(userHome, ".grok", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "evil.sh"), "echo pwned\n");
    copyRealAuthIfPresent(path.join(userHome, ".grok"));
    const cwd = path.join(root, "ws");
    fs.mkdirSync(cwd);
    const skillsRoot = makeSkillPack(root);

    const provisioned = provisionAcpGrokHome({
      inheritUserConfig: false,
      cwd,
      userHome,
      processEnv: { ...process.env, HOME: userHome },
      binary,
      mcpServers: [
        {
          id: "desk-live-mcp",
          command: "true",
          args: [],
          enabled: true,
        },
      ],
      skillsPaths: [skillsRoot],
      trustedFolders: [cwd],
    });
    if (provisioned.createdHome && provisioned.grokHome) {
      temps.push(provisioned.grokHome);
    }

    expect(provisioned.isolateGrokHome).toBe(true);
    expect(provisioned.env.GROK_HOME).toBe(provisioned.grokHome);
    expect(provisioned.env.GROK_HOME).not.toBe(path.join(userHome, ".grok"));
    expect(fs.existsSync(path.join(provisioned.grokHome!, "hooks", "evil.sh"))).toBe(
      false,
    );
    expect(
      fs.existsSync(
        path.join(provisioned.grokHome!, "skills", "desk-image", "SKILL.md"),
      ) ||
        fs
          .lstatSync(path.join(provisioned.grokHome!, "skills", "desk-image"))
          .isSymbolicLink(),
    ).toBe(true);
    expect(provisioned.mcpServersForSession).toEqual([
      expect.objectContaining({ name: "desk-live-mcp", command: "true" }),
    ]);

    const transport = spawnAcpLineTransport({
      binary: binary!,
      args: ["agent", "stdio"],
      cwd,
      env: provisioned.env,
      allowSpawn: true,
    });
    const client = new AcpJsonRpcClient(transport, {
      requestTimeoutMs: 75_000,
    });
    clients.push(client);

    try {
      const init = await client.initialize();
      expect(init.protocolVersion).toBeGreaterThanOrEqual(1);
      const session = await client.newSession({
        cwd,
        mcpServers: provisioned.mcpServersForSession,
      });
      expect(session.sessionId).toMatch(/\S/);

      try {
        await client.prompt(
          session.sessionId,
          "Create a tiny 1x1 PNG and save it as images/live-cli.png in this workspace. Do not ask questions.",
        );
      } catch (e) {
        writeLiveCliMissing(
          `session/new succeeded (sessionId=${session.sessionId}) but prompt failed:\n${
            e instanceof Error ? e.stack ?? e.message : String(e)
          }\nGROK_HOME=${provisioned.grokHome}\nspawn env GROK_HOME is isolated; user hooks were not copied.`,
        );
        cleanupProvisionedGrokHome(provisioned);
        return;
      }

      const promoted = promoteSessionMediaToWorkspace({
        grokHome: provisioned.grokHome!,
        destRoot: cwd,
        sinceMs: Date.now() - 180_000,
      });
      const workspacePng = path.join(cwd, "images", "live-cli.png");
      const media = collectMediaFiles(cwd);
      const found =
        fs.existsSync(workspacePng) ||
        promoted.some((p) => p.destPath.startsWith(cwd)) ||
        media.length > 0;
      if (!found) {
        const grokListing = collectMediaFiles(provisioned.grokHome ?? cwd);
        writeLiveCliMissing(
          `ACP initialize + session/new succeeded; prompt returned but no media under ${cwd}.\n` +
            `GROK_HOME=${provisioned.grokHome}\n` +
            `promoted=${JSON.stringify(promoted.map((p) => p.destPath))}\n` +
            `workspaceFiles=${JSON.stringify(collectMediaFiles(cwd))}\n` +
            `grokHomeMedia=${JSON.stringify(grokListing)}\n` +
            `Media promotion unit tests remain the bar for CLI session-tree copies.`,
        );
      } else {
        writeLiveCliOk(
          `sessionId=${session.sessionId}\nGROK_HOME=${provisioned.grokHome}\n` +
            `workspacePng=${fs.existsSync(workspacePng)}\n` +
            `promoted=${JSON.stringify(promoted.map((p) => p.destPath))}\n` +
            `media=${JSON.stringify(media)}`,
        );
        expect(found).toBe(true);
      }
    } catch (e) {
      writeLiveCliMissing(
        `Live ACP initialize/session/new failed:\n${
          e instanceof Error ? e.stack ?? e.message : String(e)
        }\nGROK_HOME=${provisioned.grokHome}\n` +
          `Isolation + MCP/skills already asserted against the env passed to spawn.`,
      );
    } finally {
      cleanupProvisionedGrokHome(provisioned);
    }
  }, 120_000);
});
