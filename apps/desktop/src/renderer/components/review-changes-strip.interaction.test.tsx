/**
 * jsdom + Testing Library interaction coverage for review actions (2.7).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewChangesStrip } from "./review-changes-strip";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => {
    const map: Record<string, string> = {
      "reviewChanges.title": "Review changes",
      "reviewChanges.count": "files",
      "reviewChanges.dismiss": "Dismiss",
      "reviewChanges.accept": "Accept change",
      "reviewChanges.revert": "Revert file",
      "reviewChanges.reveal": "Reveal in folder",
      "reviewChanges.showPath": "Show path",
      "reviewChanges.hidePath": "Hide path",
      "reviewChanges.unavailable": "Unavailable",
      "reviewChanges.keep": "Keep",
      "reviewChanges.undo": "Undo file",
      "reviewChanges.open": "Open",
    };
    return map[key] ?? key;
  },
}));

describe("ReviewChangesStrip interactions", () => {
  it("reveals a file on click and does not offer revert when undo is unwired", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const onKeepFile = vi.fn();
    render(
      <ReviewChangesStrip
        view={{
          titleKey: "reviewChanges.title",
          files: [{ path: "/ws/launch-brief.md", action: "write" }],
        }}
        onKeepFile={onKeepFile}
        onOpenFile={onOpenFile}
      />,
    );
    expect(screen.queryByText("Revert file")).toBeNull();
    await user.click(screen.getByTestId("review-changes-open"));
    expect(onOpenFile).toHaveBeenCalledWith("/ws/launch-brief.md");
    await user.click(screen.getByTestId("review-changes-keep"));
    expect(onKeepFile).toHaveBeenCalledWith("/ws/launch-brief.md");
  });
});
