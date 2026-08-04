#!/usr/bin/env node
/**
 * Minimal stdio JSON-RPC MCP server for desk-browser tools.
 * Talks to Electron main via GROKDESK_BROWSER_URL + GROKDESK_BROWSER_TOKEN.
 *
 * Implements a small subset of MCP (initialize, tools/list, tools/call)
 * sufficient for Grok Build to discover and invoke browser tools.
 *
 * Framing: newline-delimited JSON-RPC (MCP SDK stdio transport).
 */

import { createInterface } from "node:readline";

const BASE = process.env.GROKDESK_BROWSER_URL || "";
const TOKEN = process.env.GROKDESK_BROWSER_TOKEN || "";
/** Must be the Desk task UUID — set per-run by GrokBuildEngine MCP env. */
const DEFAULT_TASK = process.env.GROKDESK_BROWSER_TASK_ID || "";

// Diagnostics go to stderr only (stdout is reserved for MCP JSON-RPC).
process.stderr.write(
  `[desk-browser] start base=${BASE ? "set" : "missing"} token=${TOKEN ? "set" : "missing"} task=${DEFAULT_TASK || "unset"} node=${process.version}\n`,
);

// IMPORTANT: Grok Build use_tool rejects tool names containing "." (requires
// server__tool form). Always expose underscore names (browser_open), not
// browser.open — otherwise the agent loops searching and never opens the pane.
const TOOLS = [
  {
    name: "browser_open",
    description:
      "Open a URL or local HTML file in the Grok Desk in-app agent browser (globe pane). Pass absolute filesystem path in `path` or `url`. Do NOT use Chrome DevTools or external browsers.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "http(s) URL or absolute filesystem path to an HTML file",
        },
        path: {
          type: "string",
          description: "Absolute path to a local HTML file (alias for url)",
        },
        taskId: { type: "string" },
      },
    },
  },
  {
    name: "browser_click",
    description: "Click an element by CSS selector or coordinates",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        taskId: { type: "string" },
      },
    },
  },
  {
    name: "browser_type",
    description: "Type text into an element; optional form submit",
    inputSchema: {
      type: "object",
      properties: {
        selector: { type: "string" },
        text: { type: "string" },
        submit: { type: "boolean" },
        taskId: { type: "string" },
      },
      required: ["selector", "text"],
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the page or an element",
    inputSchema: {
      type: "object",
      properties: {
        dy: { type: "number" },
        y: { type: "number" },
        selector: { type: "string" },
        taskId: { type: "string" },
      },
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a screenshot of the agent browser viewport",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
    },
  },
  {
    name: "browser_read",
    description: "Read visible text from the current page",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
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
    return {
      ok: false,
      output:
        "GROKDESK_BROWSER_URL/TOKEN not set — Desk main process must export the browser control plane before Grok starts.",
    };
  }
  const taskId = String(args.taskId || DEFAULT_TASK || "").trim();
  if (!taskId) {
    return {
      ok: false,
      output:
        "taskId missing: set GROKDESK_BROWSER_TASK_ID for desk-browser MCP",
    };
  }
  // Accept path alias for local HTML open
  if (tool === "browser_open" || tool === "browser.open") {
    if (!args.url && args.path) args = { ...args, url: args.path };
    if (!args.url && !args.path) {
      return {
        ok: false,
        output: "browser.open requires url or path (absolute HTML path or http URL)",
      };
    }
  }
  try {
    const res = await fetch(`${BASE}/exec`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-grokdesk-browser-token": TOKEN,
      },
      body: JSON.stringify({ taskId, tool: toolToInternal(tool), args }),
      signal: AbortSignal.timeout(HOST_EXEC_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        output: `desk-browser host HTTP ${res.status}: ${text || res.statusText}`,
      };
    }
    return await res.json();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[desk-browser] hostExec failed: ${msg}\n`);
    return {
      ok: false,
      output: `desk-browser failed to reach Desk host at ${BASE}: ${msg}`,
    };
  }
}

function respond(id, result) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n",
  );
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

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  if (!line.trim()) continue;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    continue;
  }
  const { id, method, params } = msg;
  try {
    if (method === "initialize") {
      respond(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "desk-browser", version: "0.1.0" },
      });
      continue;
    }
    if (method === "notifications/initialized" || method === "initialized") {
      continue;
    }
    if (method === "tools/list") {
      respond(id, { tools: TOOLS });
      continue;
    }
    if (method === "tools/call") {
      const name = params?.name;
      const args = params?.arguments ?? {};
      const result = await hostExec(name, args);
      respond(id, {
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
        isError: result?.ok === false,
      });
      continue;
    }
    if (method === "ping") {
      respond(id, {});
      continue;
    }
    respondError(id, `Unknown method: ${method}`);
  } catch (e) {
    respondError(id, e instanceof Error ? e.message : String(e));
  }
}
