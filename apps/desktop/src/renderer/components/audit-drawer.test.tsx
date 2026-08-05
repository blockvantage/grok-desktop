/**
 * Audit drawer (trust Phase A2): empty + row render, pure helpers, load honesty,
 * view-phase resolver, task/global filter params, integrity markers, truncated-trail
 * signal, soft-drop vs pagination, reopen honesty, async fetch wiring.
 * Fail-closed: never invent empty success from malformed rows.
 */
// @vitest-environment jsdom
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "@grokdesk/shared";
import {
  AUDIT_INVALID_SCOPE_SENTINEL,
  AuditDrawer,
  auditFilterKey,
  decisionBadgeVariant,
  detailPreview,
  entryIntegrity,
  loadAuditListPages,
  normalizeAuditTaskIds,
  normalizeEntryDetail,
  parseAuditListPage,
  policyMediationDecision,
  resolveAuditDrawerView,
  shouldApplyAuditResult,
  sortNewestFirst,
} from "./audit-drawer";

// React 19 createRoot + act requires this flag in non-RTL environments.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/** Hoisted so vi.mock factory can reference the spy before const init. */
const { listMock, translate } = vi.hoisted(() => {
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
    "audit.droppedInvalid":
      "{count} response row(s) were invalid and discarded (not older pages).",
    "audit.needsApproval":
      "Parked for your approval (policy needs_approval).",
    "audit.needsApprovalShort": "Needs approval",
    "audit.refresh": "Refresh",
    "audit.globalLabel": "All tasks",
    "audit.unknownDecision":
      "Stored decision was unknown ({value}); shown as info.",
    "audit.unknownDecisionShort": "Unknown decision",
    "audit.corruptDetail":
      "Detail JSON was corrupt and could not be parsed.",
    "audit.corruptDetailShort": "Corrupt detail",
  };
  const translate = (
    key: string,
    vars?: Record<string, string | number>,
  ): string => {
    let text = map[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        text = text.replaceAll(`{${k}}`, String(v));
      }
    }
    return text;
  };
  return { listMock: vi.fn(), translate };
});

vi.mock("@/lib/api", () => ({
  audit: {
    list: (...args: unknown[]) => listMock(...args),
  },
}));

vi.mock("@/i18n", () => ({
  // Stable translate identity — mirrors production I18nProvider memoization.
  useT: () => translate,
}));

