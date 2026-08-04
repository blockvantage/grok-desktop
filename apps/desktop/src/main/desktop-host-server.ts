import http from "node:http";
import { randomBytes } from "node:crypto";
import type { DesktopUseService } from "./desktop-use-service";
import type { DesktopPolicyStore } from "./desktop-policy-store";
import { hostTokenMatches, readLimitedJsonBody } from "./host-server-body";

export type DesktopHostServer = {
  port: number;
  token: string;
  url: string;
  close: () => Promise<void>;
};

/**
 * Loopback control plane for desk-desktop MCP.
 * Every /exec is authorize()'d via DesktopUseService (policy inside).
 */
export async function startDesktopHostServer(
  service: DesktopUseService,
  policyStore: DesktopPolicyStore,
): Promise<DesktopHostServer> {
  const token = randomBytes(24).toString("hex");

  const server = http.createServer((req, res) => {
    const auth = req.headers["x-grokdesk-desktop-token"];
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
                  output: "taskId is required for desktop tools",
                  code: "desktop_invalid_args",
                }),
              );
              return;
            }
            const result = await service.exec(taskId, tool, args);
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify(result));
            return;
          }
          if (req.url === "/destroy") {
            const taskId = String(body.taskId ?? "");
            service.destroy(taskId);
            policyStore.destroy(taskId);
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
              code: "desktop_input_failed",
            }),
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const status = msg === "payload_too_large" ? 413 : 400;
        res.writeHead(status, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            ok: false,
            output: msg,
            code: "desktop_invalid_args",
          }),
        );
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
    throw new Error("Failed to bind desktop host server");
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
