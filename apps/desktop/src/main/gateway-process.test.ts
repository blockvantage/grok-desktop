import { afterEach, beforeEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendStderrRing,
  GATEWAY_STDERR_RING_CHARS,
  gatewayEnv,
  resolveGatewayCli,
  resolveNodeBinary,
  resolveMcpNodeBinary,
} from "./gateway-process";

describe("gateway process packaging helpers", () => {
  it("exports restart API on GatewayProcess prototype", async () => {
    const { GatewayProcess } = await import("./gateway-process");
    expect(typeof GatewayProcess.prototype.restart).toBe("function");
    expect(typeof GatewayProcess.prototype.stop).toBe("function");
    expect(typeof GatewayProcess.prototype.start).toBe("function");
  });

  it("appendStderrRing keeps only the newest chars", () => {
    const ring = appendStderrRing("abcd", "efgh", 6);
    expect(ring).toBe("cdefgh");
    expect(ring.length).toBe(6);
    const big = appendStderrRing("", "x".repeat(GATEWAY_STDERR_RING_CHARS + 50));
    expect(big.length).toBe(GATEWAY_STDERR_RING_CHARS);
  });

  it("resolveGatewayCli finds the monorepo gateway CLI", () => {
    const cli = resolveGatewayCli();
    expect(fs.existsSync(cli)).toBe(true);
    expect(cli.replace(/\\/g, "/")).toMatch(/gateway\/dist\/cli\.js$/);
  });

  it("resolveNodeBinary defaults to system node outside packaged Electron", () => {
    const prev = process.env.GROKDESK_NODE_PATH;
    delete process.env.GROKDESK_NODE_PATH;
    try {
      const r = resolveNodeBinary();
      expect(r.command).toBe("node");
      expect(r.electronAsNode).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.GROKDESK_NODE_PATH;
      else process.env.GROKDESK_NODE_PATH = prev;
    }
  });

  it("resolveNodeBinary honors GROKDESK_NODE_PATH", () => {
    const prev = process.env.GROKDESK_NODE_PATH;
    process.env.GROKDESK_NODE_PATH = "/custom/node";
    try {
      const r = resolveNodeBinary();
      expect(r.command).toBe("/custom/node");
      expect(r.electronAsNode).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.GROKDESK_NODE_PATH;
      else process.env.GROKDESK_NODE_PATH = prev;
    }
  });

  it("uses Electron-as-Node for the gateway during electron-vite development", () => {
    const previousPath = process.env.GROKDESK_NODE_PATH;
    const previousExecPath = process.execPath;
    delete process.env.GROKDESK_NODE_PATH;
    Object.defineProperty(process, "execPath", {
      value: "/Applications/Electron.app/Contents/MacOS/Electron",
      writable: true,
      configurable: true,
    });
    try {
      expect(resolveNodeBinary()).toEqual({
        command: "/Applications/Electron.app/Contents/MacOS/Electron",
        electronAsNode: true,
      });
    } finally {
      Object.defineProperty(process, "execPath", {
        value: previousExecPath,
        writable: true,
        configurable: true,
      });
      if (previousPath === undefined) delete process.env.GROKDESK_NODE_PATH;
      else process.env.GROKDESK_NODE_PATH = previousPath;
    }
  });

  it("resolveMcpNodeBinary prefers absolute node (or GROKDESK_NODE_PATH)", () => {
    const prev = process.env.GROKDESK_NODE_PATH;
    process.env.GROKDESK_NODE_PATH = "/custom/mcp-node";
    try {
      const r = resolveMcpNodeBinary();
      expect(r.command).toBe("/custom/mcp-node");
      expect(r.electronAsNode).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.GROKDESK_NODE_PATH;
      else process.env.GROKDESK_NODE_PATH = prev;
    }
    const r2 = resolveMcpNodeBinary();
    // Outside packaged Electron: absolute path or bare node — never empty.
    expect(r2.command.length).toBeGreaterThan(0);
  });

  it("does not promote an ambient managed Grok path into the gateway child", () => {
    const previous = process.env.GROKDESK_MANAGED_GROK_BINARY;
    process.env.GROKDESK_MANAGED_GROK_BINARY = "/tmp/attacker-grok";
    try {
      const env = gatewayEnv(false);
      expect(env.GROKDESK_MANAGED_GROK_BINARY).toBeUndefined();
      expect(env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.GROKDESK_MANAGED_GROK_BINARY;
      } else {
        process.env.GROKDESK_MANAGED_GROK_BINARY = previous;
      }
    }
  });

  it("passes only the runtime-store-resolved managed Grok path", () => {
    const env = gatewayEnv(false, { managedBinaryPath: "/managed/grok" });
    expect(env.GROKDESK_MANAGED_GROK_BINARY).toBeUndefined();
    expect(env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED).toBe("/managed/grok");
  });

  it("strips ambient ACP and dev binary overrides from packaged children", () => {
    const names = [
      "GROKDESK_PACKAGED",
      "GROKDESK_ACP",
      "GROKDESK_DEV_GROK_BINARY",
    ] as const;
    const previous = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    process.env.GROKDESK_PACKAGED = "1";
    process.env.GROKDESK_ACP = "1";
    process.env.GROKDESK_DEV_GROK_BINARY = "/tmp/attacker-grok";
    try {
      const env = gatewayEnv(false, { managedBinaryPath: "/managed/grok" });
      expect(env.GROKDESK_PACKAGED).toBe("1");
      expect(env.GROKDESK_ACP).toBeUndefined();
      expect(env.GROKDESK_DEV_GROK_BINARY).toBeUndefined();
      expect(env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED).toBe("/managed/grok");
    } finally {
      for (const name of names) {
        const value = previous[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("build resources include app icons for electron-builder", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const buildDir = path.resolve(here, "../../build");
    for (const name of ["icon.png", "icon.ico", "icon.icns"] as const) {
      expect(fs.existsSync(path.join(buildDir, name))).toBe(true);
    }
  });

  it("BrandMark uses BASE_URL-relative icon (file:// safe when packaged)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const brand = fs.readFileSync(
      path.resolve(here, "../renderer/components/brand-mark.tsx"),
      "utf8",
    );
    expect(brand).not.toMatch(/src=["']\/grok-desk-icon/);
    expect(brand).toMatch(/import\.meta\.env\.BASE_URL/);
  });
});

describe("gateway env: dev-only local unlock (`make local`)", () => {
  const names = [
    "GROKDESK_DEV_UNLOCK",
    "GROKDESK_PACKAGED",
    "GROKDESK_ENTITLEMENT_FAIL_CLOSED",
    "GROKDESK_RUNTIME_READINESS_STATE_PATH",
  ] as const;
  let previous: Record<string, string | undefined>;

  beforeEach(() => {
    previous = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    for (const n of names) delete process.env[n];
  });
  afterEach(() => {
    for (const n of names) {
      const value = previous[n];
      if (value === undefined) delete process.env[n];
      else process.env[n] = value;
    }
  });

  it("opens both admission checks and drops the readiness state path in dev", () => {
    process.env.GROKDESK_DEV_UNLOCK = "1";
    process.env.GROKDESK_RUNTIME_READINESS_STATE_PATH = "/tmp/readiness.json";
    const env = gatewayEnv(false);
    expect(env.GROKDESK_ENTITLEMENT_FAIL_CLOSED).toBe("0");
    expect(env.GROKDESK_RUNTIME_READINESS_FAIL_CLOSED).toBe("0");
    // No state path + fail-closed off → readiness guard admits (no runtime install).
    expect(env.GROKDESK_RUNTIME_READINESS_STATE_PATH).toBeUndefined();
  });

  it("open-source: packaged builds open admission but ignore ambient DEV_UNLOCK for local CLI", () => {
    // Product keys are off, but ambient DEV_UNLOCK on a package must not
    // enable local-unlock binary discovery or keep ACP env overrides.
    process.env.GROKDESK_PACKAGED = "1";
    process.env.GROKDESK_DEV_UNLOCK = "1";
    process.env.GROKDESK_RUNTIME_READINESS_STATE_PATH = "/tmp/readiness.json";
    const env = gatewayEnv(false);
    expect(env.GROKDESK_ENTITLEMENT_FAIL_CLOSED).toBe("0");
    expect(env.GROKDESK_RUNTIME_READINESS_FAIL_CLOSED).toBe("0");
    expect(env.GROKDESK_RUNTIME_READINESS_STATE_PATH).toBeUndefined();
  });

  it("open-source: fail-closed defaults stay open without DEV_UNLOCK", () => {
    const env = gatewayEnv(false);
    expect(env.GROKDESK_ENTITLEMENT_FAIL_CLOSED).toBe("0");
    expect(env.GROKDESK_RUNTIME_READINESS_FAIL_CLOSED).toBe("0");
  });

  it("wires a local unlock Grok binary when managed path is absent", () => {
    process.env.GROKDESK_DEV_UNLOCK = "1";
    // Use the real machine's unlock discovery when present; otherwise skip
    // the absolute-path assertion but still require unlock env flags.
    const env = gatewayEnv(false);
    expect(env.GROKDESK_DEV_UNLOCK).toBe("1");
    expect(env.GROKDESK_ENTITLEMENT_FAIL_CLOSED).toBe("0");
    expect(env.GROKDESK_RUNTIME_READINESS_STATE_PATH).toBeUndefined();
    if (env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED) {
      expect(env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED).toMatch(/grok/);
      expect(path.isAbsolute(env.GROKDESK_MANAGED_GROK_BINARY_RESOLVED)).toBe(
        true,
      );
    }
  });
});
