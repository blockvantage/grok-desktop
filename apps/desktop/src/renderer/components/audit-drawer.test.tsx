/**
 * Audit drawer (trust Phase A2): empty + row render.
 * Node/vitest: mock Sheet so content is SSR-safe without Radix portals.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AuditEntry } from "@grokdesk/shared";
import { AuditDrawer } from "./audit-drawer";

vi.mock("@/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    const map: Record<string, string> = {
      "audit.title": "Audit decisions",
      "audit.titleTask": "Audit · {label}",
      "audit.subtitle": "Permission and tool decisions for this task.",
      "audit.subtitleGlobal": "Recent permission and tool decisions.",
      "audit.emptyTitle": "No decisions yet",
      "audit.emptyDesc": "When Grok asks for approval or tools run under policy, decisions show up here.",
      "audit.loading": "Loading audit…",
      "audit.loadFailed": "Could not load audit trail",
      "audit.hasMore": "Showing {shown} of {total}",
      "audit.refresh": "Refresh",
      "audit.globalLabel": "All tasks",
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
  }) => (open ? createElement("div", { "data-testid": "audit-sheet" }, children) : null),
  SheetContent: ({ children, ...rest }: { children?: React.ReactNode }) =>
    createElement("div", { "data-testid": "audit-sheet-content", ...rest }, children),
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

function entry(partial: Partial<AuditEntry> & Pick<AuditEntry, "id" | "action" | "decision">): AuditEntry {
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

describe("AuditDrawer", () => {
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
});
