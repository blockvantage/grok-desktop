#!/usr/bin/env node
/**
 * Minimal stdio JSON-RPC MCP server for desk-desktop computer-use tools.
 * Talks to Electron main via GROKDESK_DESKTOP_URL + GROKDESK_DESKTOP_TOKEN.
 */

import { createInterface } from "node:readline";

const BASE = process.env.GROKDESK_DESKTOP_URL || "";
const TOKEN = process.env.GROKDESK_DESKTOP_TOKEN || "";
const DEFAULT_TASK = process.env.GROKDESK_DESKTOP_TASK_ID || "";

process.stderr.write(
  `[desk-desktop] start base=${BASE ? "set" : "missing"} token=${TOKEN ? "set" : "missing"} task=${DEFAULT_TASK || "unset"} node=${process.version}\n`,
);

const TOOLS = [
  {
    name: "desktop.screenshot",
    description:
      "Capture the user's desktop display. Coordinates for other desktop.* tools are relative to this image's width/height (top-left origin). Prefer browser.* for sandboxed web the user watches in Desk; use desktop.* for native apps and real OS UI. Call again after UI changes before clicking.",
    inputSchema: {
      type: "object",
      properties: {
        displayId: { type: "string" },
        taskId: { type: "string" },
      },
    },
  },
  {
    name: "desktop.list_displays",
    description: "List available displays with ids, sizes, and primary flag",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
    },
  },
  {
    name: "desktop.mouse_move",
    description: "Move mouse to screenshot-space coordinates",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        taskId: { type: "string" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "desktop.click",
    description: "Click at screenshot-space coordinates",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right", "middle"] },
        count: { type: "number" },
        taskId: { type: "string" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "desktop.double_click",
    description: "Double-click at screenshot-space coordinates",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        taskId: { type: "string" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "desktop.drag",
    description: "Drag from (x1,y1) to (x2,y2) in screenshot space",
    inputSchema: {
      type: "object",
      properties: {
        x1: { type: "number" },
        y1: { type: "number" },
        x2: { type: "number" },
        y2: { type: "number" },
        durationMs: { type: "number" },
        taskId: { type: "string" },
      },
      required: ["x1", "y1", "x2", "y2"],
    },
  },
  {
    name: "desktop.type",
    description: "Type text with the keyboard (unicode). Max 8000 chars.",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        taskId: { type: "string" },
      },
      required: ["text"],
    },
  },
  {
    name: "desktop.key",
    description:
      "Press a key with optional modifiers (cmd, ctrl, alt, shift). cmd is macOS Command; use ctrl on Windows.",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string" },
        modifiers: { type: "array", items: { type: "string" } },
        taskId: { type: "string" },
      },
      required: ["key"],
    },
  },
  {
    name: "desktop.scroll",
    description: "Scroll at screenshot-space point (dx/dy in pixels)",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        dx: { type: "number" },
        dy: { type: "number" },
        taskId: { type: "string" },
      },
      required: ["x", "y"],
    },
  },
  {
    name: "desktop.wait",
    description: "Wait up to 30000ms for UI to settle",
    inputSchema: {
      type: "object",
      properties: {
        ms: { type: "number" },
        taskId: { type: "string" },
      },
    },
  },
  {
    name: "desktop.open_app",
    description: "Open an application by name or filesystem path",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        path: { type: "string" },
        taskId: { type: "string" },
      },
    },
  },
];

function toolToInternal(name) {
  return name.replace(/\./g, "_");
}

/** Bound host control-plane RPCs so a hung main process cannot stall the agent. */
const HOST_EXEC_TIMEOUT_MS = 60_000;

async function hostExec(tool, args) {
  if (!BASE || !TOKEN) {
    return { ok: false, output: "GROKDESK_DESKTOP_URL/TOKEN not set" };
  }
  const taskId = String(args.taskId || DEFAULT_TASK || "").trim();
  if (!taskId) {
    return {
      ok: false,
      output:
        "taskId missing: set GROKDESK_DESKTOP_TASK_ID for desk-desktop MCP",
      code: "desktop_invalid_args",
    };
  }
  const { taskId: _drop, ...rest } = args;
  try {
    const res = await fetch(`${BASE}/exec`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-grokdesk-desktop-token": TOKEN,
      },
      body: JSON.stringify({
        taskId,
        tool: toolToInternal(tool),
        args: rest,
      }),
      signal: AbortSignal.timeout(HOST_EXEC_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        output: `desk-desktop host HTTP ${res.status}: ${text || res.statusText}`,
      };
    }
    return await res.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[desk-desktop] hostExec failed: ${msg}\n`);
    return {
      ok: false,
      output: `desk-desktop failed to reach Desk host at ${BASE}: ${msg}`,
    };
  }
}

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function respondError(id, message) {
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32000, message },
    }) + "\n",
  );
}

function resultToMcpContent(result) {
  const content = [];
  const text =
    typeof result.output === "string"
      ? result.output
      : JSON.stringify(result);
  content.push({ type: "text", text });
  if (result.screenshot && typeof result.screenshot === "string") {
    const m = /^data:([^;]+);base64,(.+)$/.exec(result.screenshot);
    if (m) {
      content.push({
        type: "image",
        data: m[2],
        mimeType: m[1],
      });
    } else {
      content.push({ type: "text", text: result.screenshot.slice(0, 200) + "…" });
    }
  }
  if (result.width != null && result.height != null) {
    content.push({
      type: "text",
      text: `image_size ${result.width}x${result.height} display=${result.displayId ?? ""}`,
    });
  }
  return {
    content,
    isError: result.ok === false,
  };
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      respond(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "desk-desktop", version: "0.1.0" },
      });
      return;
    }
    if (method === "notifications/initialized") {
      return;
    }
    if (method === "tools/list") {
      respond(id, { tools: TOOLS });
      return;
    }
    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};
      const result = await hostExec(name, args);
      respond(id, resultToMcpContent(result));
      return;
    }
    if (id != null) {
      respondError(id, `Unknown method ${method}`);
    }
  } catch (e) {
    if (id != null) {
      respondError(id, e instanceof Error ? e.message : String(e));
    }
  }
});
