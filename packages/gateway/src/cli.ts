/**
 * Node entrypoint for the gateway child process.
 * Electron main speaks JSON-lines RPC over stdio.
 *
 * Protocol:
 *   → { id, method, params }
 *   ← { id, ok: true, result } | { id, ok: false, error }
 *   → { type: "host_result", id, ok, result|error }  (reply to host_call)
 *   ← { type: "host_call", id, method, params }     (gateway → main)
 *   ← { type: "notify", method, params }            (server-push, no id)
 *   → { id: "_", method: "shutdown" } ends process
 */
import { Gateway } from "./index.js";
import { dispatchGateway } from "./dispatch.js";
import { StdioHostBridge } from "./host-bridge.js";
import { createGatewayLineHandler } from "./cli-input.js";
import readline from "node:readline";

const send = (msg: unknown) => {
  process.stdout.write(JSON.stringify(msg) + "\n");
};

const hostBridge = new StdioHostBridge(send);
const gateway = new Gateway(undefined, { hostBridge });
gateway.setNotifySink((msg) => send(msg));
await gateway.start();

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

send({ type: "ready" });

const handleLine = createGatewayLineHandler({
  dispatch: (request) => dispatchGateway(gateway, request),
  handleHostResult: (message) => hostBridge.handleHostResult(message),
  shutdown: () => gateway.stop(),
  send,
  exit: (code) => process.exit(code),
});

rl.on("line", handleLine);
