import { describe, it, expect } from "vitest";
import {
  buildAcpSpawnArgs,
  projectAcpProtection,
  policySnapshotFromEffective,
} from "./acp-spawn-args.js";

const policy = {
  approvalMode: "balanced" as const,
  workspaceRoots: ["/ws"],
  allowShell: true,
  allowNetworkTools: true,
};

describe("buildAcpSpawnArgs (T1 ACP product path)", () => {
  it("includes agent stdio and --sandbox when probe supports it", () => {
    const args = buildAcpSpawnArgs({
      cwd: "/ws",
      policy,
      supportsSandbox: true,
    });
    expect(args[0]).toBe("agent");
    expect(args[1]).toBe("stdio");
    expect(args).toContain("--sandbox");
    expect(args[args.indexOf("--sandbox") + 1]).toBe("workspace");
  });

  it("omits --sandbox when unsupported", () => {
    const args = buildAcpSpawnArgs({
      cwd: "/ws",
      policy,
      supportsSandbox: false,
    });
    expect(args.slice(0, 2)).toEqual(["agent", "stdio"]);
    expect(args).not.toContain("--sandbox");
  });

  it("Careful maps sandbox read-only when supported", () => {
    const args = buildAcpSpawnArgs({
      cwd: "/ws",
      policy: { ...policy, approvalMode: "strict" },
      supportsSandbox: true,
    });
    expect(args[args.indexOf("--sandbox") + 1]).toBe("read-only");
  });

  it("projectAcpProtection claims match spawn args", () => {
    const snap = projectAcpProtection({
      cwd: "/ws",
      policy,
      supportsSandbox: true,
      isolateGrokHome: true,
    });
    expect(snap.spawnArgs).toContain("--sandbox");
    expect(snap.sandboxProfile).toBe("workspace");
    const no = projectAcpProtection({
      cwd: "/ws",
      policy,
      supportsSandbox: false,
    });
    expect(no.spawnArgs).not.toContain("--sandbox");
    expect(no.sandboxProfile).toBeNull();
  });

  it("policySnapshotFromEffective maps deny caps", () => {
    const p = policySnapshotFromEffective({
      approvalMode: "balanced",
      workspaceRoots: ["/w"],
      capabilities: [
        { id: "shell", decision: "deny" },
        { id: "network", decision: "allow" },
      ],
    });
    expect(p.allowShell).toBe(false);
    expect(p.allowNetworkTools).toBe(true);
  });
});
