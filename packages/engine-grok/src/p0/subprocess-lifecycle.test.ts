import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Task } from "@grokdesk/shared";
import { GrokBuildEngine, terminateChild } from "../session.js";

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

function makeTask(workspace: string): Task {
  const now = new Date().toISOString();
  return {
    id: "task-abort-sigkill",
    goal: "abort against stubborn child",
    mode: "interactive",
    status: "running",
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: [workspace],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

describe("TASK-03 / GROK-04 subprocess lifecycle", () => {
  // Windows maps kill("SIGTERM") to an unconditional force-kill; children cannot
  // trap it, so SIGTERM→SIGKILL escalation timing is POSIX-only.
  it.skipIf(process.platform === "win32")(
    "SIGTERM-ignoring child is escalated to SIGKILL and awaited",
    async () => {
      // Child traps SIGTERM and keeps running until SIGKILL.
      // Write a ready file so we only signal after the handler is installed.
      const ready = path.join(
        os.tmpdir(),
        `gd-sigterm-ready-${process.pid}-${Date.now()}`,
      );
      try {
        fs.rmSync(ready, { force: true });
      } catch {
        /* ignore */
      }

      const child = spawn(
        process.execPath,
        [
          "-e",
          `
        const fs = require('fs');
        process.on('SIGTERM', () => { /* ignore forever */ });
        fs.writeFileSync(${JSON.stringify(ready)}, 'ok');
        setInterval(() => {}, 1000);
        `,
        ],
        { stdio: "ignore" },
      );

      // Wait until the child has registered its SIGTERM handler.
      const waitReadyUntil = Date.now() + 5_000;
      while (!fs.existsSync(ready) && Date.now() < waitReadyUntil) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(fs.existsSync(ready)).toBe(true);

      const started = Date.now();
      const status = await terminateChild(child, 250);
      const elapsed = Date.now() - started;
      expect(["exited", "killed"]).toContain(status);
      // Must have waited past the SIGTERM deadline before escalating.
      expect(elapsed).toBeGreaterThanOrEqual(200);
      // Process must be gone.
      expect(child.exitCode != null || child.signalCode != null).toBe(true);
      try {
        fs.rmSync(ready, { force: true });
      } catch {
        /* ignore */
      }
    },
    15_000,
  );

  it("cooperative child exits on SIGTERM without needing SIGKILL", async () => {
    const child = spawn(
      process.execPath,
      ["-e", "setTimeout(() => {}, 30_000)"],
      { stdio: "ignore" },
    );
    // Give the event loop a tick to start.
    await new Promise((r) => setTimeout(r, 50));
    const status = await terminateChild(child, 2_000);
    expect(["exited", "killed"]).toContain(status);
    expect(child.exitCode != null || child.signalCode != null).toBe(true);
  }, 10_000);

  it("handleLine abort escalates SIGTERM→SIGKILL so run() settles (F12)", async () => {
    // Fake CLI: passes probe, emits one stream event, then keeps running.
    // onEvent returns "abort" for that event — must not hang on bare SIGTERM.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-abort-sigkill-"));
    temps.push(dir);
    const workspace = path.join(dir, "ws");
    fs.mkdirSync(workspace);
    const binary = path.join(dir, "fake-grok.mjs");
    const stubborn =
      process.platform === "win32"
        ? // Windows cannot ignore SIGTERM; just stay alive until force-killed.
          `setInterval(() => {}, 60_000);`
        : `process.on("SIGTERM", () => { /* ignore forever — forces SIGKILL escalation */ });
setInterval(() => {}, 60_000);`;
    fs.writeFileSync(
      binary,
      `const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("0.2.101"); process.exit(0); }
if (args[0] === "--help") { console.log("Usage: grok --no-auto-update --sandbox"); process.exit(0); }
if (args[0] === "agent" && (args[1] === "--help" || args.includes("--help"))) {
  console.log("agent stdio"); process.exit(0);
}
${stubborn}
// Streaming-json line that becomes a message event → onEvent returns "abort".
console.log(JSON.stringify({ type: "text", data: "abort-me-now" }));
`,
      { mode: 0o755 },
    );

    const engine = new GrokBuildEngine({ binary });
    const started = Date.now();
    const runP = engine.run({
      task: makeTask(workspace),
      systemPreamble: "",
      onEvent: async (ev) => {
        if (ev.type === "message") return "abort";
        return "continue";
      },
    });

    // Must settle: terminateChild(2s) + kill wait, not hang forever.
    let timedOut = false;
    await Promise.race([
      runP,
      new Promise<void>((_, reject) =>
        setTimeout(() => {
          timedOut = true;
          reject(new Error("run() hung after onEvent abort (no SIGKILL escalate)"));
        }, 12_000),
      ),
    ]);
    expect(timedOut).toBe(false);
    const elapsed = Date.now() - started;
    // On POSIX, escalation deadline is 2s. On Windows, SIGTERM force-kills immediately.
    if (process.platform === "win32") {
      expect(elapsed).toBeLessThan(12_000);
    } else {
      expect(elapsed).toBeGreaterThanOrEqual(1_500);
      expect(elapsed).toBeLessThan(12_000);
    }
  }, 20_000);
});
