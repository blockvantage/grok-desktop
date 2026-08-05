/**
 * Audit drawer (trust Phase A2): empty + row render, pure helpers, load honesty,
 * task/global filter params, integrity markers, truncated-trail signal, wiring.
 * Node/vitest: mock Sheet so content is SSR-safe without Radix portals.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "@grokdesk/shared";
import {
  AuditDrawer,
  auditFilterKey,
  decisionBadgeVariant,
  detailPreview,
  entryIntegrity,
  loadAuditListPages,
  normalizeAuditTaskIds,
  parseAuditListPage,
  shouldApplyAuditResult,
  sortNewestFirst,
} from "./audit-drawer";

vi.mock("@/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      "audit.title": "Audit decisions",
      "audit.titleTask": "Audit · {label}",
      "audit.subtitle": "Permission and tool decisions for this task.",
      "audit.subtitleThread":
        "Permission and tool decisions for this conversation (all turns).",
      "audit.subtitleGlobal": "Recent permission and tool decisions.",
      "audit.emptyTitle": "No decisions yet",
      "audit.emptyDesc":
        "When Grok asks for approval or tools run under policy, decisions show up here.",
      "audit.loading": "Loading audit…",
      "audit.loadFailed": "Could not load audit trail",
      "audit.malformed": "Audit response was invalid — trail not shown.",
      "audit.hasMore": "Showing {shown} of {total} — older entries not loaded",
      "audit.refresh": "Refresh",
      "audit.globalLabel": "All tasks",
      "audit.unknownDecision":
        "Stored decision was unknown ({value}); shown as info.",
      "audit.unknownDecisionShort": "Unknown decision",
      "audit.corruptDetail":
        "Detail JSON was corrupt and could not be parsed.",
      "audit.corruptDetailShort": "Corrupt detail",
    };
    let text = map[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  },
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    open,
    children,
  }: {
    open?: boolean;
    children?: React.ReactNode;
  }) =>
    open
      ? createElement("div", { "data-testid": "audit-sheet" }, children)
      : null,
  SheetContent: ({ children, ...rest }: { children?: React.ReactNode }) =>
    createElement(
      "div",
      { "data-testid": "audit-sheet-content", ...rest },
      children,
    ),
  SheetHeader: ({ children }: { children?: React.ReactNode }) =>
    createElement("div", null, children),
  SheetTitle: ({ children }: { children?: React.ReactNode }) =>
    createElement("h2", null, children),
  SheetDescription: ({ children }: { children?: React.ReactNode }) =>
    createElement("p", null, children),
}));

vi.mock("@/lib/format", () => ({
  relativeTime: () => "just now",
}));

function entry(
  partial: Partial<AuditEntry> & Pick<AuditEntry, "id" | "action" | "decision">,
): AuditEntry {
  return {
    taskId: "t1",
    detail: {},
    createdAt: "2026-08-04T12:00:00.000Z",
    ...partial,
  };
}

function render(
  props: Partial<React.ComponentProps<typeof AuditDrawer>> &
    Pick<React.ComponentProps<typeof AuditDrawer>, "open"> = { open: true },
) {
  return renderToStaticMarkup(
    createElement(AuditDrawer, {
      onOpenChange: vi.fn(),
      entries: [],
      ...props,
    }),
  );
}

describe("AuditDrawer (controlled render)", () => {
  it("shows empty copy when no entries", () => {
    const html = render({
      open: true,
      entries: [],
      taskLabel: "Demo",
    });
    expect(html).toMatch(/no decisions yet/i);
    expect(html).toContain('data-testid="audit-drawer"');
    expect(html).toContain('data-audit-empty="true"');
  });

  it("renders action and decision for each entry", () => {
    const html = render({
      open: true,
      taskLabel: "Demo",
      entries: [
        entry({
          id: "1",
          taskId: "t1",
          action: "tool.shell",
          detail: { command: "ls" },
          decision: "approve",
          createdAt: "2026-08-04T12:00:00.000Z",
        }),
      ],
    });
    expect(html).toMatch(/tool\.shell/i);
    expect(html).toMatch(/approve/i);
    expect(html).toContain('data-testid="audit-entry"');
    expect(html).toContain('data-audit-action="tool.shell"');
    expect(html).toContain('data-audit-decision="approve"');
    expect(html).not.toContain('data-audit-empty="true"');
    expect(html).toMatch(/ls/);
  });

  it("renders newest-first when multiple controlled entries are out of order", () => {
    const html = render({
      open: true,
      entries: [
        entry({
          id: "old",
          action: "tool.read",
          decision: "allow",
          createdAt: "2026-08-04T10:00:00.000Z",
        }),
        entry({
          id: "new",
          action: "tool.shell",
          decision: "deny",
          createdAt: "2026-08-04T12:00:00.000Z",
        }),
      ],
    });
    const shellIdx = html.indexOf("tool.shell");
    const readIdx = html.indexOf("tool.read");
    expect(shellIdx).toBeGreaterThan(-1);
    expect(readIdx).toBeGreaterThan(-1);
    expect(shellIdx).toBeLessThan(readIdx);
  });

  it("renders nothing when closed", () => {
    const html = render({ open: false, entries: [] });
    expect(html).toBe("");
  });

  it("surfaces hasMore truncated-trail honesty", () => {
    const html = render({
      open: true,
      entries: [
        entry({ id: "1", action: "tool.shell", decision: "approve" }),
      ],
      hasMore: true,
      total: 42,
    });
    expect(html).toContain('data-testid="audit-has-more"');
    expect(html).toMatch(/Showing 1 of 42/i);
    expect(html).toMatch(/older entries not loaded/i);
  });

  it("surfaces gateway _unknownDecision and _corruptDetail provenance", () => {
    const html = render({
      open: true,
      entries: [
        entry({
          id: "u1",
          action: "policy.note",
          decision: "info",
          detail: {
            _unknownDecision: "bogus-decision",
            summary: "remapped",
          },
        }),
        entry({
          id: "c1",
          action: "tool.shell",
          decision: "info",
          detail: { _corruptDetail: true },
        }),
      ],
    });
    expect(html).toContain('data-audit-unknown-decision="bogus-decision"');
    expect(html).toContain('data-testid="audit-unknown-decision"');
    expect(html).toMatch(/unknown \(bogus-decision\)/i);
    expect(html).toContain('data-audit-corrupt-detail="true"');
    expect(html).toContain('data-testid="audit-corrupt-detail"');
    expect(html).toMatch(/corrupt/i);
  });

  it("uses conversation subtitle when multiple taskIds filter the drawer", () => {
    const html = render({
      open: true,
      entries: [],
      taskIds: ["t1", "t2"],
      taskLabel: "Chat",
    });
    expect(html).toMatch(/this conversation/i);
    expect(html).toContain('data-audit-task-count="2"');
  });
});

describe("pure helpers", () => {
  it("sortNewestFirst ties break by id DESC", () => {
    const sorted = sortNewestFirst([
      entry({
        id: "a",
        action: "x",
        decision: "info",
        createdAt: "2026-08-04T12:00:00.000Z",
      }),
      entry({
        id: "z",
        action: "y",
        decision: "info",
        createdAt: "2026-08-04T12:00:00.000Z",
      }),
      entry({
        id: "mid",
        action: "m",
        decision: "info",
        createdAt: "2026-08-04T11:00:00.000Z",
      }),
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["z", "a", "mid"]);
  });

  it("detailPreview prefers command/tool/path and truncates long strings", () => {
    expect(detailPreview({ command: "  ls -la  " })).toBe("ls -la");
    expect(detailPreview({ tool: "shell", command: "echo" })).toBe("echo");
    expect(detailPreview({ path: "/tmp/x" })).toBe("/tmp/x");
    expect(detailPreview({ _unknownDecision: "x", noise: 1 })).toBeNull();
    const long = "x".repeat(200);
    const preview = detailPreview({ summary: long });
    expect(preview).not.toBeNull();
    expect(preview!.length).toBeLessThanOrEqual(120);
    expect(preview!.endsWith("…")).toBe(true);
  });

  it("decisionBadgeVariant maps allow/approve/deny/reject/info", () => {
    expect(decisionBadgeVariant("deny")).toBe("destructive");
    expect(decisionBadgeVariant("reject")).toBe("destructive");
    expect(decisionBadgeVariant("allow")).toBe("default");
    expect(decisionBadgeVariant("approve")).toBe("default");
    expect(decisionBadgeVariant("info")).toBe("outline");
  });

  it("entryIntegrity reads provenance markers only", () => {
    expect(entryIntegrity({ _unknownDecision: "bogus", foo: 1 })).toEqual({
      unknownDecision: "bogus",
      corruptDetail: false,
    });
    expect(entryIntegrity({ _corruptDetail: true })).toEqual({
      unknownDecision: null,
      corruptDetail: true,
    });
    expect(entryIntegrity({ _corruptDetail: "yes" })).toEqual({
      unknownDecision: null,
      corruptDetail: false,
    });
    expect(entryIntegrity(null)).toEqual({
      unknownDecision: null,
      corruptDetail: false,
    });
  });

  it("normalizeAuditTaskIds prefers taskIds over taskId and dedupes", () => {
    expect(normalizeAuditTaskIds(["t2", "t1", "t2", ""], "ignored")).toEqual([
      "t2",
      "t1",
    ]);
    expect(normalizeAuditTaskIds(null, "solo")).toEqual(["solo"]);
    expect(normalizeAuditTaskIds([], null)).toEqual([]);
    expect(normalizeAuditTaskIds(undefined, undefined)).toEqual([]);
  });

  it("auditFilterKey is empty for global and stable for ids", () => {
    expect(auditFilterKey([])).toBe("");
    expect(auditFilterKey(["a", "b"])).toBe("a\0b");
  });

  it("shouldApplyAuditResult only accepts matching generation", () => {
    expect(shouldApplyAuditResult(3, 3)).toBe(true);
    expect(shouldApplyAuditResult(2, 3)).toBe(false);
  });
});

describe("parseAuditListPage (fail-closed)", () => {
  it("accepts a well-formed page", () => {
    const page = parseAuditListPage({
      entries: [
        entry({ id: "1", action: "tool.shell", decision: "approve" }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.entries).toHaveLength(1);
      expect(page.total).toBe(1);
      expect(page.hasMore).toBe(false);
    }
  });

  it("rejects non-array entries as malformed (not empty success)", () => {
    expect(parseAuditListPage({ entries: null, total: 0 }).ok).toBe(false);
    expect(parseAuditListPage({ entries: undefined }).ok).toBe(false);
    expect(parseAuditListPage({}).ok).toBe(false);
    expect(parseAuditListPage(null).ok).toBe(false);
    expect(parseAuditListPage("nope").ok).toBe(false);
  });

  it("skips invalid rows but keeps valid ones when entries is an array", () => {
    const page = parseAuditListPage({
      entries: [
        { garbage: true },
        entry({ id: "ok", action: "tool.read", decision: "allow" }),
        { id: "bad", action: "x", decision: "not-a-decision", createdAt: "t" },
      ],
      total: 9,
      hasMore: true,
    });
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.entries.map((e) => e.id)).toEqual(["ok"]);
      expect(page.hasMore).toBe(true);
      expect(page.total).toBe(9);
    }
  });
});

describe("loadAuditListPages (production list path)", () => {
  it("passes taskId for single-task filter and omits it for global", async () => {
    const calls: unknown[] = [];
    const listFn = vi.fn(async (params: Record<string, unknown>) => {
      calls.push(params);
      return {
        entries: [],
        total: 0,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });

    await loadAuditListPages(listFn, { taskId: "task-a", limit: 50 });
    expect(calls[0]).toEqual({ taskId: "task-a", limit: 50 });

    await loadAuditListPages(listFn, { limit: 25 });
    expect(calls[1]).toEqual({ limit: 25 });
    // Global: no taskId key
    expect(calls[1]).not.toHaveProperty("taskId");
  });

  it("fetches each thread taskId and merges newest-first", async () => {
    const listFn = vi.fn(async (params: { taskId?: string }) => {
      if (params.taskId === "old-turn") {
        return {
          entries: [
            entry({
              id: "old-approve",
              taskId: "old-turn",
              action: "tool.shell",
              decision: "approve",
              createdAt: "2026-08-04T10:00:00.000Z",
            }),
          ],
          total: 1,
          hasMore: false,
          limit: 100,
          offset: 0,
        };
      }
      return {
        entries: [
          entry({
            id: "new-deny",
            taskId: "new-turn",
            action: "tool.write",
            decision: "deny",
            createdAt: "2026-08-04T12:00:00.000Z",
          }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });

    const result = await loadAuditListPages(listFn, {
      taskIds: ["old-turn", "new-turn"],
      limit: 100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries.map((e) => e.id)).toEqual([
        "new-deny",
        "old-approve",
      ]);
      expect(result.total).toBe(2);
    }
    expect(listFn).toHaveBeenCalledTimes(2);
    expect(listFn).toHaveBeenCalledWith({ taskId: "old-turn", limit: 100 });
    expect(listFn).toHaveBeenCalledWith({ taskId: "new-turn", limit: 100 });
  });

  it("fail-closes on thrown list errors (no empty-success)", async () => {
    const listFn = vi.fn(async () => {
      throw new Error("IPC down");
    });
    const result = await loadAuditListPages(listFn, { taskId: "t1" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
    }
  });

  it("fail-closes on malformed page shape (entries not array)", async () => {
    const listFn = vi.fn(async () => ({
      entries: null as unknown as AuditEntry[],
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
    }));
    const result = await loadAuditListPages(listFn, {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed");
    }
  });

  it("marks hasMore when any per-task page is truncated", async () => {
    const listFn = vi.fn(async (params: { taskId?: string }) => {
      if (params.taskId === "a") {
        return {
          entries: [
            entry({ id: "a1", taskId: "a", action: "x", decision: "info" }),
          ],
          total: 5,
          hasMore: true,
          limit: 1,
          offset: 0,
        };
      }
      return {
        entries: [
          entry({ id: "b1", taskId: "b", action: "y", decision: "info" }),
        ],
        total: 1,
        hasMore: false,
        limit: 1,
        offset: 0,
      };
    });
    const result = await loadAuditListPages(listFn, {
      taskIds: ["a", "b"],
      limit: 100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(6);
    }
  });
});

describe("audit drawer wiring (structural)", () => {
  it("task workspace wires overflow View audit with thread taskIds", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".");
    const ws = fs.readFileSync(
      path.join(root, "views/task-workspace-view.tsx"),
      "utf8",
    );
    expect(ws).toMatch(/onViewAudit=\{\(\) => setAuditOpen\(true\)\}/);
    expect(ws).toMatch(/task-overflow-view-audit|onViewAudit/);
    expect(ws).toMatch(/<AuditDrawer/);
    // Thread-wide: taskIds from threadTasks, not only latest task.id
    expect(ws).toMatch(/taskIds=\{/);
    expect(ws).toMatch(/threadTasks\.map/);
    expect(ws).not.toMatch(
      /<AuditDrawer[\s\S]*taskId=\{task\.id\}[\s\S]*\/>/,
    );
  });

  it("chat-actions-menu exposes View audit test id", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".");
    const menu = fs.readFileSync(
      path.join(root, "chat-actions-menu.tsx"),
      "utf8",
    );
    expect(menu).toMatch(/onViewAudit/);
    expect(menu).toMatch(/task-overflow-view-audit/);
  });

  it("permissions tab opens AuditDrawer without taskId (global list)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), ".");
    const tab = fs.readFileSync(
      path.join(root, "views/settings/permissions-tab.tsx"),
      "utf8",
    );
    expect(tab).toMatch(/permissions-recent-decisions/);
    expect(tab).toMatch(/setAuditOpen\(true\)/);
    // Global: AuditDrawer with open/onOpenChange only — no taskId / taskIds props.
    expect(tab).toMatch(
      /<AuditDrawer\s+open=\{auditOpen\}\s+onOpenChange=\{setAuditOpen\}\s*\/>/,
    );
    expect(tab).not.toMatch(/AuditDrawer[^>]*taskId=/);
    expect(tab).not.toMatch(/AuditDrawer[^>]*taskIds=/);
  });

  it("settings copy does not claim a full uncapped audit trail", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../i18n/locales",
    );
    const en = JSON.parse(fs.readFileSync(path.join(root, "en.json"), "utf8"));
    expect(en.settings.permissions.recentDecisionsHint).not.toMatch(
      /full audit trail/i,
    );
    expect(en.settings.permissions.recentDecisionsHint).toMatch(/first page/i);
    expect(en.audit.hasMore).toMatch(/older entries not loaded/i);
    expect(en.audit.malformed).toBeTruthy();
    expect(en.audit.unknownDecision).toBeTruthy();
    expect(en.audit.corruptDetail).toBeTruthy();
  });
});
