/**
 * Grok ACP transport (`grok agent stdio`).
 *
 * JSON-RPC framing is production-ready (see acp-jsonrpc.ts). Spawning the real
 * CLI still requires GROKDESK_ACP=1 so default CI never spends credits or hangs
 * on an interactive agent. Headless remains the degraded compatibility path.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { terminateChild } from "@grokdesk/engine-grok";
import {
  ACP_MAX_LINE_BYTES,
  type AcpLineTransport,
} from "./acp-jsonrpc.js";

/**
 * Spawn `grok agent stdio` and return a line transport.
 * Gated by GROKDESK_ACP=1 so CI never accidentally opens a live agent.
 * Caller owns lifecycle via transport.close() (SIGTERM→SIGKILL).
 */
export function spawnAcpLineTransport(opts: {
  binary: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Set only by composition that resolved the binary from the managed store. */
  trustedManagedRuntime?: boolean;
  /** Composition roots that verified probe support pass true; otherwise env-gated. */
  allowSpawn?: boolean;
}): AcpLineTransport {
  if (
    opts.allowSpawn !== true &&
    opts.trustedManagedRuntime !== true &&
    process.env.GROKDESK_ACP !== "1"
  ) {
    throw new Error(
      "ACP stdio not enabled — set GROKDESK_ACP=1, pass allowSpawn, or inject a test transport factory",
    );
  }
  const child = spawn(opts.binary, opts.args ?? ["agent", "stdio"], {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return childProcessLineTransport(child);
}

/** Wrap a child process stdio as newline transport. */
export function childProcessLineTransport(
  child: ChildProcess,
): AcpLineTransport {
  const handlers = new Set<(line: string) => void>();
  let buf = "";
  /** After an oversized frame, discard bytes until the next newline. */
  let skipUntilNewline = false;
  const emitOversized = () => {
    for (const h of handlers) {
      h(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32700,
            message: `ACP line too large (max ${ACP_MAX_LINE_BYTES} bytes)`,
          },
        }),
      );
    }
  };

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    let data = chunk;
    if (skipUntilNewline) {
      const nl = data.search(/\r?\n/);
      if (nl < 0) return;
      data = data.slice(nl).replace(/^\r?\n/, "");
      skipUntilNewline = false;
      if (!data) return;
    }
    buf += data;
    // Emit complete lines; drop any single frame over the byte cap.
    const parts = buf.split(/\r?\n/);
    buf = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.trim()) continue;
      if (Buffer.byteLength(line, "utf8") > ACP_MAX_LINE_BYTES) {
        emitOversized();
        continue;
      }
      for (const h of handlers) h(line);
    }
    // Incomplete line already larger than cap — discard until next newline.
    if (Buffer.byteLength(buf, "utf8") > ACP_MAX_LINE_BYTES) {
      buf = "";
      skipUntilNewline = true;
      emitOversized();
    }
  });
  return {
    writeLine: (line) => {
      child.stdin?.write(line.endsWith("\n") ? line : line + "\n");
    },
    onLine: (handler) => {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    close: async () => {
      handlers.clear();
      await terminateChild(child, 2_000);
    },
  };
}
