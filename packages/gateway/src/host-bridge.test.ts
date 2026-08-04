import { describe, it, expect } from "vitest";
import { StdioHostBridge, NullHostBridge } from "./host-bridge.js";

describe("NullHostBridge", () => {
  it("returns not-ok without throwing", async () => {
    const b = new NullHostBridge();
    const r = await b.browserExec({
      taskId: "t1",
      tool: "browser_open",
      args: { url: "https://example.com" },
    });
    expect(r.ok).toBe(false);
    await b.browserConfigure({
      taskId: "t1",
      policy: {
        approvalMode: "autopilot",
        workspaceRoots: [],
        allowNetworkTools: true,
        allowShell: true,
      },
    });
    await b.browserRememberOrigin("t1", "https://example.com");
    expect(await b.browserResolveApproval("x", "approve")).toBe(false);
    await b.browserDestroy("t1");
    const d = await b.desktopExec({
      taskId: "t1",
      tool: "desktop_screenshot",
      args: {},
    });
    expect(d.ok).toBe(false);
    await b.desktopDestroy("t1");
  });
});

describe("StdioHostBridge", () => {
  it("writes host_call and resolves on host_result", async () => {
    const lines: unknown[] = [];
    const bridge = new StdioHostBridge((msg) => lines.push(msg));
    const p = bridge.browserExec({
      taskId: "t1",
      tool: "browser_open",
      args: { url: "https://example.com" },
    });
    expect(lines).toHaveLength(1);
    const call = lines[0] as {
      type: string;
      id: string;
      method: string;
      params: { taskId: string };
    };
    expect(call.type).toBe("host_call");
    expect(call.method).toBe("browser.exec");
    expect(call.params.taskId).toBe("t1");

    bridge.handleHostResult({
      id: call.id,
      ok: true,
      result: { ok: true, output: "loaded", url: "https://example.com" },
    });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.url).toBe("https://example.com");
  });

  it("rejects on host_result error", async () => {
    const lines: unknown[] = [];
    const bridge = new StdioHostBridge((msg) => lines.push(msg));
    const p = bridge.browserDestroy("t1");
    const call = lines[0] as { id: string };
    bridge.handleHostResult({ id: call.id, ok: false, error: "boom" });
    await expect(p).rejects.toThrow(/boom/);
  });

  it("desktop.exec host_call round-trip", async () => {
    const lines: unknown[] = [];
    const bridge = new StdioHostBridge((msg) => lines.push(msg));
    const p = bridge.desktopExec({
      taskId: "t1",
      tool: "desktop_screenshot",
      args: {},
    });
    const call = lines[0] as { type: string; id: string; method: string };
    expect(call.method).toBe("desktop.exec");
    bridge.handleHostResult({
      id: call.id,
      ok: true,
      result: { ok: true, output: "shot", width: 10, height: 10 },
    });
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.width).toBe(10);
  });
});
