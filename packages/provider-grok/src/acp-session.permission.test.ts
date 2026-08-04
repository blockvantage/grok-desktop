import { describe, it, expect, afterEach, vi } from "vitest";
import {
  MemoryLineDuplex,
  attachFakeAcpAgent,
} from "./acp-jsonrpc.js";
import { AcpMediatedSession, createAcpBinding } from "./acp-session.js";
import {
  resolveHumanPermission,
  clearHumanPermissions,
  type RuntimeEvent,
} from "@grokdesk/agent-runtime";

describe("ACP permission parking via turn sink", () => {
  const cleanups: Array<() => void | Promise<void>> = [];
  afterEach(async () => {
    clearHumanPermissions();
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  it("emits permission_request for ask and resolves when bridge is approved", async () => {
    const duplex = new MemoryLineDuplex();
    const fake = attachFakeAcpAgent(duplex.b, {
      requirePermission: true,
      permissionKind: "shell",
      permissionTitle: "Run shell",
    });
    cleanups.push(fake.dispose);

    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: {
        version: "1",
        approvalMode: "balanced",
        workspaceRoots: ["/w"],
        // ask decision for shell
        capabilities: [{ id: "shell", decision: "ask" }],
      },
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");

    const events: RuntimeEvent[] = [];
    const turnP = session.runTurn({ goal: "run ls" }, async (ev) => {
      events.push(ev);
      if (ev.type === "permission_request") {
        // Simulate gateway tasks.approve after park
        queueMicrotask(() => {
          resolveHumanPermission(ev.id, "allow");
        });
      }
      return "continue";
    });

    const result = await turnP;
    expect(result.status).toBe("done");
    expect(events.some((e) => e.type === "permission_request")).toBe(true);
    const perm = events.find((e) => e.type === "permission_request");
    expect(perm).toMatchObject({
      type: "permission_request",
      meta: expect.objectContaining({ acpAsk: true }),
    });
    expect(fake.state.permissionOutcomes).toContain("allow");
  });

  it("parks exit_plan_mode as planReview permission_request", async () => {
    const duplex = new MemoryLineDuplex();
    // Custom peer: on prompt, emit x.ai/exit_plan_mode reverse request
    const unsub = duplex.b.onLine((line) => {
      let msg: { method?: string; id?: string | number; params?: unknown };
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (!msg.method || msg.id == null) return;
      if (msg.method === "initialize") {
        duplex.b.writeLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { protocolVersion: 1, serverInfo: { name: "fake" } },
          }),
        );
        return;
      }
      if (msg.method === "session/new") {
        duplex.b.writeLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: msg.id,
            result: { sessionId: "s-plan" },
          }),
        );
        return;
      }
      if (msg.method === "session/prompt") {
        // Reverse-request exit plan mode
        duplex.b.writeLine(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 42,
            method: "x.ai/exit_plan_mode",
            params: {
              sessionId: "s-plan",
              toolCallId: "tc-plan-1",
              planContent: "# Plan\n- step one",
            },
          }),
        );
        // Reply to prompt after a short delay (session will respond to exit first)
        setTimeout(() => {
          duplex.b.writeLine(
            JSON.stringify({
              jsonrpc: "2.0",
              id: msg.id,
              result: { stopReason: "end_turn" },
            }),
          );
        }, 50);
        return;
      }
      if (msg.method === "session/cancel") {
        duplex.b.writeLine(
          JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }),
        );
      }
    });
    cleanups.push(() => unsub());

    const session = new AcpMediatedSession({
      transport: duplex.a,
      policy: {
        version: "1",
        approvalMode: "balanced",
        workspaceRoots: ["/w"],
        capabilities: [],
      },
      binding: createAcpBinding("grok-4.5"),
    });
    cleanups.push(() => session.cancel("test"));
    await session.start("/w");

    const events: RuntimeEvent[] = [];
    await session.runTurn({ goal: "plan first" }, async (ev) => {
      events.push(ev);
      if (
        ev.type === "permission_request" &&
        (ev.meta as { planReview?: boolean } | undefined)?.planReview
      ) {
        queueMicrotask(() => resolveHumanPermission(ev.id, "allow"));
      }
      return "continue";
    });

    expect(
      events.some(
        (e) =>
          e.type === "plan" &&
          e.status === "awaiting_approval" &&
          e.content.includes("# Plan"),
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "permission_request" &&
          (e.meta as { planReview?: boolean })?.planReview === true,
      ),
    ).toBe(true);
  });
});
