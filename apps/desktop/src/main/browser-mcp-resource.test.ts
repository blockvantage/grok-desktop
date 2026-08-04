import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(here, "../../resources/browser-mcp-server.mjs");

class JsonLineReader {
  private buffer = "";
  private queued: Record<string, unknown>[] = [];
  private waiters: Array<{
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk) => {
      this.buffer += String(chunk);
      for (;;) {
        const newline = this.buffer.indexOf("\n");
        if (newline < 0) break;
        const line = this.buffer.slice(0, newline);
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        try {
          this.deliver(JSON.parse(line) as Record<string, unknown>);
        } catch (error) {
          this.waiters.shift()?.reject(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    });
    child.once("error", (error) => this.rejectAll(error));
    child.once("exit", (code) => {
      if (this.waiters.length > 0) {
        this.rejectAll(new Error(`MCP server exited before response (${code})`));
      }
    });
  }

  private deliver(value: Record<string, unknown>) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(value);
    else this.queued.push(value);
  }

  private rejectAll(error: Error) {
    for (const waiter of this.waiters.splice(0)) waiter.reject(error);
  }

  next(timeoutMs = 4_000): Promise<Record<string, unknown>> {
    const queued = this.queued.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("MCP response timed out"));
      }, timeoutMs);
      this.waiters.push({
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }
}

function send(child: ChildProcessWithoutNullStreams, message: unknown): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

describe("desk-browser MCP resource", () => {
  it("completes initialize/list/call, survives malformed JSON, and shuts down on EOF", async () => {
    const requests: Array<{
      token: string | undefined;
      body: Record<string, unknown>;
    }> = [];
    const host = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        requests.push({
          token: req.headers["x-grokdesk-browser-token"] as string | undefined,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, output: "opened in pane" }));
      });
    });
    await new Promise<void>((resolve) => host.listen(0, "127.0.0.1", resolve));
    const address = host.address();
    if (!address || typeof address === "string") throw new Error("No host port");

    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        GROKDESK_BROWSER_URL: `http://127.0.0.1:${address.port}`,
        GROKDESK_BROWSER_TOKEN: "contract-test",
        GROKDESK_BROWSER_TASK_ID: "task-contract",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const reader = new JsonLineReader(child);
    try {
      child.stdin.write("{ malformed json\n");
      send(child, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {} },
      });
      await expect(reader.next()).resolves.toMatchObject({
        id: 1,
        result: {
          protocolVersion: "2024-11-05",
          serverInfo: { name: "desk-browser" },
        },
      });

      send(child, { jsonrpc: "2.0", method: "notifications/initialized" });
      send(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const listed = await reader.next();
      const result = listed.result as { tools?: Array<{ name?: string }> };
      expect(result.tools?.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(["browser_open", "browser_click", "browser_type", "browser_read"]),
      );

      send(child, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "browser_open",
          arguments: { path: "/workspace/Panda Site/index.html" },
        },
      });
      await expect(reader.next()).resolves.toMatchObject({
        id: 3,
        result: { isError: false },
      });
      expect(requests).toEqual([
        {
          token: "contract-test",
          body: {
            taskId: "task-contract",
            tool: "browser_open",
            args: {
              path: "/workspace/Panda Site/index.html",
              url: "/workspace/Panda Site/index.html",
            },
          },
        },
      ]);

      const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
      child.stdin.end();
      await expect(exited).resolves.toBe(0);
    } finally {
      if (child.exitCode == null) child.kill();
      await new Promise<void>((resolve) => host.close(() => resolve()));
    }
  });
});
