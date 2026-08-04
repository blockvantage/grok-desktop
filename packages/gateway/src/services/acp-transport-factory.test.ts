import { describe, expect, it } from "vitest";
import {
  createLiveAcpTransportFactory,
  acpSpawnArgsForSession,
  acpProtectionForSession,
} from "./acp-transport-factory.js";
import type { SessionInput } from "@grokdesk/agent-runtime";

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
        return {
          writeLine() {},
          onLine: () => () => {},
          close: async () => {},
        };
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
        return {
          writeLine() {},
          onLine: () => () => {},
          close: async () => {},
        };
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
        return {
          writeLine() {},
          onLine: () => () => {},
          close: async () => {},
        };
      },
    });
    await live!.factory(session());
    expect(live!.supportsSandbox).toBe(false);
    expect(captured).not.toContain("--sandbox");
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
});
