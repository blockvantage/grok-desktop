/**
 * jsdom: What's new dismiss (Phase 3.6).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WhatsNewDialog } from "./whats-new-dialog";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("WhatsNewDialog", () => {
  it("renders desk and runtime notes and dismisses", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(
      <WhatsNewDialog
        open
        onOpenChange={vi.fn()}
        onDismiss={onDismiss}
        entries={[
          {
            version: "1.0.0",
            source: "desk",
            titleKey: "whatsNew.desk.v1.title",
            itemKeys: ["whatsNew.desk.v1.a"],
          },
          {
            version: "1.0.10",
            source: "runtime",
            titleKey: "whatsNew.runtime.v1010.title",
            itemKeys: ["whatsNew.runtime.v1010.a"],
          },
        ]}
      />,
    );
    expect(screen.getByTestId("whats-new")).toBeTruthy();
    expect(screen.getByText("whatsNew.desk.v1.a")).toBeTruthy();
    expect(screen.getByText("whatsNew.runtimeBadge")).toBeTruthy();
    await user.click(screen.getByTestId("whats-new-dismiss"));
    expect(onDismiss).toHaveBeenCalled();
  });
});
