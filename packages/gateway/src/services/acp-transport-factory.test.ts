import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createLiveAcpTransportFactory,
  acpSpawnArgsForSession,
  acpProtectionForSession,
} from "./acp-transport-factory.js";
import type { SessionInput } from "@grokdesk/agent-runtime";
import type { AcpLineTransport } from "@grokdesk/provider-grok";

const transports: AcpLineTransport[] = [];

afterEach(async () => {
  for (const t of transports.splice(0)) {
    await t.close();
  }
});

function stubTransport(): AcpLineTransport {
  const t: AcpLineTransport = {
    writeLine() {},
    onLine: () => () => {},
    close: async () => {},
  };
  transports.push(t);
  return t;
}

function session(
  over: Partial<SessionInput> & {
    approvalMode?: "strict" | "balanced" | "autopilot";
  } = {},
): SessionInput {
  const approvalMode = over.approvalMode ?? "balanced";
  return {
    ref: { providerId: "grok", modelId: "grok-4.5" },
    cwd: "/ws",
    workspaceRoots: ["/ws"],
    policy: {
      version: "1",
      approvalMode,
      workspaceRoots: ["/ws"],
      capabilities: [
        { id: "shell", decision: "ask" },
        { id: "network", decision: "allow" },
      ],
    },
    inheritUserConfig: false,
    ...over,
  };
}

describe("createLiveAcpTransportFactory", () => {
  it("returns null when binary discovery fails", async () => {
    const live = await createLiveAcpTransportFactory({
      findBinary: async () => null,
      probe: async () => {
        throw new Error("unreachable");
      },
    });
    expect(live).toBeNull();
  });

  it("returns null when probe lacks agent stdio", async () => {
    const live = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => ({ supportsAgentStdio: false }),
    });
    expect(live).toBeNull();
  });

  it("returns factory + probe flags when stdio is supported", async () => {
    const live = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => ({
        supportsAgentStdio: true,
        supportsSandbox: false,
      }),
      spawn: (opts) => {
        expect(opts.binary).toBe("/usr/local/bin/grok");
        expect(opts.allowSpawn).toBe(true);
        return stubTransport();
      },
    });
    expect(live).not.toBeNull();
    expect(live!.supportsSandbox).toBe(false);
    await live!.factory(session());
  });

  it("passes --sandbox when probe supportsSandbox (T1 ACP)", async () => {
    let captured: string[] | undefined;
    const live = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => ({
        supportsAgentStdio: true,
        supportsSandbox: true,
      }),
      spawn: (opts) => {
        captured = opts.args;
        return stubTransport();
      },
    });
    expect(live).not.toBeNull();
    expect(live!.supportsSandbox).toBe(true);
    await live!.factory(session());
    expect(captured).toBeDefined();
    expect(captured![0]).toBe("agent");
    expect(captured![1]).toBe("stdio");
    expect(captured).toContain("--sandbox");
    expect(captured![captured!.indexOf("--sandbox") + 1]).toBe("workspace");
  });

  it("omits --sandbox when probe does not support sandbox (T1 ACP)", async () => {
    let captured: string[] | undefined;
    const live = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => ({
        supportsAgentStdio: true,
        supportsSandbox: false,
      }),
      spawn: (opts) => {
        captured = opts.args;
        return stubTransport();
      },
    });
    await live!.factory(session());
    expect(live!.supportsSandbox).toBe(false);
    expect(captured).not.toContain("--sandbox");
  });

  it("returns null when managed CLI is older than the minimum", async () => {
    const live = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => ({
        supportsAgentStdio: true,
        version: "0.2.93",
      }),
    });
    expect(live).toBeNull();
  });

  it("returns null when probe throws", async () => {
    const live = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => {
        throw new Error("probe failed");
      },
    });
    expect(live).toBeNull();
  });
});

describe("acpSpawnArgsForSession / acpProtectionForSession", () => {
  it("matches protection snapshot to spawn argv", () => {
    const input = session({ approvalMode: "strict" });
    const args = acpSpawnArgsForSession(input, { supportsSandbox: true });
    const snap = acpProtectionForSession(input, { supportsSandbox: true });
    expect(args).toEqual(snap.spawnArgs);
    expect(snap.sandboxProfile).toBe("read-only");
  });

  it("fail-closed protection when sandbox unsupported", () => {
    const snap = acpProtectionForSession(session(), {
      supportsSandbox: false,
    });
    expect(snap.sandboxProfile).toBeNull();
    expect(snap.spawnArgs).not.toContain("--sandbox");
  });

  it("isolation chip follows spawn env, not the claimed inherit flag", () => {
    const claimed = acpProtectionForSession(
      session({ inheritUserConfig: false }),
      { supportsSandbox: true },
      { HOME: "/Users/ada", PATH: "/usr/bin" },
    );
    expect(claimed.isolateGrokHome).toBe(false);
    const isolated = acpProtectionForSession(
      session({ inheritUserConfig: true }),
      { supportsSandbox: true },
      { HOME: "/Users/ada", GROK_HOME: "/tmp/grokdesk-home" },
    );
    expect(isolated.isolateGrokHome).toBe(true);
  });
});

describe("createLiveAcpTransportFactory spawn env", () => {
  it("uses managed-binary resolution by default (not global PATH discovery)", async () => {
    const live = await createLiveAcpTransportFactory({
      processEnv: {
        GROKDESK_PACKAGED: "1",
        HOME: "/no-such-grok-home",
        PATH: "/usr/bin",
      },
    });
    expect(live).toBeNull();
  });

  it("sets isolated GROK_HOME and spawnMeta when inheritUserConfig is false", async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const live = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => ({ supportsAgentStdio: true, supportsSandbox: true }),
      processEnv: { HOME: os.homedir(), PATH: "/usr/bin" },
      mcpServers: [
        {
          id: "desk-browser",
          command: "node",
          args: ["b.mjs"],
          enabled: true,
        },
      ],
      spawn: (opts) => {
        capturedEnv = opts.env;
        return stubTransport();
      },
    });
    const transport = await live!.factory(session());
    expect(capturedEnv?.GROK_HOME).toBeTruthy();
    expect(capturedEnv?.GROK_HOME).not.toBe(
      path.join(os.homedir(), ".grok"),
    );
    expect(transport.spawnMeta?.isolateGrokHome).toBe(true);
    expect(transport.spawnMeta?.grokHome).toBe(capturedEnv?.GROK_HOME);
    expect(fs.existsSync(capturedEnv!.GROK_HOME!)).toBe(true);
  });

  it("does not isolate GROK_HOME when inheritUserConfig is true", async () => {
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const live = await createLiveAcpTransportFactory({
      findBinary: async () => "/usr/local/bin/grok",
      probe: async () => ({ supportsAgentStdio: true }),
      processEnv: { HOME: os.homedir(), PATH: "/usr/bin" },
      spawn: (opts) => {
        capturedEnv = opts.env;
        return stubTransport();
      },
    });
    await live!.factory(session({ inheritUserConfig: true }));
    expect(capturedEnv?.GROK_HOME).toBeUndefined();
  });
});
