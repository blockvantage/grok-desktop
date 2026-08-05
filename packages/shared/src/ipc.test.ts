import { describe, it, expect } from "vitest";
import { CreateTaskInputSchema, parseIpcRequest } from "./ipc.js";
import { TASK_EVENT_KINDS } from "./types.js";

describe("ipc schemas", () => {
  it("accepts valid create task input", () => {
    const parsed = CreateTaskInputSchema.parse({
      goal: "Organize downloads",
      workspaceRoots: ["/tmp/ws"],
    });
    expect(parsed.effort).toBe("normal");
    expect(parsed.effortExplicit).toBeUndefined();
    expect(parsed.approvalMode).toBe("balanced");
    expect(parsed.model).toBe("grok-4.5");
  });

  it("rejects oversized create goals", () => {
    expect(() =>
      CreateTaskInputSchema.parse({
        goal: "x".repeat(100_001),
        workspaceRoots: ["/tmp/ws"],
      }),
    ).toThrow();
  });

  it("preserves effortExplicit when the client reports a user-chosen effort", () => {
    const parsed = CreateTaskInputSchema.parse({
      goal: "Research topic",
      workspaceRoots: ["/tmp/ws"],
      effort: "heavy",
      effortExplicit: true,
    });
    expect(parsed.effort).toBe("heavy");
    expect(parsed.effortExplicit).toBe(true);
  });

  it("accepts and preserves revision lineage on create", () => {
    const parsed = CreateTaskInputSchema.parse({
      goal: "Revise the answer",
      revisionOfTaskId: "source-task",
    });

    expect(parsed.revisionOfTaskId).toBe("source-task");
  });

  it("rejects an empty revision lineage id", () => {
    expect(() =>
      CreateTaskInputSchema.parse({
        goal: "Revise the answer",
        revisionOfTaskId: "",
      }),
    ).toThrow();
  });

  it("exports all worker lifecycle task event kinds", () => {
    expect(TASK_EVENT_KINDS).toEqual([
      "message",
      "step",
      "tool_request",
      "tool_result",
      "approval_required",
      "approval_resolved",
      "artifact_created",
      "status_change",
      "error",
      "plan_update",
      "citations",
      "worker_started",
      "worker_activity",
      "worker_message",
      "worker_completed",
      "worker_failed",
    ]);
  });

  it("rejects empty goal", () => {
    expect(() =>
      CreateTaskInputSchema.parse({ goal: "", workspaceRoots: ["/tmp"] }),
    ).toThrow();
  });

  it("accepts optional locale and goalSource on create (and follow-up)", () => {
    const parsed = CreateTaskInputSchema.parse({
      goal: "Expanded template text",
      workspaceRoots: ["/tmp/ws"],
      locale: "de",
      goalSource: "/brief launch",
      parentTaskId: "parent-1",
    });
    expect(parsed.locale).toBe("de");
    expect(parsed.goalSource).toBe("/brief launch");
    expect(parsed.parentTaskId).toBe("parent-1");
  });

  it("parses create without locale/goalSource (backward compatible)", () => {
    const parsed = CreateTaskInputSchema.parse({
      goal: "hello",
      workspaceRoots: ["/tmp/ws"],
    });
    expect(parsed.locale).toBeUndefined();
    expect(parsed.goalSource).toBeUndefined();
  });

  it("parses known method", () => {
    const req = parseIpcRequest({
      method: "tasks.create",
      id: "1",
      params: {
        goal: "Hi",
        workspaceRoots: ["/tmp/ws"],
      },
    });
    expect(req.method).toBe("tasks.create");
  });

  it("preserves clientMutationId on task.interject (reload dedupe key)", () => {
    const req = parseIpcRequest({
      id: "interject-1",
      method: "task.interject",
      params: {
        taskId: "task-live",
        text: "mid-run aside",
        clientMutationId: "q-interject-reload",
      },
    });
    expect(req.method).toBe("task.interject");
    if (req.method !== "task.interject") throw new Error("expected interject");
    // Zod must keep the mutation id — stripping it breaks gateway receipts.
    expect(req.params.clientMutationId).toBe("q-interject-reload");
    expect(req.params.taskId).toBe("task-live");
    expect(req.params.text).toBe("mid-run aside");
  });

  it("allows task.interject without clientMutationId for backward compat", () => {
    const req = parseIpcRequest({
      id: "interject-legacy",
      method: "task.interject",
      params: { taskId: "task-live", text: "aside" },
    });
    expect(req.method).toBe("task.interject");
    if (req.method !== "task.interject") throw new Error("expected interject");
    expect(req.params.clientMutationId).toBeUndefined();
  });

  it("parses every app-owned browser RPC with strict parameters", () => {
    expect(
      parseIpcRequest({
        id: "browser-capability",
        method: "browser.capability",
        params: {},
      }).method,
    ).toBe("browser.capability");
    expect(
      parseIpcRequest({
        id: "browser-external",
        method: "browser.allowExternal",
        params: { allowed: true },
      }).method,
    ).toBe("browser.allowExternal");
    const open = parseIpcRequest({
      id: "browser-open-html",
      method: "browser.openHtml",
      params: { taskId: "task-1", path: "/workspace/index.html" },
    });
    expect(open.method).toBe("browser.openHtml");
    if (open.method === "browser.openHtml") {
      expect(open.params).toEqual({
        taskId: "task-1",
        path: "/workspace/index.html",
      });
    }

    expect(() =>
      parseIpcRequest({
        id: "browser-capability-extra",
        method: "browser.capability",
        params: { unexpected: true },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "browser-external-missing",
        method: "browser.allowExternal",
        params: {},
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "browser-open-url-alias",
        method: "browser.openHtml",
        params: {
          taskId: "task-1",
          path: "/workspace/index.html",
          url: "https://example.com",
        },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "browser-open-missing-path",
        method: "browser.openHtml",
        params: { taskId: "task-1" },
      }),
    ).toThrow();
  });

  it("allows create task with empty workspaceRoots (chat temp)", () => {
    const parsed = CreateTaskInputSchema.parse({
      goal: "Just chat",
    });
    expect(parsed.workspaceRoots).toEqual([]);
  });

  it("accepts optional attachments on create (max 10)", () => {
    const parsed = CreateTaskInputSchema.parse({
      goal: "Use this image",
      attachments: [
        {
          id: "a1",
          name: "shot.png",
          sourcePath: "/tmp/shot.png",
          kind: "image",
        },
      ],
    });
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]!.kind).toBe("image");
  });

  it("parses workspace.ensureTemp", () => {
    const req = parseIpcRequest({
      id: "9",
      method: "workspace.ensureTemp",
      params: { label: "chat" },
    });
    expect(req.method).toBe("workspace.ensureTemp");
  });

  it("parses remote schedule/memory and telepresence.listDisplays", () => {
    expect(
      parseIpcRequest({ id: "s1", method: "schedule.list", params: {} }).method,
    ).toBe("schedule.list");
    expect(
      parseIpcRequest({
        id: "s2",
        method: "schedule.create",
        params: {
          name: "Daily",
          goalTemplate: "Brief me",
          cron: "0 9 * * *",
          timezone: "UTC",
          workspaceRoots: ["/tmp/ws"],
        },
      }).method,
    ).toBe("schedule.create");
    expect(
      parseIpcRequest({
        id: "s3",
        method: "schedule.delete",
        params: { id: "rule-1" },
      }).method,
    ).toBe("schedule.delete");
    expect(
      parseIpcRequest({
        id: "m1",
        method: "memory.upsert",
        params: { kind: "preference", title: "t", content: "c" },
      }).method,
    ).toBe("memory.upsert");
    expect(
      parseIpcRequest({
        id: "t1",
        method: "remote.telepresence.listDisplays",
        params: {},
      }).method,
    ).toBe("remote.telepresence.listDisplays");
  });

  it("parses audit.list with defaults and rejects invalid filters", () => {
    const missingParams = parseIpcRequest({
      id: "al0",
      method: "audit.list",
    });
    expect(missingParams.method).toBe("audit.list");
    expect(missingParams.params).toEqual({});

    const emptyParams = parseIpcRequest({
      id: "al1",
      method: "audit.list",
      params: {},
    });
    expect(emptyParams.method).toBe("audit.list");
    expect(emptyParams.params).toEqual({});

    const full = parseIpcRequest({
      id: "al2",
      method: "audit.list",
      params: { taskId: "task-1", decision: "deny", limit: 50, offset: 10 },
    });
    expect(full.method).toBe("audit.list");
    expect(full.params).toEqual({
      taskId: "task-1",
      decision: "deny",
      limit: 50,
      offset: 10,
    });

    // All first-class decisions accepted on the positive path.
    for (const decision of ["allow", "approve", "reject", "info", "deny"] as const) {
      const req = parseIpcRequest({
        id: `al-dec-${decision}`,
        method: "audit.list",
        params: { decision },
      });
      expect(req.method).toBe("audit.list");
      expect(req.params).toEqual({ decision });
    }

    expect(() =>
      parseIpcRequest({
        id: "al3",
        method: "audit.list",
        params: { decision: "not-a-decision" },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "al4",
        method: "audit.list",
        params: { taskId: "" },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "al5",
        method: "audit.list",
        params: { limit: 1.5 },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "al6",
        method: "audit.list",
        params: { limit: "10" },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "al7",
        method: "audit.list",
        params: { taskId: "x".repeat(129) },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "al8",
        method: "audit.list",
        params: { offset: 1.5 },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "al9",
        method: "audit.list",
        params: { offset: "10" },
      }),
    ).toThrow();

    // Contract: any finite int is accepted at parse; server clamps to [1, 500].
    // Do not regress to .positive().max(500) here (events.page style).
    for (const limit of [0, -1, 1, 500, 501, 9999]) {
      const req = parseIpcRequest({
        id: `al-lim-${limit}`,
        method: "audit.list",
        params: { limit },
      });
      expect(req.method).toBe("audit.list");
      expect(req.params).toEqual({ limit });
    }

    // Offset: accept any int at parse (incl. negative/0); server clamps to ≥0.
    for (const offset of [0, -1, 1, 10, 500, 9999]) {
      const req = parseIpcRequest({
        id: `al-off-${offset}`,
        method: "audit.list",
        params: { offset },
      });
      expect(req.method).toBe("audit.list");
      expect(req.params).toEqual({ offset });
    }
  });

  it("parses workspace.prepareAsset", () => {
    const req = parseIpcRequest({
      id: "10",
      method: "workspace.prepareAsset",
      params: { path: "shot.png", root: "/tmp/ws" },
    });
    expect(req.method).toBe("workspace.prepareAsset");
    if (req.method === "workspace.prepareAsset") {
      expect(req.params.path).toBe("shot.png");
      expect(req.params.root).toBe("/tmp/ws");
    }
  });

  it("parses auth.usage and auth.openBilling", () => {
    expect(
      parseIpcRequest({
        id: "u1",
        method: "auth.usage",
        params: { force: true },
      }).method,
    ).toBe("auth.usage");
    expect(
      parseIpcRequest({
        id: "u2",
        method: "auth.openBilling",
        params: {},
      }).method,
    ).toBe("auth.openBilling");
    expect(
      parseIpcRequest({
        id: "u2b",
        method: "auth.openAccountPrivacy",
        params: {},
      }).method,
    ).toBe("auth.openAccountPrivacy");
    expect(
      parseIpcRequest({
        id: "u3",
        method: "auth.privacy.get",
        params: {},
      }).method,
    ).toBe("auth.privacy.get");
    expect(
      parseIpcRequest({
        id: "u4",
        method: "chats.exportMarkdown",
        params: { taskId: "t1" },
      }).method,
    ).toBe("chats.exportMarkdown");
  });

  it("parses connectors and license methods", () => {
    expect(
      parseIpcRequest({
        id: "c1",
        method: "connectors.listPresets",
        params: {},
      }).method,
    ).toBe("connectors.listPresets");
    expect(
      parseIpcRequest({
        id: "c2",
        method: "connectors.enable",
        params: { presetId: "filesystem" },
      }).method,
    ).toBe("connectors.enable");
    expect(
      parseIpcRequest({
        id: "c3",
        method: "connectors.enableRecommended",
        params: {},
      }).method,
    ).toBe("connectors.enableRecommended");
    expect(() =>
      parseIpcRequest({
        id: "l1",
        method: "license.activate",
        params: { key: "GD1.x.y" },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "u1",
        method: "updates.manifest",
        params: {},
      }),
    ).toThrow();
  });

  it("settings.set strips license; rejects invalid concurrency and skillsPaths", () => {
    const withLicense = parseIpcRequest({
      id: "s1",
      method: "settings.set",
      params: { license: { key: "forged" }, maxConcurrentTasks: 2 },
    });
    expect(withLicense.method).toBe("settings.set");
    expect(withLicense.params).toEqual({ maxConcurrentTasks: 2 });
    expect("license" in withLicense.params).toBe(false);

    expect(() =>
      parseIpcRequest({
        id: "s2",
        method: "settings.set",
        params: { maxConcurrentTasks: 0 },
      }),
    ).toThrow();

    expect(() =>
      parseIpcRequest({
        id: "s3",
        method: "settings.set",
        params: { skillsPaths: 42 },
      }),
    ).toThrow();
  });

  it("rejects oversized entity ids on schedule/memory/inbox/connectors", () => {
    const huge = "x".repeat(129);
    expect(() =>
      parseIpcRequest({
        id: "r1",
        method: "schedule.setEnabled",
        params: { id: huge, enabled: true },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "r2",
        method: "memory.delete",
        params: { id: huge },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "r2b",
        method: "schedule.delete",
        params: { id: huge },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "r3",
        method: "inbox.markRead",
        params: { id: huge },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "r4",
        method: "inbox.dismiss",
        params: { id: huge },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "r5",
        method: "connectors.enable",
        params: { presetId: huge },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "r6",
        method: "connectors.doctor",
        params: { serverId: huge },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "r7",
        method: "artifacts.list",
        params: { taskId: huge },
      }),
    ).toThrow();
  });

  it("bounds browser.hostApproval free-form fields", () => {
    const ok = parseIpcRequest({
      id: "h1",
      method: "browser.hostApproval",
      params: {
        approvalId: "a1",
        taskId: "t1",
        tool: "browser_open",
        reason: "open example",
        url: "https://example.com",
        args: { href: "https://example.com" },
      },
    });
    expect(ok.method).toBe("browser.hostApproval");

    expect(() =>
      parseIpcRequest({
        id: "h2",
        method: "browser.hostApproval",
        params: {
          approvalId: "a1",
          taskId: "t1",
          tool: "x".repeat(129),
          reason: "r",
        },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "h3",
        method: "browser.hostApproval",
        params: {
          approvalId: "a1",
          taskId: "t1",
          tool: "browser_open",
          reason: "r".repeat(8_001),
        },
      }),
    ).toThrow();
  });

  it("accepts outbox methods and events.page", () => {
    expect(
      parseIpcRequest({
        id: "o1",
        method: "outbox.enqueue",
        params: {
          id: "mut-1",
          conversationId: "c1",
          parentTaskId: "t1",
          text: "follow up",
          attachments: [],
        },
      }).method,
    ).toBe("outbox.enqueue");
    expect(
      parseIpcRequest({
        id: "o2",
        method: "outbox.list",
        params: { conversationId: "c1" },
      }).method,
    ).toBe("outbox.list");
    expect(
      parseIpcRequest({
        id: "o3",
        method: "outbox.sendNow",
        params: { id: "mut-1" },
      }).method,
    ).toBe("outbox.sendNow");
    expect(
      parseIpcRequest({
        id: "o4",
        method: "outbox.summary",
        params: {},
      }).method,
    ).toBe("outbox.summary");
    expect(
      parseIpcRequest({
        id: "e1",
        method: "events.page",
        params: { taskId: "t1", afterSeq: 0, limit: 100 },
      }).method,
    ).toBe("events.page");
  });

  it("rejects invalid outbox enqueue payloads", () => {
    expect(() =>
      parseIpcRequest({
        id: "bad",
        method: "outbox.enqueue",
        params: {
          id: "",
          conversationId: "c1",
          parentTaskId: "t1",
          text: "x",
        },
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "bad2",
        method: "outbox.enqueue",
        params: {
          id: "m1",
          conversationId: "c1",
          parentTaskId: "t1",
          text: "",
        },
      }),
    ).toThrow();
  });

  it("bounds create-task lineage and remote relay URL sizes", () => {
    expect(() =>
      CreateTaskInputSchema.parse({
        goal: "g",
        revisionOfTaskId: "x".repeat(129),
      }),
    ).toThrow();
    expect(() =>
      CreateTaskInputSchema.parse({
        goal: "g",
        parentTaskId: "x".repeat(129),
      }),
    ).toThrow();
    expect(() =>
      parseIpcRequest({
        id: "re1",
        method: "remote.enable",
        params: { relayUrl: "https://x/" + "y".repeat(3_000) },
      }),
    ).toThrow();
    expect(
      parseIpcRequest({
        id: "re2",
        method: "remote.enable",
        params: { relayUrl: "https://relay.example/ws" },
      }).method,
    ).toBe("remote.enable");
  });
});
