import http from "node:http";
import { randomBytes } from "node:crypto";
import type { BrowserService } from "./browser-service";
import type { BrowserPolicyStore } from "./browser-policy-store";
import { hostTokenMatches, readLimitedJsonBody } from "./host-server-body";

export type BrowserHostServer = {
  port: number;
  token: string;
  url: string;
  close: () => Promise<void>;
};

/**
 * Loopback control plane for desk-browser MCP.
 * Every /exec is authorize()'d (may wait for user approval) then executed.
 */
export async function startBrowserHostServer(
  browser: BrowserService,
  policyStore: BrowserPolicyStore,
): Promise<BrowserHostServer> {
  const token = randomBytes(24).toString("hex");

  const server = http.createServer((req, res) => {
    const auth = req.headers["x-grokdesk-browser-token"];
    if (!hostTokenMatches(auth, token)) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }

    void (async () => {
      try {
        const body = await readLimitedJsonBody(req);
        try {
          if (req.url === "/exec") {
            const taskId = String(body.taskId ?? "").trim();
            const tool = String(body.tool ?? "");
            const args = (body.args as Record<string, unknown>) ?? {};
            if (!taskId) {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(
                JSON.stringify({
                  ok: false,
                  output: "taskId is required for browser tools",
                }),
              );
              return;
            }
            const authz = await policyStore.authorize(taskId, tool, args);
            if (!authz.ok) {
              res.writeHead(200, { "content-type": "application/json" });
              res.end(JSON.stringify(authz));
              return;
            }
            const execArgs = authz.canonicalUrl
              ? { ...args, url: authz.canonicalUrl, path: authz.canonicalUrl }
              : args;
            const result = await browser.exec(taskId, tool, execArgs, authz);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(result));
            return;
          }
          if (req.url === "/destroy") {
            const taskId = String(body.taskId ?? "");
            policyStore.cancelTask(taskId);
            await browser.destroy(taskId);
            policyStore.delete(taskId);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
          }
          res.writeHead(404);
          res.end();
        } catch (e) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              ok: false,
              output: e instanceof Error ? e.message : String(e),
            }),
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = msg === "payload_too_large" ? 413 : 400;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, output: msg }));
      }
    })();
  });

  // Loopback MCP only — cap concurrent sockets against local flood DoS.
  server.maxConnections = 32;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("Failed to bind browser host server");
  }

  return {
    port: addr.port,
    token,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
