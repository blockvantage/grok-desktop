import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BrowserPolicyStore } from "./browser-policy-store";

describe("BrowserPolicyStore", () => {
  it("decodes and canonicalizes authorized workspace HTML", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grok-browser-policy-"));
    try {
      const folder = path.join(root, "Panda Site");
      mkdirSync(folder);
      const html = path.join(folder, "index.html");
      writeFileSync(html, "<h1>Panda</h1>");
      const store = new BrowserPolicyStore();
      store.configure("t1", {
        approvalMode: "autopilot",
        workspaceRoots: [root],
        allowNetworkTools: true,
        allowShell: true,
      });

      await expect(
        store.authorize("t1", "browser_open", {
          url: pathToFileURL(html).href,
        }),
      ).resolves.toEqual({ ok: true, canonicalUrl: realpathSync(html) });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks local HTML outside roots and symlink escapes", async () => {
    const parent = mkdtempSync(path.join(tmpdir(), "grok-browser-policy-"));
    try {
      const root = path.join(parent, "workspace");
      const outside = path.join(parent, "outside");
      mkdirSync(root);
      mkdirSync(outside);
      const secret = path.join(outside, "secret.html");
      writeFileSync(secret, "secret");
      const escape = path.join(root, "escape.html");
      symlinkSync(secret, escape);
      const store = new BrowserPolicyStore();
      store.configure("t1", {
        approvalMode: "autopilot",
        workspaceRoots: [root],
        allowNetworkTools: true,
        allowShell: true,
      });

      await expect(
        store.authorize("t1", "browser_open", { path: secret }),
      ).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/outside/i) });
      await expect(
        store.authorize("t1", "browser_open", { path: escape }),
      ).resolves.toMatchObject({ ok: false, output: expect.stringMatching(/outside/i) });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("rejects a local leaf swapped to an outside symlink after authorization", async () => {
    const parent = mkdtempSync(path.join(tmpdir(), "grok-browser-swap-"));
    try {
      const root = path.join(parent, "workspace");
      const outside = path.join(parent, "outside.html");
      mkdirSync(root);
      writeFileSync(outside, "outside");
      const target = path.join(root, "index.html");
      writeFileSync(target, "safe");
      const store = new BrowserPolicyStore();
      store.configure("t1", {
        approvalMode: "autopilot",
        workspaceRoots: [root],
        allowNetworkTools: true,
        allowShell: true,
      });
      await expect(
        store.authorize("t1", "browser_open", { path: target }),
      ).resolves.toMatchObject({ ok: true, canonicalUrl: realpathSync(target) });

      rmSync(target);
      symlinkSync(outside, target);
      expect(store.revalidateLocal("t1", target)).toMatchObject({
        ok: false,
        output: expect.stringMatching(/outside/i),
      });
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("hard-fails when task is not configured", () => {
    const store = new BrowserPolicyStore();
    const denied = store.gate("unknown", "browser_open", {
      url: "https://example.com",
    });
    expect(denied?.ok).toBe(false);
    expect(denied?.output).toMatch(/not configured/i);
  });

  it("gates file:// deny without exec", () => {
    const store = new BrowserPolicyStore();
    store.configure("t1", {
      approvalMode: "autopilot",
      workspaceRoots: ["/ws"],
      allowNetworkTools: true,
      allowShell: true,
    });
    const denied = store.gate("t1", "browser_open", {
      url: "file:///etc/passwd",
    });
    expect(denied?.ok).toBe(false);
    expect(denied?.output).toMatch(/file/i);
  });

  it("balanced first public open needs approval until rememberOrigin", () => {
    const store = new BrowserPolicyStore();
    store.configure("t1", {
      approvalMode: "balanced",
      workspaceRoots: ["/ws"],
      allowNetworkTools: true,
      allowShell: true,
    });
    const first = store.gate("t1", "browser_open", {
      url: "https://example.com",
    });
    expect(first?.needsApproval).toBe(true);

    store.rememberOrigin("t1", "https://example.com");
    const second = store.gate("t1", "browser_open", {
      url: "https://example.com/page",
    });
    expect(second).toBeNull();
  });

  it("autopilot allows public open", () => {
    const store = new BrowserPolicyStore();
    store.configure("task-uuid-abc", {
      approvalMode: "autopilot",
      workspaceRoots: ["/ws"],
      allowNetworkTools: true,
      allowShell: true,
    });
    expect(
      store.gate("task-uuid-abc", "browser_open", {
        url: "https://example.com",
      }),
    ).toBeNull();
  });

  it("authorize parks until resolveApproval", async () => {
    const store = new BrowserPolicyStore();
    store.configure("t1", {
      approvalMode: "balanced",
      workspaceRoots: ["/ws"],
      allowNetworkTools: true,
      allowShell: true,
    });
    let approvalId = "";
    store.setApprovalHandler((req) => {
      approvalId = req.approvalId;
    });
    const pending = store.authorize("t1", "browser_open", {
      url: "https://example.com",
    });
    // allow microtask for handler
    await new Promise((r) => setTimeout(r, 10));
    expect(approvalId).toBeTruthy();
    expect(store.resolveApproval(approvalId, "approve")).toBe(true);
    const r = await pending;
    expect(r.ok).toBe(true);
    // second open same origin should allow without park
    await expect(
      store.authorize("t1", "browser_open", {
        url: "https://example.com/x",
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("authorize reject returns failure", async () => {
    const store = new BrowserPolicyStore();
    store.configure("t1", {
      approvalMode: "balanced",
      workspaceRoots: ["/ws"],
      allowNetworkTools: true,
      allowShell: true,
    });
    let approvalId = "";
    store.setApprovalHandler((req) => {
      approvalId = req.approvalId;
    });
    const pending = store.authorize("t1", "browser_open", {
      url: "https://example.com",
    });
    await new Promise((r) => setTimeout(r, 10));
    store.resolveApproval(approvalId, "reject");
    const r = await pending;
    expect(r.ok).toBe(false);
  });

  it("cancelTask rejects parked approvals", async () => {
    const store = new BrowserPolicyStore();
    store.configure("t1", {
      approvalMode: "strict",
      workspaceRoots: ["/ws"],
      allowNetworkTools: true,
      allowShell: true,
    });
    store.setApprovalHandler(() => {});
    const pending = store.authorize("t1", "browser_click", {});
    await new Promise((r) => setTimeout(r, 10));
    store.cancelTask("t1");
    const r = await pending;
    expect(r.ok).toBe(false);
  });

  it("treats an explicit renderer click as the strict-mode approval for local HTML", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grok-browser-user-open-"));
    try {
      const html = path.join(root, "index.html");
      writeFileSync(html, "<h1>User selected</h1>");
      const store = new BrowserPolicyStore();
      store.configure("t1", {
        approvalMode: "strict",
        workspaceRoots: [root],
        allowNetworkTools: true,
        allowShell: false,
      });
      let approvalRequested = false;
      store.setApprovalHandler(() => {
        approvalRequested = true;
      });

      await expect(
        store.authorize(
          "t1",
          "browser_open",
          { path: html },
          { source: "renderer_user" },
        ),
      ).resolves.toEqual({ ok: true, canonicalUrl: realpathSync(html) });
      expect(approvalRequested).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats an explicit renderer click as strict-mode approval for a safe web link", async () => {
    const store = new BrowserPolicyStore();
    store.configure("t1", {
      approvalMode: "strict",
      workspaceRoots: [],
      allowNetworkTools: true,
      allowShell: false,
    });
    let approvalRequested = false;
    store.setApprovalHandler(() => {
      approvalRequested = true;
    });

    await expect(
      store.authorize(
        "t1",
        "browser_open",
        { url: "https://example.com/source" },
        { source: "renderer_user" },
      ),
    ).resolves.toEqual({ ok: true });
    expect(approvalRequested).toBe(false);
  });

  it("requires strict-mode approval for an agent or harvest local HTML open", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grok-browser-agent-open-"));
    try {
      const html = path.join(root, "index.html");
      writeFileSync(html, "<h1>Agent selected</h1>");
      const store = new BrowserPolicyStore();
      store.configure("t1", {
        approvalMode: "strict",
        workspaceRoots: [root],
        allowNetworkTools: true,
        allowShell: false,
      });
      let approvalId = "";
      store.setApprovalHandler((request) => {
        approvalId = request.approvalId;
      });

      const pending = store.authorize(
        "t1",
        "browser_open",
        { path: html },
        { source: "agent" },
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(approvalId).not.toBe("");
      expect(store.resolveApproval(approvalId, "approve")).toBe(true);
      await expect(pending).resolves.toEqual({
        ok: true,
        canonicalUrl: realpathSync(html),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("never elevates a no-network task through user-click or agent local opens", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "grok-browser-no-net-"));
    try {
      const html = path.join(root, "index.html");
      writeFileSync(html, "<h1>Offline</h1>");
      const store = new BrowserPolicyStore();
      store.configure("t1", {
        approvalMode: "autopilot",
        workspaceRoots: [root],
        allowNetworkTools: false,
        allowShell: false,
      });

      await expect(
        store.authorize(
          "t1",
          "browser_open",
          { path: html },
          { source: "renderer_user" },
        ),
      ).resolves.toMatchObject({ ok: false, output: "Network tools disabled" });
      await expect(
        store.authorize(
          "t1",
          "browser_open",
          { path: html },
          { source: "agent" },
        ),
      ).resolves.toMatchObject({ ok: false, output: "Network tools disabled" });
      await expect(
        store.authorize("t1", "browser_open", {
          url: "https://example.com",
        }),
      ).resolves.toMatchObject({ ok: false, output: "Network tools disabled" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