vi.mock("@/lib/errors", () => ({
  humanizeError: (e: unknown) =>
    e instanceof Error ? e.message : "Could not load audit trail",
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

/** Uncontrolled render (no entries prop) — first paint before effects. */
function renderUncontrolled(
  props: Partial<React.ComponentProps<typeof AuditDrawer>> &
    Pick<React.ComponentProps<typeof AuditDrawer>, "open"> = { open: true },
) {
  const { entries: _omit, ...rest } = props as {
    entries?: AuditEntry[];
  } & typeof props;
  void _omit;
  return renderToStaticMarkup(
    createElement(AuditDrawer, {
      onOpenChange: vi.fn(),
      ...rest,
    }),
  );
}

// ── controlled static markup ────────────────────────────────────────────────

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

  it("renders deny/reject/allow badges for multi-decision rows", () => {
    const html = render({
      open: true,
      entries: [
        entry({ id: "d1", action: "tool.write", decision: "deny" }),
        entry({ id: "r1", action: "tool.exec", decision: "reject" }),
        entry({ id: "a1", action: "tool.read", decision: "allow" }),
      ],
    });
    expect(html).toContain('data-audit-decision="deny"');
    expect(html).toContain('data-audit-decision="reject"');
    expect(html).toContain('data-audit-decision="allow"');
    expect(html.match(/data-testid="audit-entry"/g)?.length).toBe(3);
  });

  it("surfaces needs_approval mediation from detail (not plain info-only)", () => {
    const html = render({
      open: true,
      entries: [
        entry({
          id: "p1",
          action: "policy_check",
          decision: "info",
          detail: {
            tool: "shell",
            decision: "needs_approval",
            reason: "Plan ready for review",
          },
        }),
      ],
    });
    expect(html).toContain('data-audit-decision="info"');
    expect(html).toContain('data-audit-mediation="needs_approval"');
    expect(html).toContain('data-testid="audit-mediation-badge"');
    expect(html).toMatch(/Needs approval/i);
    expect(html).toMatch(/Plan ready for review/i);
    expect(html).toContain('data-testid="audit-needs-approval-note"');
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

  it("surfaces soft-dropped invalid rows separately from pagination hasMore", () => {
    const html = render({
      open: true,
      entries: [
        entry({ id: "1", action: "tool.shell", decision: "approve" }),
      ],
      hasMore: false,
      total: 3,
      droppedInvalid: 2,
    });
    expect(html).toContain('data-testid="audit-dropped-invalid"');
    expect(html).toMatch(/2 response row\(s\) were invalid/i);
    expect(html).not.toContain('data-testid="audit-has-more"');
    expect(html).not.toMatch(/older entries not loaded/i);
  });

  it("never shows empty + hasMore together (0 rows + truncation)", () => {
    const html = render({
      open: true,
      entries: [],
      hasMore: true,
      total: 5,
    });
    expect(html).not.toContain('data-audit-empty="true"');
    expect(html).not.toMatch(/no decisions yet/i);
    expect(html).toContain('data-testid="audit-has-more"');
    expect(html).toMatch(/Showing 0 of 5/i);
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

  it("uses global subtitle and data-audit-filter=global with no task filter", () => {
    const html = render({
      open: true,
      entries: [],
    });
    expect(html).toMatch(/Recent permission and tool decisions/i);
    expect(html).toContain('data-audit-filter="global"');
    expect(html).toContain('data-audit-task-count="0"');
  });

  it("uses single-task subtitle for one taskId", () => {
    const html = render({
      open: true,
      entries: [entry({ id: "1", action: "tool.shell", decision: "approve" })],
      taskId: "solo-task",
    });
    expect(html).toMatch(/for this task/i);
    expect(html).toContain('data-audit-task-count="1"');
    // Single-task: no per-row task id attribution needed
    expect(html).not.toContain('data-testid="audit-entry-task"');
  });

  it("attributes taskId on rows for multi-task and global filters", () => {
    const multi = render({
      open: true,
      taskIds: ["t1", "t2"],
      entries: [
        entry({
          id: "1",
          taskId: "t1",
          action: "tool.shell",
          decision: "approve",
        }),
      ],
    });
    expect(multi).toContain('data-testid="audit-entry-task"');
    expect(multi).toContain('data-audit-task="t1"');
    expect(multi).toMatch(/>t1</);

    const global = render({
      open: true,
      entries: [
        entry({
          id: "2",
          taskId: "task-x",
          action: "tool.read",
          decision: "allow",
        }),
      ],
    });
    expect(global).toContain('data-audit-filter="global"');
    expect(global).toContain('data-testid="audit-entry-task"');
    expect(global).toMatch(/>task-x</);
  });
});

describe("AuditDrawer uncontrolled first paint (pre-effect honesty)", () => {
  it("shows loading — not empty — when open with no settled fetch yet", () => {
    // renderToStaticMarkup does not run effects; mirrors first paint after open.
    const html = renderUncontrolled({ open: true, taskId: "t1" });
    expect(html).toContain('data-testid="audit-loading"');
    expect(html).toMatch(/Loading audit/i);
    expect(html).not.toContain('data-audit-empty="true"');
    expect(html).not.toMatch(/no decisions yet/i);
    expect(html).toContain('data-testid="audit-refresh"');
  });

  it("shows loading for global uncontrolled open", () => {
    const html = renderUncontrolled({ open: true });
    expect(html).toContain('data-testid="audit-loading"');
    expect(html).toContain('data-audit-filter="global"');
    expect(html).not.toContain('data-audit-empty="true"');
  });
});

// ── async uncontrolled (mocked audit.list) ──────────────────────────────────

describe("AuditDrawer uncontrolled async fetch", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listMock.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  function mount(
    props: Partial<React.ComponentProps<typeof AuditDrawer>> & {
      open: boolean;
    },
  ) {
    act(() => {
      root.render(
        createElement(AuditDrawer, {
          onOpenChange: vi.fn(),
          ...props,
        }),
      );
    });
  }

  /** Flush load() promise chain through React act (swallows list rejections). */
  async function flushLoad() {
    await act(async () => {
      const pending = listMock.mock.results
        .map((r) => r.value)
        .filter(
          (v) =>
            v != null && typeof (v as Promise<unknown>).then === "function",
        ) as Promise<unknown>[];
      await Promise.all(
        pending.map((p) => p.then(() => undefined, () => undefined)),
      );
      await Promise.resolve();
    });
  }

  it("loads via audit.list with taskId and shows settled rows", async () => {
    listMock.mockResolvedValueOnce({
      entries: [
        entry({
          id: "1",
          taskId: "task-a",
          action: "tool.shell",
          decision: "approve",
          detail: { command: "ls" },
        }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    mount({ open: true, taskId: "task-a" });
    expect(container.innerHTML).toContain('data-testid="audit-loading"');

    await flushLoad();

    expect(listMock).toHaveBeenCalledWith({
      taskId: "task-a",
      limit: 100,
    });
    expect(container.innerHTML).toContain('data-audit-action="tool.shell"');
    expect(container.innerHTML).toContain('data-audit-decision="approve"');
    expect(container.innerHTML).not.toContain('data-testid="audit-loading"');
  });

  it("loads global list with no taskId (Settings)", async () => {
    listMock.mockResolvedValueOnce({
      entries: [],
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    mount({ open: true });
    await flushLoad();

    expect(listMock).toHaveBeenCalledWith({ limit: 100 });
    expect(listMock.mock.calls[0][0]).not.toHaveProperty("taskId");
    expect(container.innerHTML).toContain('data-audit-empty="true"');
    expect(container.innerHTML).toMatch(/no decisions yet/i);
  });

  it("surfaces malformed error UI (not empty success)", async () => {
    listMock.mockResolvedValueOnce({
      entries: null,
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    mount({ open: true, taskId: "t1" });
    await flushLoad();

    expect(container.innerHTML).toContain('data-testid="audit-error"');
    expect(container.innerHTML).toMatch(/invalid/i);
    expect(container.innerHTML).not.toContain('data-audit-empty="true"');
    expect(container.innerHTML).not.toMatch(/no decisions yet/i);
  });

  it("surfaces thrown list errors in audit-error", async () => {
    listMock.mockRejectedValueOnce(new Error("IPC down"));

    mount({ open: true });
    await flushLoad();

    expect(container.innerHTML).toContain('data-testid="audit-error"');
    expect(container.innerHTML).toMatch(/IPC down/);
    expect(container.innerHTML).not.toContain('data-audit-empty="true"');
  });

  it("reopen with same filter shows loading — not cached empty/stale", async () => {
    listMock.mockResolvedValueOnce({
      entries: [],
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    mount({ open: true, taskId: "t1" });
    await flushLoad();
    expect(container.innerHTML).toContain('data-audit-empty="true"');

    // Close clears settled result
    mount({ open: false, taskId: "t1" });
    expect(container.innerHTML).toBe("");

    // New rows written while closed
    listMock.mockResolvedValueOnce({
      entries: [
        entry({
          id: "new-1",
          taskId: "t1",
          action: "tool.shell",
          decision: "approve",
        }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    mount({ open: true, taskId: "t1" });
    // Immediate reopen paint must be loading, never cached empty
    expect(container.innerHTML).toContain('data-testid="audit-loading"');
    expect(container.innerHTML).not.toContain('data-audit-empty="true"');
    expect(container.innerHTML).not.toMatch(/no decisions yet/i);

    await flushLoad();
    expect(container.innerHTML).toContain('data-audit-action="tool.shell"');
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("close while loading discards in-flight result (no late apply)", async () => {
    let resolveList!: (v: unknown) => void;
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    mount({ open: true, taskId: "t1" });
    expect(container.innerHTML).toContain('data-testid="audit-loading"');

    mount({ open: false, taskId: "t1" });
    expect(container.innerHTML).toBe("");

    await act(async () => {
      resolveList({
        entries: [
          entry({ id: "late", action: "tool.shell", decision: "approve" }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      });
      await Promise.resolve();
    });

    // Still closed — late result must not paint
    expect(container.innerHTML).toBe("");

    // Reopen starts a fresh load
    listMock.mockResolvedValueOnce({
      entries: [],
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
    });
    mount({ open: true, taskId: "t1" });
    expect(container.innerHTML).toContain('data-testid="audit-loading"');
    expect(container.innerHTML).not.toContain('data-audit-action="tool.shell"');

    await flushLoad();
    expect(container.innerHTML).toContain('data-audit-empty="true"');
  });

  it("thread taskIds loads each id and merges rows", async () => {
    listMock.mockImplementation(async (params: { taskId?: string }) => {
      if (params.taskId === "a") {
        return {
          entries: [
            entry({
              id: "a1",
              taskId: "a",
              action: "tool.a",
              decision: "allow",
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
            id: "b1",
            taskId: "b",
            action: "tool.b",
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

    mount({ open: true, taskIds: ["b", "a"] });
    await flushLoad();

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('data-audit-action="tool.b"');
    expect(container.innerHTML).toContain('data-audit-action="tool.a"');
    // newest first
    const html = container.innerHTML;
    expect(html.indexOf("tool.b")).toBeLessThan(html.indexOf("tool.a"));
  });

  it("soft-skip partial page shows dropped copy without pagination lie", async () => {
    listMock.mockResolvedValueOnce({
      entries: [
        { garbage: true },
        entry({ id: "ok", action: "tool.read", decision: "allow" }),
        { id: "bad", action: "x", decision: "not-a-decision", createdAt: "t" },
      ],
      total: 3,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    mount({ open: true, taskId: "t1" });
    await flushLoad();

    expect(container.innerHTML).toContain('data-audit-action="tool.read"');
    expect(container.innerHTML).toContain('data-testid="audit-dropped-invalid"');
    expect(container.innerHTML).toMatch(/2 response row\(s\) were invalid/i);
    expect(container.innerHTML).not.toContain('data-testid="audit-has-more"');
    expect(container.innerHTML).not.toMatch(/older entries not loaded/i);
  });
});

// ── resolveAuditDrawerView ──────────────────────────────────────────────────

describe("resolveAuditDrawerView (fail-closed phases)", () => {
  it("pending open/filter → loading, never empty", () => {
    const v = resolveAuditDrawerView({
      controlled: false,
      open: true,
      loading: false,
      resultFilterKey: null,
      filterKey: "t1",
      error: null,
      rowCount: 0,
      hasMore: false,
      total: 0,
    });
    expect(v.showLoading).toBe(true);
    expect(v.showEmpty).toBe(false);
    expect(v.showError).toBe(false);
  });

  it("loading true → loading", () => {
    const v = resolveAuditDrawerView({
      controlled: false,
      open: true,
      loading: true,
      resultFilterKey: null,
      filterKey: "",
      error: null,
      rowCount: 3,
      hasMore: false,
      total: 3,
    });
    expect(v.showLoading).toBe(true);
    expect(v.showRows).toBe(false);
  });

  it("settled error → error UI, not empty", () => {
    const v = resolveAuditDrawerView({
      controlled: false,
      open: true,
      loading: false,
      resultFilterKey: "t1",
      filterKey: "t1",
      error: "Audit response was invalid — trail not shown.",
      rowCount: 0,
      hasMore: false,
      total: 0,
    });
    expect(v.showError).toBe(true);
    expect(v.showEmpty).toBe(false);
    expect(v.showLoading).toBe(false);
  });

  it("settled empty success → empty only", () => {
    const v = resolveAuditDrawerView({
      controlled: false,
      open: true,
      loading: false,
      resultFilterKey: "",
      filterKey: "",
      error: null,
      rowCount: 0,
      hasMore: false,
      total: 0,
    });
    expect(v.showEmpty).toBe(true);
    expect(v.showHasMore).toBe(false);
  });

  it("0 rows + hasMore/total → hasMore honesty, not empty", () => {
    const v = resolveAuditDrawerView({
      controlled: false,
      open: true,
      loading: false,
      resultFilterKey: "a",
      filterKey: "a",
      error: null,
      rowCount: 0,
      hasMore: true,
      total: 9,
    });
    expect(v.showEmpty).toBe(false);
    expect(v.showHasMore).toBe(true);
  });

  it("filter key mismatch treats prior result as pending", () => {
    const v = resolveAuditDrawerView({
      controlled: false,
      open: true,
      loading: false,
      resultFilterKey: "old",
      filterKey: "new",
      error: null,
      rowCount: 2,
      hasMore: false,
      total: 2,
    });
    expect(v.showLoading).toBe(true);
    expect(v.showRows).toBe(false);
  });

  it("rows + hasMore shows both rows and truncation banner", () => {
    const v = resolveAuditDrawerView({
      controlled: false,
      open: true,
      loading: false,
      resultFilterKey: "t",
      filterKey: "t",
      error: null,
      rowCount: 5,
      hasMore: true,
      total: 20,
    });
    expect(v.showRows).toBe(true);
    expect(v.showHasMore).toBe(true);
    expect(v.showEmpty).toBe(false);
  });

  it("soft-dropped rows show showDropped without forcing showHasMore", () => {
    const v = resolveAuditDrawerView({
      controlled: false,
      open: true,
      loading: false,
      resultFilterKey: "t",
      filterKey: "t",
      error: null,
      rowCount: 8,
      hasMore: false,
      total: 10,
      droppedInvalid: 2,
    });
    expect(v.showRows).toBe(true);
    expect(v.showDropped).toBe(true);
    expect(v.showHasMore).toBe(false);
  });

  it("open:false → zero UI flags", () => {
    const v = resolveAuditDrawerView({
      controlled: false,
      open: false,
      loading: false,
      resultFilterKey: "t",
      filterKey: "t",
      error: null,
      rowCount: 3,
      hasMore: true,
      total: 10,
      droppedInvalid: 1,
    });
    expect(v).toEqual({
      showLoading: false,
      showError: false,
      showEmpty: false,
      showRows: false,
      showHasMore: false,
      showDropped: false,
    });
  });

  it("controlled truncated-empty shows hasMore not empty", () => {
    const v = resolveAuditDrawerView({
      controlled: true,
      open: true,
      loading: false,
      resultFilterKey: null,
      filterKey: "",
      error: null,
      rowCount: 0,
      hasMore: true,
      total: 5,
    });
    expect(v.showEmpty).toBe(false);
    expect(v.showHasMore).toBe(true);
    expect(v.showLoading).toBe(false);
  });

  it("controlled empty success shows empty", () => {
    const v = resolveAuditDrawerView({
      controlled: true,
      open: true,
      loading: false,
      resultFilterKey: null,
      filterKey: "",
      error: null,
      rowCount: 0,
      hasMore: false,
      total: 0,
    });
    expect(v.showEmpty).toBe(true);
    expect(v.showHasMore).toBe(false);
  });

  it("controlled rows + droppedInvalid shows showDropped", () => {
    const v = resolveAuditDrawerView({
      controlled: true,
      open: true,
      loading: false,
      resultFilterKey: null,
      filterKey: "",
      error: null,
      rowCount: 2,
      hasMore: false,
      total: 4,
      droppedInvalid: 2,
    });
    expect(v.showRows).toBe(true);
    expect(v.showDropped).toBe(true);
    expect(v.showHasMore).toBe(false);
  });
});

// ── pure helpers ────────────────────────────────────────────────────────────

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

  it("detailPreview prefers reason for needs_approval mediation", () => {
    expect(
      detailPreview({
        tool: "shell",
        decision: "needs_approval",
        reason: "Plan ready for review",
      }),
    ).toBe("Plan ready for review");
    expect(
      detailPreview({
        tool: "shell",
        decision: "needs_approval",
      }),
    ).toBe("needs_approval");
  });

  it("policyMediationDecision reads needs_approval only", () => {
    expect(
      policyMediationDecision({ decision: "needs_approval", tool: "x" }),
    ).toBe("needs_approval");
    expect(policyMediationDecision({ decision: "allow" })).toBeNull();
    expect(policyMediationDecision({})).toBeNull();
    expect(policyMediationDecision(null)).toBeNull();
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

  it("normalizeEntryDetail marks non-object detail as corrupt", () => {
    expect(normalizeEntryDetail(undefined)).toEqual({});
    expect(normalizeEntryDetail(null)).toEqual({});
    expect(normalizeEntryDetail({ command: "ls" })).toEqual({ command: "ls" });
    expect(normalizeEntryDetail("not-an-object")).toEqual({
      _corruptDetail: true,
    });
    expect(normalizeEntryDetail(42)).toEqual({ _corruptDetail: true });
    expect(normalizeEntryDetail(["array"])).toEqual({ _corruptDetail: true });
  });

  it("normalizeAuditTaskIds prefers taskIds over taskId, dedupes, sorts", () => {
    expect(normalizeAuditTaskIds(["t2", "t1", "t2", ""], "ignored")).toEqual([
      "t1",
      "t2",
    ]);
    expect(normalizeAuditTaskIds(null, "solo")).toEqual(["solo"]);
    expect(normalizeAuditTaskIds([], null)).toEqual([]);
    expect(normalizeAuditTaskIds(undefined, undefined)).toEqual([]);
  });

  it("normalizeAuditTaskIds: all-blank taskIds falls through to taskId (not global)", () => {
    expect(normalizeAuditTaskIds(["", ""], "real-task")).toEqual(["real-task"]);
    // No fallback taskId → sentinel scope, never []
    expect(normalizeAuditTaskIds(["", ""], null)).toEqual([
      AUDIT_INVALID_SCOPE_SENTINEL,
    ]);
    expect(normalizeAuditTaskIds(["", ""], undefined)).toEqual([
      AUDIT_INVALID_SCOPE_SENTINEL,
    ]);
    expect(normalizeAuditTaskIds(["", ""], "")).toEqual([
      AUDIT_INVALID_SCOPE_SENTINEL,
    ]);
  });

  it("auditFilterKey is empty for global and set-stable across order", () => {
    expect(auditFilterKey([])).toBe("");
    expect(auditFilterKey(["a", "b"])).toBe("a\0b");
    expect(auditFilterKey(["b", "a"])).toBe(auditFilterKey(["a", "b"]));
    expect(auditFilterKey(["a", "b"])).toBe(auditFilterKey(["a", "b"]));
    expect(auditFilterKey(normalizeAuditTaskIds(["t2", "t1"]))).toBe(
      auditFilterKey(normalizeAuditTaskIds(["t1", "t2"])),
    );
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
      expect(page.droppedInvalid).toBe(0);
    }
  });

  it("rejects non-array entries as malformed (not empty success)", () => {
    expect(parseAuditListPage({ entries: null, total: 0 }).ok).toBe(false);
    expect(parseAuditListPage({ entries: undefined }).ok).toBe(false);
    expect(parseAuditListPage({}).ok).toBe(false);
    expect(parseAuditListPage(null).ok).toBe(false);
    expect(parseAuditListPage("nope").ok).toBe(false);
  });

  it("skips invalid rows, tracks droppedInvalid, does NOT force hasMore", () => {
    const page = parseAuditListPage({
      entries: [
        { garbage: true },
        entry({ id: "ok", action: "tool.read", decision: "allow" }),
        { id: "bad", action: "x", decision: "not-a-decision", createdAt: "t" },
      ],
      total: 3,
      hasMore: false,
    });
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.entries.map((e) => e.id)).toEqual(["ok"]);
      // Soft-skips are not pagination
      expect(page.hasMore).toBe(false);
      expect(page.droppedInvalid).toBe(2);
      expect(page.total).toBe(3);
    }
  });

  it("pagination hasMore remains true when server flags it (with drops)", () => {
    const page = parseAuditListPage({
      entries: [
        { garbage: true },
        entry({ id: "ok", action: "tool.read", decision: "allow" }),
      ],
      total: 20,
      hasMore: true,
    });
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.hasMore).toBe(true);
      expect(page.droppedInvalid).toBe(1);
    }
  });

  it("all-invalid entries array is malformed — not empty success", () => {
    const page = parseAuditListPage({
      entries: [
        { garbage: true },
        { id: "bad", action: "x", decision: "not-a-decision", createdAt: "t" },
        null,
        "string-row",
      ],
      total: 4,
      hasMore: false,
    });
    expect(page.ok).toBe(false);
    if (!page.ok) {
      expect(page.reason).toBe("malformed");
    }
  });

  it("marks non-object detail with _corruptDetail", () => {
    const page = parseAuditListPage({
      entries: [
        {
          id: "c1",
          taskId: "t1",
          action: "tool.shell",
          decision: "approve",
          createdAt: "2026-08-04T12:00:00.000Z",
          detail: "corrupt-string",
        },
      ],
      total: 1,
      hasMore: false,
    });
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.entries[0].detail).toEqual({ _corruptDetail: true });
      expect(entryIntegrity(page.entries[0].detail).corruptDetail).toBe(true);
    }
  });

  it("truly empty entries array is ok empty success", () => {
    const page = parseAuditListPage({
      entries: [],
      total: 0,
      hasMore: false,
    });
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.entries).toEqual([]);
      expect(page.hasMore).toBe(false);
      expect(page.droppedInvalid).toBe(0);
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
      expect(result.droppedInvalid).toBe(0);
    }
    expect(listFn).toHaveBeenCalledTimes(2);
    // Order of calls follows sorted normalize output
    expect(listFn).toHaveBeenCalledWith({ taskId: "new-turn", limit: 100 });
    expect(listFn).toHaveBeenCalledWith({ taskId: "old-turn", limit: 100 });
  });

  it("multi-task all-empty merge is empty success", async () => {
    const listFn = vi.fn(async () => ({
      entries: [],
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
    }));
    const result = await loadAuditListPages(listFn, {
      taskIds: ["a", "b"],
      limit: 100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.droppedInvalid).toBe(0);
    }
    expect(listFn).toHaveBeenCalledTimes(2);
  });

  it("multi-task partial soft-skip accumulates droppedInvalid without false hasMore", async () => {
    const listFn = vi.fn(async (params: { taskId?: string }) => {
      if (params.taskId === "a") {
        return {
          entries: [
            { garbage: true } as unknown as AuditEntry,
            entry({ id: "a1", taskId: "a", action: "x", decision: "info" }),
          ],
          total: 2,
          hasMore: false,
          limit: 100,
          offset: 0,
        };
      }
      return {
        entries: [
          entry({ id: "b1", taskId: "b", action: "y", decision: "deny" }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });
    const result = await loadAuditListPages(listFn, {
      taskIds: ["a", "b"],
      limit: 100,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(2);
      expect(result.droppedInvalid).toBe(1);
      // No page was truncated by pagination
      expect(result.hasMore).toBe(false);
    }
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

  it("fail-closes when all entries soft-skip (corrupt page)", async () => {
    const listFn = vi.fn(async () => ({
      entries: [{ garbage: true }] as unknown as AuditEntry[],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    }));
    const result = await loadAuditListPages(listFn, { taskId: "t1" });
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

  it("caps merged multi-task results to limit and sets hasMore", async () => {
    const listFn = vi.fn(async (params: { taskId?: string }) => {
      const tid = params.taskId ?? "x";
      // Each task returns 3 entries → 6 merged; limit 2 → cap + hasMore
      return {
        entries: [1, 2, 3].map((n) =>
          entry({
            id: `${tid}-${n}`,
            taskId: tid,
            action: `tool.${tid}`,
            decision: "info",
            createdAt: `2026-08-04T1${n}:00:00.000Z`,
          }),
        ),
        total: 3,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });
    const result = await loadAuditListPages(listFn, {
      taskIds: ["a", "b"],
      limit: 2,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entries).toHaveLength(2);
      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(6);
    }
  });

  it("multi-task: one of N throws → whole load reason error", async () => {
    const listFn = vi.fn(async (params: { taskId?: string }) => {
      if (params.taskId === "bad") {
        throw new Error("IPC fail for bad");
      }
      return {
        entries: [
          entry({ id: "ok1", taskId: "good", action: "x", decision: "info" }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });
    const result = await loadAuditListPages(listFn, {
      taskIds: ["good", "bad"],
      limit: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("error");
    }
  });

  it("multi-task: one of N returns non-array entries → malformed", async () => {
    const listFn = vi.fn(async (params: { taskId?: string }) => {
      if (params.taskId === "bad") {
        return {
          entries: null as unknown as AuditEntry[],
          total: 0,
          hasMore: false,
          limit: 100,
          offset: 0,
        };
      }
      return {
        entries: [
          entry({ id: "ok1", taskId: "good", action: "x", decision: "info" }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });
    const result = await loadAuditListPages(listFn, {
      taskIds: ["good", "bad"],
      limit: 100,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("malformed");
    }
  });

  it("all-blank taskIds with taskId fallback scopes to taskId", async () => {
    const listFn = vi.fn(async (params: Record<string, unknown>) => ({
      entries: [],
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
      ...params,
    }));
    await loadAuditListPages(listFn, {
      taskIds: ["", ""],
      taskId: "fallback",
      limit: 10,
    });
    expect(listFn).toHaveBeenCalledWith({ taskId: "fallback", limit: 10 });
    expect(listFn.mock.calls[0][0]).not.toEqual({ limit: 10 });
  });

  it("all-blank taskIds without taskId uses sentinel (never global)", async () => {
    const listFn = vi.fn(async (params: Record<string, unknown>) => ({
      entries: [],
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
      ...params,
    }));
    await loadAuditListPages(listFn, {
      taskIds: ["", ""],
      limit: 10,
    });
    expect(listFn).toHaveBeenCalledWith({
      taskId: AUDIT_INVALID_SCOPE_SENTINEL,
      limit: 10,
    });
  });
});

describe("audit drawer wiring (structural)", () => {
  it("task workspace wires overflow View audit with stable sorted thread taskIds", async () => {
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
    // Thread-wide: stable useMemo'd auditTaskIds (not inline map every render)
    expect(ws).toMatch(/taskIds=\{auditTaskIds\}/);
    expect(ws).toMatch(/const auditTaskIds = useMemo/);
    expect(ws).toMatch(/threadTaskIdsKey/);
    // Set-stable sort so order-only churn does not thrash filter identity
    expect(ws).toMatch(/localeCompare/);
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
    expect(en.audit.droppedInvalid).toMatch(/invalid/i);
    expect(en.audit.needsApproval).toMatch(/approval/i);
    expect(en.audit.malformed).toBeTruthy();
    expect(en.audit.unknownDecision).toBeTruthy();
    expect(en.audit.corruptDetail).toBeTruthy();
  });
});
