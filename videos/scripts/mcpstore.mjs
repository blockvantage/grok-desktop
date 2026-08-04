#!/usr/bin/env node
// Call an mcp-store tool over MCP streamable HTTP.
// usage: node videos/scripts/mcpstore.mjs list
//        node videos/scripts/mcpstore.mjs call <tool> '<json-args>'
const URL_ = "http://127.0.0.1:7777/mcp";

async function rpc(body, sid) {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(sid ? { "mcp-session-id": sid } : {}),
    },
    body: JSON.stringify(body),
  });
  const newSid = res.headers.get("mcp-session-id") ?? sid;
  const text = await res.text();
  if (!text.trim()) return { data: null, sid: newSid };
  const data = text.includes("data:")
    ? JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).pop().slice(5))
    : JSON.parse(text);
  return { data, sid: newSid };
}

const [mode, tool, argsJson] = process.argv.slice(2);
const init = await rpc({
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "grokdesk-film", version: "1.0.0" } },
});
await rpc({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, init.sid);
const req = mode === "list"
  ? { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
  : { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: JSON.parse(argsJson || "{}") } };
const out = await rpc(req, init.sid);
console.log(JSON.stringify(out.data, null, 2));
