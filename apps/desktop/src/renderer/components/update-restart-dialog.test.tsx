import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "@grokdesk/shared";
import {
  UpdateRestartDialog,
  shouldShowUpdateRestartDialog,
} from "./update-restart-dialog";

function status(partial: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase: "staged",
    channel: "stable",
    target: "darwin-arm64",
    installed: { deskVersion: "1.0.0", grokVersion: "0.9.0" },
    available: {
      pairId: "p1",
      deskVersion: "1.1.0",
      grokVersion: "0.9.4",
      channel: "stable",
    },
    ...partial,
  };
}

function render(
  props: Partial<React.ComponentProps<typeof UpdateRestartDialog>> = {},
) {
  return renderToStaticMarkup(
    createElement(UpdateRestartDialog, {
      open: true,
      status: status(),
      onInstallRestart: vi.fn(),
      onCancel: vi.fn(),
      onWaitForIdle: vi.fn(),
      ...props,
    }),
  );
}

describe("UpdateRestartDialog", () => {
  it("shows staged install and cancel controls", () => {
    const html = render();
    expect(html).toContain('data-testid="update-restart-dialog"');
    expect(html).toContain('data-update-phase="staged"');
    expect(html).toContain("Update ready");
    expect(html).toContain("1.1.0");
    expect(html).toContain("0.9.4");
    expect(html).toContain('data-testid="update-restart-install"');
    expect(html).toContain('data-testid="update-restart-wait"');
    expect(html).toContain('data-testid="update-restart-cancel"');
    expect(html).toContain("never cancelled silently");
  });

  it("shows waiting copy and hides wait button when waiting_for_idle", () => {
    const html = render({
      status: status({ phase: "waiting_for_idle" }),
    });
    expect(html).toContain('data-update-phase="waiting_for_idle"');
    expect(html).toContain("Waiting for active work");
    expect(html).not.toContain('data-testid="update-restart-wait"');
  });

  it("shouldShowUpdateRestartDialog is true for staged and waiting_for_idle", () => {
    expect(shouldShowUpdateRestartDialog(status({ phase: "staged" }))).toBe(
      true,
    );
    expect(
      shouldShowUpdateRestartDialog(status({ phase: "waiting_for_idle" })),
    ).toBe(true);
    expect(shouldShowUpdateRestartDialog(status({ phase: "idle" }))).toBe(
      false,
    );
  });
});
