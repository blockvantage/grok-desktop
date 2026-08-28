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
  deriveAuditTaskIds,
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
  stripSpoofedProvenance,
  useWorkspaceAuditTaskIds,
  WorkspaceAuditDrawer,
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
  listPermissionGrants: async () => [],
  revokePermissionGrant: async () => ({ ok: true }),
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

// TaskOverflowMenu pulls desktop grant UI that needs ToastProvider; stub for
// entry-point open→list runtime proof.
vi.mock("@/components/desktop-task-toggle", () => ({
  DesktopTaskMenuItems: () => null,
}));

// Always-open dropdown (no radix portal) so View audit is clickable in jsdom.
vi.mock("@/components/ui/dropdown-menu", () => {
  const passthrough = ({
    children,
    ...rest
  }: {
    children?: React.ReactNode;
    [k: string]: unknown;
  }) => createElement("div", rest, children);
  const Item = ({
    children,
    onClick,
    ...rest
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [k: string]: unknown;
  }) =>
    createElement(
      "button",
      { type: "button", onClick, ...rest },
      children,
    );
  return {
    DropdownMenu: passthrough,
    DropdownMenuTrigger: ({
      children,
    }: {
      children?: React.ReactNode;
      asChild?: boolean;
    }) => createElement("div", { "data-testid": "overflow-trigger" }, children),
    DropdownMenuContent: passthrough,
    DropdownMenuItem: Item,
    DropdownMenuLabel: passthrough,
    DropdownMenuSeparator: () => createElement("hr"),
    DropdownMenuGroup: passthrough,
    DropdownMenuPortal: passthrough,
    DropdownMenuSub: passthrough,
    DropdownMenuSubContent: passthrough,
    DropdownMenuSubTrigger: Item,
    DropdownMenuRadioGroup: passthrough,
    DropdownMenuCheckboxItem: Item,
    DropdownMenuRadioItem: Item,
    DropdownMenuShortcut: passthrough,
  };
});

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
  it("renders remembered grants with revoke", () => {
    const html = render({
      open: true,
      entries: [],
      grants: [
        {
          id: "g1",
          scopeRoot: "/ws",
          toolPattern: "Bash(git *)",
          decision: "allow",
          createdAt: "2026-08-27T00:00:00.000Z",
        },
      ],
    });
    expect(html).toContain('data-testid="audit-grants"');
    expect(html).toContain("Bash(git *)");
    expect(html).toContain('data-testid="audit-grant-revoke"');
  });

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

  it("suppresses mediation chrome when decision column is not info (fail-closed)", () => {
    // Writer-controlled detail.decision must not invent parked-approval over allow.
    const html = render({
      open: true,
      entries: [
        entry({
          id: "spoof-allow",
          action: "tool.shell",
          decision: "allow",
          detail: {
            tool: "shell",
            decision: "needs_approval",
            reason: "Plan ready for review",
          },
        }),
      ],
    });
    expect(html).toContain('data-audit-decision="allow"');
    expect(html).not.toContain('data-audit-mediation=');
    expect(html).not.toContain('data-testid="audit-mediation-badge"');
    expect(html).not.toContain('data-testid="audit-needs-approval-note"');
    expect(html).not.toMatch(/Needs approval/i);
    expect(html).not.toMatch(/Parked for your approval/i);
    // Preview falls through to tool (not mediation-biased reason path)
    expect(html).toMatch(/shell/);
  });

  it("suppresses _unknownDecision provenance when decision is not info", () => {
    const html = render({
      open: true,
      entries: [
        entry({
          id: "spoof-deny",
          action: "policy.note",
          decision: "deny",
          detail: {
            _unknownDecision: "bogus-decision",
            summary: "should not claim remapped",
          },
        }),
      ],
    });
    expect(html).toContain('data-audit-decision="deny"');
    expect(html).not.toContain('data-audit-unknown-decision=');
    expect(html).not.toContain('data-testid="audit-unknown-decision"');
    expect(html).not.toContain('data-testid="audit-unknown-decision-note"');
    expect(html).not.toMatch(/shown as info/i);
    expect(html).not.toMatch(/Unknown decision/i);
  });

  it("suppresses spoofed _corruptDetail object marker when decision is not info", () => {
    // AuditRow re-normalizes controlled rows — spoofed object markers drop on allow.
    const html = render({
      open: true,
      entries: [
        entry({
          id: "spoof-corrupt",
          action: "tool.shell",
          decision: "allow",
          detail: { _corruptDetail: true, command: "ls" },
        }),
      ],
    });
    expect(html).toContain('data-audit-decision="allow"');
    expect(html).toContain('data-audit-action="tool.shell"');
    expect(html).not.toContain('data-audit-corrupt-detail=');
    expect(html).not.toContain('data-testid="audit-corrupt-detail"');
    expect(html).not.toContain('data-testid="audit-corrupt-detail-note"');
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

  it("multi-task one-of-N failure shows audit-error UI (not empty success)", async () => {
    listMock.mockImplementation(async (params: { taskId?: string }) => {
      if (params.taskId === "bad") {
        throw new Error("IPC fail for bad turn");
      }
      return {
        entries: [
          entry({
            id: "ok1",
            taskId: "good",
            action: "tool.ok",
            decision: "info",
          }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });

    mount({ open: true, taskIds: ["good", "bad"] });
    await flushLoad();

    expect(listMock).toHaveBeenCalled();
    expect(container.innerHTML).toContain('data-testid="audit-error"');
    expect(container.innerHTML).toMatch(/IPC fail for bad turn|Could not load audit trail/i);
    expect(container.innerHTML).not.toContain('data-audit-empty="true"');
    expect(container.innerHTML).not.toContain('data-audit-action="tool.ok"');
    // Partial rows from the good turn must not paint as success.
    expect(container.innerHTML).not.toContain('data-audit-decision="info"');
  });

  it("multi-task one-of-N malformed page shows audit-error UI (not empty/partial success)", async () => {
    listMock.mockImplementation(async (params: { taskId?: string }) => {
      if (params.taskId === "bad") {
        return {
          entries: null,
          total: 0,
          hasMore: false,
          limit: 100,
          offset: 0,
        };
      }
      return {
        entries: [
          entry({
            id: "ok1",
            taskId: "good",
            action: "tool.ok",
            decision: "allow",
          }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });

    mount({ open: true, taskIds: ["good", "bad"] });
    await flushLoad();

    expect(listMock).toHaveBeenCalled();
    expect(container.innerHTML).toContain('data-testid="audit-error"');
    expect(container.innerHTML).toMatch(/invalid/i);
    expect(container.innerHTML).not.toContain('data-audit-empty="true"');
    expect(container.innerHTML).not.toContain('data-audit-action="tool.ok"');
    expect(container.innerHTML).not.toMatch(/no decisions yet/i);
  });

  it("same taskIds membership in different array order does not re-fetch", async () => {
    listMock.mockResolvedValue({
      entries: [
        entry({ id: "1", taskId: "a", action: "tool.a", decision: "allow" }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    mount({ open: true, taskIds: ["b", "a"] });
    await flushLoad();
    const callsAfterFirst = listMock.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(2); // one page per task

    // Parent thrash: same membership, fresh order — filterKey must not change.
    mount({ open: true, taskIds: ["a", "b"] });
    await act(async () => {
      await Promise.resolve();
    });
    expect(listMock.mock.calls.length).toBe(callsAfterFirst);
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

  it("settled hasMore:true paints truncated-trail honesty (audit-has-more)", async () => {
    listMock.mockResolvedValueOnce({
      entries: [
        entry({
          id: "1",
          taskId: "t1",
          action: "tool.shell",
          decision: "approve",
        }),
      ],
      total: 42,
      hasMore: true,
      limit: 100,
      offset: 0,
    });

    mount({ open: true, taskId: "t1" });
    await flushLoad();

    expect(container.innerHTML).toContain('data-audit-action="tool.shell"');
    expect(container.innerHTML).toContain('data-testid="audit-has-more"');
    expect(container.innerHTML).toMatch(/Showing 1 of 42/i);
    expect(container.innerHTML).toMatch(/older entries not loaded/i);
    expect(container.innerHTML).not.toContain('data-audit-empty="true"');
  });

  it("settled total>page without hasMore flag still shows truncated trail", async () => {
    // Server reports total beyond page length but forgets hasMore — fail-closed.
    listMock.mockResolvedValueOnce({
      entries: [
        entry({
          id: "1",
          taskId: "t1",
          action: "tool.read",
          decision: "allow",
        }),
      ],
      total: 10,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    mount({ open: true, taskId: "t1" });
    await flushLoad();

    expect(container.innerHTML).toContain('data-testid="audit-has-more"');
    expect(container.innerHTML).toMatch(/Showing 1 of 10/i);
    expect(container.innerHTML).toMatch(/older entries not loaded/i);
  });

  it("filter identity change while open discards late A and settles B only", async () => {
    let resolveA!: (v: unknown) => void;
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    );

    mount({ open: true, taskId: "task-a" });
    expect(container.innerHTML).toContain('data-testid="audit-loading"');
    expect(listMock).toHaveBeenCalledWith({ taskId: "task-a", limit: 100 });

    // Mid-flight: thread expands / switches to task B
    listMock.mockResolvedValueOnce({
      entries: [
        entry({
          id: "b1",
          taskId: "task-b",
          action: "tool.b",
          decision: "deny",
        }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });
    mount({ open: true, taskId: "task-b" });
    // Immediate filter swap → loading, not A's empty/rows
    expect(container.innerHTML).toContain('data-testid="audit-loading"');
    expect(container.innerHTML).not.toContain('data-audit-action="tool.a"');
    expect(container.innerHTML).not.toContain('data-audit-empty="true"');

    // Late A must not apply
    await act(async () => {
      resolveA({
        entries: [
          entry({
            id: "a1",
            taskId: "task-a",
            action: "tool.a",
            decision: "allow",
          }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      });
      await Promise.resolve();
    });
    expect(container.innerHTML).not.toContain('data-audit-action="tool.a"');

    await flushLoad();
    expect(container.innerHTML).toContain('data-audit-action="tool.b"');
    expect(container.innerHTML).toContain('data-audit-decision="deny"');
    expect(container.innerHTML).not.toContain('data-audit-action="tool.a"');
    expect(listMock).toHaveBeenCalledWith({ taskId: "task-b", limit: 100 });
  });

  it("refresh control re-fetches and updates rows", async () => {
    listMock.mockResolvedValueOnce({
      entries: [
        entry({
          id: "old",
          taskId: "t1",
          action: "tool.old",
          decision: "allow",
        }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    mount({ open: true, taskId: "t1" });
    await flushLoad();
    expect(container.innerHTML).toContain('data-audit-action="tool.old"');
    expect(listMock).toHaveBeenCalledTimes(1);

    let resolveRefresh!: (v: unknown) => void;
    listMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    const refresh = container.querySelector(
      '[data-testid="audit-refresh"]',
    ) as HTMLButtonElement | null;
    expect(refresh).toBeTruthy();
    await act(async () => {
      refresh!.click();
    });
    // In-flight refresh clears prior rows and shows loading (not stale old).
    expect(container.innerHTML).toContain('data-testid="audit-loading"');
    expect(container.innerHTML).not.toContain('data-audit-action="tool.old"');

    await act(async () => {
      resolveRefresh({
        entries: [
          entry({
            id: "new",
            taskId: "t1",
            action: "tool.new",
            decision: "approve",
          }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      });
      await Promise.resolve();
    });

    expect(listMock).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('data-audit-action="tool.new"');
    expect(container.innerHTML).not.toContain('data-audit-action="tool.old"');
    expect(container.innerHTML).not.toContain('data-testid="audit-loading"');
  });

  it("refresh after error reloads successfully", async () => {
    listMock.mockRejectedValueOnce(new Error("IPC down"));
    mount({ open: true, taskId: "t1" });
    await flushLoad();
    expect(container.innerHTML).toContain('data-testid="audit-error"');

    listMock.mockResolvedValueOnce({
      entries: [
        entry({ id: "ok", taskId: "t1", action: "tool.ok", decision: "allow" }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });
    const refresh = container.querySelector(
      '[data-testid="audit-refresh"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      refresh!.click();
    });
    await flushLoad();
    expect(container.innerHTML).toContain('data-audit-action="tool.ok"');
    expect(container.innerHTML).not.toContain('data-testid="audit-error"');
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

  it("detailPreview prefers reason for needs_approval mediation only with info column", () => {
    expect(
      detailPreview(
        {
          tool: "shell",
          decision: "needs_approval",
          reason: "Plan ready for review",
        },
        "info",
      ),
    ).toBe("Plan ready for review");
    expect(
      detailPreview(
        {
          tool: "shell",
          decision: "needs_approval",
        },
        "info",
      ),
    ).toBe("needs_approval");
    // Without info column: no mediation-biased preview
    expect(
      detailPreview(
        {
          tool: "shell",
          decision: "needs_approval",
          reason: "Plan ready for review",
        },
        "allow",
      ),
    ).toBe("shell");
    expect(
      detailPreview({
        tool: "shell",
        decision: "needs_approval",
        reason: "Plan ready for review",
      }),
    ).toBe("shell");
  });

  it("policyMediationDecision requires info column + needs_approval detail", () => {
    expect(
      policyMediationDecision({ decision: "needs_approval", tool: "x" }, "info"),
    ).toBe("needs_approval");
    // Fail-closed: non-info column never surfaces mediation
    expect(
      policyMediationDecision(
        { decision: "needs_approval", tool: "x" },
        "allow",
      ),
    ).toBeNull();
    expect(
      policyMediationDecision(
        { decision: "needs_approval", tool: "x" },
        "deny",
      ),
    ).toBeNull();
    expect(
      policyMediationDecision({ decision: "needs_approval", tool: "x" }),
    ).toBeNull();
    expect(policyMediationDecision({ decision: "allow" }, "info")).toBeNull();
    expect(policyMediationDecision({}, "info")).toBeNull();
    expect(policyMediationDecision(null, "info")).toBeNull();
  });

  it("decisionBadgeVariant maps allow/approve/deny/reject/info", () => {
    expect(decisionBadgeVariant("deny")).toBe("destructive");
    expect(decisionBadgeVariant("reject")).toBe("destructive");
    expect(decisionBadgeVariant("allow")).toBe("default");
    expect(decisionBadgeVariant("approve")).toBe("default");
    expect(decisionBadgeVariant("info")).toBe("outline");
  });

  it("entryIntegrity requires info column for _unknownDecision; corrupt is orthogonal", () => {
    expect(entryIntegrity({ _unknownDecision: "bogus", foo: 1 }, "info")).toEqual(
      {
        unknownDecision: "bogus",
        corruptDetail: false,
      },
    );
    // Fail-closed: spoofed unknown marker over allow/deny is ignored
    expect(
      entryIntegrity({ _unknownDecision: "bogus", foo: 1 }, "allow"),
    ).toEqual({
      unknownDecision: null,
      corruptDetail: false,
    });
    expect(
      entryIntegrity({ _unknownDecision: "bogus" }, "deny"),
    ).toEqual({
      unknownDecision: null,
      corruptDetail: false,
    });
    expect(entryIntegrity({ _unknownDecision: "bogus" })).toEqual({
      unknownDecision: null,
      corruptDetail: false,
    });
    expect(entryIntegrity({ _corruptDetail: true }, "info")).toEqual({
      unknownDecision: null,
      corruptDetail: true,
    });
    // Structural corrupt still surfaces on non-info (detail integrity)
    expect(entryIntegrity({ _corruptDetail: true }, "allow")).toEqual({
      unknownDecision: null,
      corruptDetail: true,
    });
    expect(entryIntegrity({ _corruptDetail: "yes" }, "info")).toEqual({
      unknownDecision: null,
      corruptDetail: false,
    });
    expect(entryIntegrity(null)).toEqual({
      unknownDecision: null,
      corruptDetail: false,
    });
  });

  it("stripSpoofedProvenance drops reserved keys", () => {
    expect(
      stripSpoofedProvenance({
        command: "ls",
        _unknownDecision: "x",
        _corruptDetail: true,
      }),
    ).toEqual({ command: "ls" });
  });

  it("normalizeEntryDetail marks non-object detail as corrupt; strips spoof on non-info", () => {
    expect(normalizeEntryDetail(undefined)).toEqual({});
    expect(normalizeEntryDetail(null)).toEqual({});
    expect(normalizeEntryDetail({ command: "ls" })).toEqual({ command: "ls" });
    expect(normalizeEntryDetail("not-an-object")).toEqual({
      _corruptDetail: true,
    });
    expect(normalizeEntryDetail(42)).toEqual({ _corruptDetail: true });
    expect(normalizeEntryDetail(["array"])).toEqual({ _corruptDetail: true });
    // Re-attach provenance for info column
    expect(
      normalizeEntryDetail(
        { command: "ls", _unknownDecision: "bogus", _corruptDetail: true },
        "info",
      ),
    ).toEqual({
      command: "ls",
      _unknownDecision: "bogus",
      _corruptDetail: true,
    });
    // Fail-closed: strip spoofed markers over allow (with other fields)
    expect(
      normalizeEntryDetail(
        { command: "ls", _unknownDecision: "bogus", _corruptDetail: true },
        "allow",
      ),
    ).toEqual({ command: "ls" });
    // Structural-only bag stays idempotent on non-info (double-normalize safe)
    expect(normalizeEntryDetail({ _corruptDetail: true }, "approve")).toEqual({
      _corruptDetail: true,
    });
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

  it("hasMore is true when reportedTotal > rawCount even if hasMore flag is false", () => {
    // Fail-closed truncation: do not trust only the server flag.
    const page = parseAuditListPage({
      entries: [
        entry({ id: "ok", action: "tool.read", decision: "allow" }),
      ],
      total: 50,
      hasMore: false,
    });
    expect(page.ok).toBe(true);
    if (page.ok) {
      expect(page.hasMore).toBe(true);
      expect(page.total).toBe(50);
      expect(page.entries).toHaveLength(1);
      expect(page.droppedInvalid).toBe(0);
    }
  });

  it("strips spoofed provenance on non-info decisions; re-attaches only for info", () => {
    const spoofedAllow = parseAuditListPage({
      entries: [
        {
          id: "a1",
          taskId: "t1",
          action: "tool.shell",
          decision: "allow",
          createdAt: "2026-08-04T12:00:00.000Z",
          detail: {
            command: "ls",
            _unknownDecision: "spoofed",
            _corruptDetail: true,
          },
        },
      ],
      total: 1,
      hasMore: false,
    });
    expect(spoofedAllow.ok).toBe(true);
    if (spoofedAllow.ok) {
      expect(spoofedAllow.entries[0].detail).toEqual({ command: "ls" });
      expect(
        entryIntegrity(spoofedAllow.entries[0].detail, "allow").unknownDecision,
      ).toBeNull();
      expect(
        entryIntegrity(spoofedAllow.entries[0].detail, "allow").corruptDetail,
      ).toBe(false);
    }

    const infoOk = parseAuditListPage({
      entries: [
        {
          id: "i1",
          taskId: "t1",
          action: "policy.note",
          decision: "info",
          createdAt: "2026-08-04T12:00:00.000Z",
          detail: {
            summary: "remapped",
            _unknownDecision: "bogus-decision",
          },
        },
      ],
      total: 1,
      hasMore: false,
    });
    expect(infoOk.ok).toBe(true);
    if (infoOk.ok) {
      expect(infoOk.entries[0].detail._unknownDecision).toBe("bogus-decision");
      expect(
        entryIntegrity(infoOk.entries[0].detail, "info").unknownDecision,
      ).toBe("bogus-decision");
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
      // Structural corruption is client-observed — surfaces for any decision.
      expect(
        entryIntegrity(page.entries[0].detail, "approve").corruptDetail,
      ).toBe(true);
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

  it("missing or non-finite total falls back to rawCount (hasMore stays honest)", () => {
    const missing = parseAuditListPage({
      entries: [entry({ id: "1", action: "tool.a", decision: "allow" })],
      hasMore: false,
    });
    expect(missing.ok).toBe(true);
    if (missing.ok) {
      // reportedTotal = rawCount when total omitted → hasMore false (no false truncation).
      expect(missing.total).toBe(1);
      expect(missing.hasMore).toBe(false);
      expect(missing.entries).toHaveLength(1);
    }

    const undefinedTotal = parseAuditListPage({
      entries: [
        entry({ id: "1", action: "tool.a", decision: "allow" }),
        entry({ id: "2", action: "tool.b", decision: "deny" }),
      ],
      total: undefined,
      hasMore: false,
    });
    expect(undefinedTotal.ok).toBe(true);
    if (undefinedTotal.ok) {
      expect(undefinedTotal.total).toBe(2);
      expect(undefinedTotal.hasMore).toBe(false);
    }

    const nanTotal = parseAuditListPage({
      entries: [entry({ id: "1", action: "tool.a", decision: "allow" })],
      total: Number.NaN,
      hasMore: false,
    });
    expect(nanTotal.ok).toBe(true);
    if (nanTotal.ok) {
      expect(nanTotal.total).toBe(1);
      expect(nanTotal.hasMore).toBe(false);
    }

    const infTotal = parseAuditListPage({
      entries: [entry({ id: "1", action: "tool.a", decision: "allow" })],
      total: Number.POSITIVE_INFINITY,
      hasMore: false,
    });
    expect(infTotal.ok).toBe(true);
    if (infTotal.ok) {
      expect(infTotal.total).toBe(1);
      expect(infTotal.hasMore).toBe(false);
    }

    const stringTotal = parseAuditListPage({
      entries: [entry({ id: "1", action: "tool.a", decision: "allow" })],
      total: "99" as unknown as number,
      hasMore: false,
    });
    expect(stringTotal.ok).toBe(true);
    if (stringTotal.ok) {
      // Non-number total must not invent a larger reportedTotal / false hasMore.
      expect(stringTotal.total).toBe(1);
      expect(stringTotal.hasMore).toBe(false);
    }

    // Explicit hasMore:true still wins for pagination honesty.
    const flagged = parseAuditListPage({
      entries: [entry({ id: "1", action: "tool.a", decision: "allow" })],
      hasMore: true,
    });
    expect(flagged.ok).toBe(true);
    if (flagged.ok) {
      expect(flagged.hasMore).toBe(true);
      expect(flagged.total).toBe(1);
    }
  });
});

describe("deriveAuditTaskIds (workspace → drawer scope)", () => {
  it("returns sorted turn ids for a multi-turn thread", () => {
    expect(
      deriveAuditTaskIds(
        [{ id: "turn-b" }, { id: "turn-a" }, { id: "turn-c" }],
        "turn-c",
      ),
    ).toEqual(["turn-a", "turn-b", "turn-c"]);
  });

  it("is set-stable across order-only reshuffles", () => {
    const a = deriveAuditTaskIds(
      [{ id: "b" }, { id: "a" }],
      "b",
    );
    const b = deriveAuditTaskIds(
      [{ id: "a" }, { id: "b" }],
      "a",
    );
    expect(a).toEqual(b);
    expect(auditFilterKey(a)).toBe(auditFilterKey(b));
  });

  it("empty thread falls back to [currentTaskId] — never []/global", () => {
    expect(deriveAuditTaskIds([], "current")).toEqual(["current"]);
    expect(deriveAuditTaskIds(null, "current")).toEqual(["current"]);
    expect(deriveAuditTaskIds(undefined, "current")).toEqual(["current"]);
    expect(deriveAuditTaskIds([], "")).toEqual([AUDIT_INVALID_SCOPE_SENTINEL]);
  });

  it("never returns empty array that would open global list from task chrome", () => {
    const ids = deriveAuditTaskIds([{ id: "t1" }], "t1");
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).not.toEqual([]);
  });
});

// ── production WorkspaceAuditDrawer / useWorkspaceAuditTaskIds (behavioral) ─

describe("useWorkspaceAuditTaskIds + WorkspaceAuditDrawer (production scope)", () => {
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

  it("multi-turn threadTasks → lists every sorted turn id (not only current)", async () => {
    listMock.mockImplementation(async (params: { taskId?: string }) => ({
      entries: [
        entry({
          id: `${params.taskId}-1`,
          taskId: params.taskId ?? "x",
          action: `tool.${params.taskId}`,
          decision: "approve",
        }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    }));

    // Unsorted thread — production hook must sort + include all turns.
    const thread = [{ id: "turn-b" }, { id: "turn-a" }];
    act(() => {
      root.render(
        createElement(WorkspaceAuditDrawer, {
          open: true,
          onOpenChange: vi.fn(),
          threadTasks: thread,
          taskId: "turn-b",
          taskLabel: "Chat",
        }),
      );
    });
    await flushLoad();

    expect(listMock).toHaveBeenCalledWith({ taskId: "turn-a", limit: 100 });
    expect(listMock).toHaveBeenCalledWith({ taskId: "turn-b", limit: 100 });
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('data-audit-task-count="2"');
    expect(container.innerHTML).toContain('data-audit-action="tool.turn-a"');
    expect(container.innerHTML).toContain('data-audit-action="tool.turn-b"');
    // Not global
    expect(container.innerHTML).not.toContain('data-audit-filter="global"');
  });

  it("empty threadTasks → [task.id] only — never []/global", async () => {
    listMock.mockResolvedValueOnce({
      entries: [
        entry({
          id: "solo-1",
          taskId: "solo-task",
          action: "tool.shell",
          decision: "allow",
        }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    act(() => {
      root.render(
        createElement(WorkspaceAuditDrawer, {
          open: true,
          onOpenChange: vi.fn(),
          threadTasks: [],
          taskId: "solo-task",
        }),
      );
    });
    await flushLoad();

    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith({
      taskId: "solo-task",
      limit: 100,
    });
    expect(listMock.mock.calls[0][0]).not.toEqual({ limit: 100 });
    expect(container.innerHTML).toContain('data-audit-task-count="1"');
    expect(container.innerHTML).not.toContain('data-audit-filter="global"');
  });

  it("missing threadTasks falls back to current taskId (not global)", async () => {
    listMock.mockResolvedValueOnce({
      entries: [],
      total: 0,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    act(() => {
      root.render(
        createElement(WorkspaceAuditDrawer, {
          open: true,
          onOpenChange: vi.fn(),
          taskId: "current-only",
        }),
      );
    });
    await flushLoad();

    expect(listMock).toHaveBeenCalledWith({
      taskId: "current-only",
      limit: 100,
    });
    expect(container.innerHTML).not.toContain('data-audit-filter="global"');
  });

  it("order-only threadTasks reshuffle does not re-fetch (hook + drawer)", async () => {
    listMock.mockResolvedValue({
      entries: [
        entry({ id: "1", taskId: "a", action: "tool.a", decision: "allow" }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    act(() => {
      root.render(
        createElement(WorkspaceAuditDrawer, {
          open: true,
          onOpenChange: vi.fn(),
          threadTasks: [{ id: "b" }, { id: "a" }],
          taskId: "b",
        }),
      );
    });
    await flushLoad();
    const callsAfterFirst = listMock.mock.calls.length;
    expect(callsAfterFirst).toBe(2);

    // Parent thrash: same membership, fresh map() order (production risk).
    act(() => {
      root.render(
        createElement(WorkspaceAuditDrawer, {
          open: true,
          onOpenChange: vi.fn(),
          threadTasks: [{ id: "a" }, { id: "b" }],
          taskId: "a",
        }),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("useWorkspaceAuditTaskIds exposes sorted membership via probe mount", async () => {
    let latest: string[] = [];
    function Probe(props: {
      threadTasks: ReadonlyArray<{ id: string }> | null | undefined;
      taskId: string;
    }) {
      latest = useWorkspaceAuditTaskIds(props.threadTasks, props.taskId);
      return createElement(
        "div",
        { "data-testid": "ids", "data-ids": latest.join(",") },
        latest.join(","),
      );
    }

    act(() => {
      root.render(
        createElement(Probe, {
          threadTasks: [{ id: "z" }, { id: "a" }],
          taskId: "z",
        }),
      );
    });
    expect(latest).toEqual(["a", "z"]);
    expect(container.innerHTML).toContain("a,z");

    act(() => {
      root.render(
        createElement(Probe, {
          threadTasks: [],
          taskId: "solo",
        }),
      );
    });
    expect(latest).toEqual(["solo"]);
    expect(latest).not.toEqual([]);
  });

  it("multi-task one-of-N list failure surfaces audit-error via WorkspaceAuditDrawer UI", async () => {
    // Uncontrolled async on the production workspace host (not pure loadAuditListPages).
    listMock.mockImplementation(async (params: { taskId?: string }) => {
      if (params.taskId === "bad") {
        throw new Error("IPC fail for bad turn");
      }
      return {
        entries: [
          entry({
            id: "ok1",
            taskId: "good",
            action: "tool.ok",
            decision: "info",
          }),
        ],
        total: 1,
        hasMore: false,
        limit: 100,
        offset: 0,
      };
    });

    act(() => {
      root.render(
        createElement(WorkspaceAuditDrawer, {
          open: true,
          onOpenChange: vi.fn(),
          threadTasks: [{ id: "good" }, { id: "bad" }],
          taskId: "good",
        }),
      );
    });
    await flushLoad();

    expect(listMock).toHaveBeenCalled();
    expect(container.innerHTML).toContain('data-testid="audit-error"');
    expect(container.innerHTML).not.toContain('data-audit-empty="true"');
    expect(container.innerHTML).not.toContain('data-audit-action="tool.ok"');
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
  it("task workspace wires overflow View audit via WorkspaceAuditDrawer", async () => {
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
    // Production host owns thread-wide scope (not inline invent taskIds / single taskId).
    expect(ws).toMatch(/WorkspaceAuditDrawer/);
    expect(ws).toMatch(/threadTasks=\{props\.threadTasks\}/);
    expect(ws).toMatch(/taskId=\{task\.id\}/);
    expect(ws).not.toMatch(/taskIds=\{auditTaskIds\}/);
    // Must not pass only the focused turn as a single-task filter.
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

// ── runtime open → list proof (production entry points) ─────────────────────

describe("audit drawer entry-point runtime open→list", () => {
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

  it("overflow View audit opens WorkspaceAuditDrawer and lists each thread taskId", async () => {
    // Production pieces TaskWorkspaceView composes: overflow menu + WorkspaceAuditDrawer
    // (hook-derived thread scope — no invented taskIds array).
    const { useState } = await import("react");
    const { TaskOverflowMenu } = await import("./chat-actions-menu");

    listMock.mockImplementation(async (params: { taskId?: string }) => ({
      entries: [
        entry({
          id: params.taskId === "turn-b" ? "b1" : "a1",
          taskId: params.taskId ?? "x",
          action: params.taskId === "turn-b" ? "tool.b" : "tool.a",
          decision: "allow",
        }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    }));

    const threadTasks = [{ id: "turn-b" }, { id: "turn-a" }];

    function TaskWorkspaceAuditEntry() {
      // Mirrors TaskWorkspaceView: auditOpen state + overflow + WorkspaceAuditDrawer.
      const [auditOpen, setAuditOpen] = useState(false);
      return createElement(
        "div",
        null,
        createElement(TaskOverflowMenu, {
          taskId: "turn-b",
          onExport: () => undefined,
          onViewAudit: () => setAuditOpen(true),
        }),
        createElement(WorkspaceAuditDrawer, {
          open: auditOpen,
          onOpenChange: setAuditOpen,
          threadTasks,
          taskId: "turn-b",
          taskLabel: "Thread",
        }),
      );
    }

    act(() => {
      root.render(createElement(TaskWorkspaceAuditEntry));
    });
    // Closed: no list yet
    expect(listMock).not.toHaveBeenCalled();
    expect(container.innerHTML).not.toContain('data-testid="audit-drawer"');

    // Always-visible menu item (dropdown mock) with production test id
    const item = container.querySelector(
      '[data-testid="task-overflow-view-audit"]',
    ) as HTMLElement | null;
    expect(item).toBeTruthy();
    await act(async () => {
      item!.click();
    });

    expect(container.innerHTML).toContain('data-testid="audit-drawer"');
    await flushLoad();
    expect(listMock).toHaveBeenCalledWith({ taskId: "turn-a", limit: 100 });
    expect(listMock).toHaveBeenCalledWith({ taskId: "turn-b", limit: 100 });
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(container.innerHTML).toContain('data-audit-action="tool.a"');
    expect(container.innerHTML).toContain('data-audit-action="tool.b"');
    expect(container.innerHTML).toContain('data-audit-task-count="2"');
  });

  it("permissions Recent decisions opens global AuditDrawer (no taskId)", async () => {
    // Real PermissionsTab + desktop API stubs (not a hand-rolled button/drawer).
    listMock.mockResolvedValueOnce({
      entries: [
        entry({
          id: "g1",
          taskId: "anywhere",
          action: "tool.global",
          decision: "deny",
        }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    const getPermissions = vi.fn(async () => ({
      permissions: {
        accessibility: "granted",
        screenRecording: "granted",
        captureGranted: true,
        captureDetail: "ok",
        inputGranted: true,
        inputDetail: "ok",
      },
      machine: {
        enabled: false,
        allowDeletes: false,
      },
    }));
    const prev = (window as unknown as { grokdesk?: unknown }).grokdesk;
    (window as unknown as { grokdesk: unknown }).grokdesk = {
      desktop: {
        getPermissions,
        setMachine: vi.fn(),
        setMachineEnabled: vi.fn(),
        openCaptureSettings: vi.fn(),
        openInputSettings: vi.fn(),
        openAccessibility: vi.fn(),
        openScreenRecording: vi.fn(),
      },
    };

    try {
      const { PermissionsTab } = await import(
        "./views/settings/permissions-tab"
      );
      act(() => {
        root.render(createElement(PermissionsTab));
      });
      // Allow refresh effect to settle
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(listMock).not.toHaveBeenCalled();
      const btn = container.querySelector(
        '[data-testid="permissions-recent-decisions"]',
      ) as HTMLButtonElement | null;
      expect(btn).toBeTruthy();
      await act(async () => {
        btn!.click();
      });
      await flushLoad();

      expect(listMock).toHaveBeenCalledTimes(1);
      expect(listMock).toHaveBeenCalledWith({ limit: 100 });
      expect(listMock.mock.calls[0][0]).not.toHaveProperty("taskId");
      expect(container.innerHTML).toContain('data-audit-filter="global"');
      expect(container.innerHTML).toContain('data-audit-action="tool.global"');
      expect(container.innerHTML).toContain('data-audit-decision="deny"');
    } finally {
      if (prev === undefined) {
        delete (window as unknown as { grokdesk?: unknown }).grokdesk;
      } else {
        (window as unknown as { grokdesk: unknown }).grokdesk = prev;
      }
    }
  });

  it("overflow View audit with empty thread scopes to current taskId only", async () => {
    const { useState } = await import("react");
    const { TaskOverflowMenu } = await import("./chat-actions-menu");

    listMock.mockResolvedValueOnce({
      entries: [
        entry({
          id: "only",
          taskId: "solo",
          action: "tool.solo",
          decision: "deny",
        }),
      ],
      total: 1,
      hasMore: false,
      limit: 100,
      offset: 0,
    });

    function Entry() {
      const [auditOpen, setAuditOpen] = useState(false);
      return createElement(
        "div",
        null,
        createElement(TaskOverflowMenu, {
          taskId: "solo",
          onExport: () => undefined,
          onViewAudit: () => setAuditOpen(true),
        }),
        createElement(WorkspaceAuditDrawer, {
          open: auditOpen,
          onOpenChange: setAuditOpen,
          threadTasks: [],
          taskId: "solo",
        }),
      );
    }

    act(() => {
      root.render(createElement(Entry));
    });
    const item = container.querySelector(
      '[data-testid="task-overflow-view-audit"]',
    ) as HTMLElement;
    await act(async () => {
      item.click();
    });
    await flushLoad();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock).toHaveBeenCalledWith({ taskId: "solo", limit: 100 });
    expect(container.innerHTML).not.toContain('data-audit-filter="global"');
    expect(container.innerHTML).toContain('data-audit-action="tool.solo"');
  });
});
