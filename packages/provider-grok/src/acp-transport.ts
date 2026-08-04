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
  AcpJsonRpcClient,
  type AcpInitializeResult,
  type AcpLineTransport,
  type AcpPermissionDecision,
} from "./acp-jsonrpc.js";

export interface AcpHandshake {
  protocolVersion: number;
  agentName?: string;
  capabilities?: string[];
  raw?: AcpInitializeResult;
}

export interface AcpTransportOptions {
  binary: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  /** Fail if handshake not received within this many ms. */
  handshakeTimeoutMs?: number;
  onPermission?: (
    req: {
      sessionId: string;
      requestId: string;
      kind?: string;
      title?: string;
    },
  ) => Promise<AcpPermissionDecision> | AcpPermissionDecision;
}

/**
 * Probe whether ACP stdio appears available for a given binary.
 * Does not submit paid task work — only checks help/stdio surface.
 */
export async function probeAcpAvailable(
  binary: string,
  opts?: { timeoutMs?: number },
): Promise<{ available: boolean; reason: string }> {
  const timeoutMs = opts?.timeoutMs ?? 2_000;
  // Conservative: only claim available when GROKDESK_ACP=1.
  if (process.env.GROKDESK_ACP !== "1") {
    return {
      available: false,
      reason: "ACP probe disabled (set GROKDESK_ACP=1 to enable)",
    };
  }
  try {
    const child = spawn(binary, ["agent", "stdio", "--help"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1" },
    });
    const result = await new Promise<{ code: number | null; out: string }>(
      (resolve) => {
        let out = "";
        const t = setTimeout(() => {
          void terminateChild(child, 200);
          resolve({ code: null, out });
        }, timeoutMs);
        child.stdout?.on("data", (c: Buffer) => {
          out += c.toString("utf8");
        });
        child.stderr?.on("data", (c: Buffer) => {
          out += c.toString("utf8");
        });
        child.on("close", (code) => {
          clearTimeout(t);
          resolve({ code, out });
        });
        child.on("error", () => {
          clearTimeout(t);
          resolve({ code: null, out });
        });
      },
    );
    const text = result.out.toLowerCase();
    if (text.includes("agent") || text.includes("stdio") || result.code === 0) {
      return { available: true, reason: "help/stdio responded" };
    }
    return {
      available: false,
      reason: `unexpected help output (code=${result.code})`,
    };
  } catch (e) {
    return {
      available: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

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

/**
 * ACP session over stdio with version negotiation and optional permission broker.
 */
export class AcpStdioSession {
  private child: ChildProcess | null = null;
  private client: AcpJsonRpcClient | null = null;
  private sessionId: string | null = null;

  constructor(private opts: AcpTransportOptions) {}

  get activeSessionId(): string | null {
    return this.sessionId;
  }

  async start(cwd?: string): Promise<AcpHandshake> {
    if (process.env.GROKDESK_ACP !== "1") {
      throw new Error(
        "ACP stdio not enabled — set GROKDESK_ACP=1 or use headless degraded adapter",
      );
    }
    const args = this.opts.args ?? ["agent", "stdio"];
    this.child = spawn(this.opts.binary, args, {
      cwd: cwd ?? this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const transport = childProcessLineTransport(this.child);
    this.client = new AcpJsonRpcClient(transport, {
      requestTimeoutMs: this.opts.handshakeTimeoutMs ?? 15_000,
      onServerRequest: (method, params, respond, reject) => {
        if (method === "session/request_permission") {
          void this.handlePermission(params, respond, reject);
          return;
        }
        reject(-32601, `Unhandled server method: ${method}`);
      },
    });
    const init = await this.client.initialize({
      name: "grok-desk",
      version: "0.1.2",
    });
    const session = await this.client.newSession({
      cwd: cwd ?? this.opts.cwd,
    });
    this.sessionId = session.sessionId;
    return {
      protocolVersion: init.protocolVersion,
      agentName: init.serverInfo?.name,
      capabilities: Object.keys(init.capabilities ?? {}),
      raw: init,
    };
  }

  private async handlePermission(
    params: unknown,
    respond: (result: unknown) => void,
    reject: (code: number, message: string) => void,
  ): Promise<void> {
    try {
      const p = params as {
        sessionId?: string;
        requestId?: string;
        kind?: string;
        title?: string;
      };
      const decision = this.opts.onPermission
        ? await this.opts.onPermission({
            sessionId: p.sessionId ?? "",
            requestId: p.requestId ?? "",
            kind: p.kind,
            title: p.title,
          })
        : ("deny" as AcpPermissionDecision);
      respond({ outcome: decision });
    } catch (e) {
      reject(
        -32000,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  async prompt(text: string): Promise<{ stopReason?: string }> {
    if (!this.client || !this.sessionId) {
      throw new Error("ACP session not started");
    }
    return this.client.prompt(this.sessionId, text);
  }

  async cancel(): Promise<void> {
    try {
      if (this.client && this.sessionId) {
        await this.client.cancel(this.sessionId).catch(() => {});
      }
    } finally {
      await this.client?.close().catch(() => {});
      this.client = null;
      this.sessionId = null;
      if (this.child) {
        await terminateChild(this.child, 2_000);
        this.child = null;
      }
    }
  }
}

export type { AcpInitializeResult, AcpPermissionDecision };
