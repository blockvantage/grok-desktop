import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UpdateStatus } from "@grokdesk/shared";
import {
  SecurityUpdateBanner,
  securityBannerMode,
  shouldShowSecurityUpdateBanner,
} from "./security-update-banner";

function status(partial: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    phase: "available",
    channel: "stable",
    target: "darwin-arm64",
    installed: { deskVersion: "1.0.0", grokVersion: "0.9.0" },
    ...partial,
  };
}

function render(
  props: Partial<React.ComponentProps<typeof SecurityUpdateBanner>> = {},
) {
  return renderToStaticMarkup(
    createElement(SecurityUpdateBanner, {
      status: status({ securityMode: "security_warn" }),
      onUpdate: vi.fn(),
      onOpenSettings: vi.fn(),
      ...props,
    }),
  );
}

describe("SecurityUpdateBanner", () => {
  it("shows warn copy for security_warn", () => {
    const html = render({
      status: status({
        securityMode: "security_warn",
        securityDeadline: "2026-08-01T00:00:00.000Z",
      }),
    });
    expect(html).toContain('data-testid="security-update-banner"');
    expect(html).toContain('data-security-mode="security_warn"');
    expect(html).toContain("Security update recommended");
    expect(html).toContain('data-testid="security-update-banner-update"');
    expect(html).toContain('data-testid="security-update-banner-settings"');
  });

  it("shows block copy for security_block", () => {
    const html = render({
      status: status({ securityMode: "security_block" }),
    });
    expect(html).toContain('data-security-mode="security_block"');
    expect(html).toContain("Security update required");
    expect(html).toContain("New Grok tasks are paused");
  });

  it("renders nothing when security is normal", () => {
    const html = render({
      status: status({ securityMode: "normal", phase: "idle" }),
    });
    expect(html).toBe("");
  });

  it("treats securityForced available as block", () => {
    const s = status({
      available: {
        pairId: "p",
        deskVersion: "1.1.0",
        grokVersion: "0.9.4",
        channel: "stable",
        securityForced: true,
      },
    });
    expect(shouldShowSecurityUpdateBanner(s)).toBe(true);
    expect(securityBannerMode(s)).toBe("security_block");
  });
});
