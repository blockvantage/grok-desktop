/**
 * jsdom: Watch until… strip stop control (Phase 3.5).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WatchUntilPanel } from "./watch-until-panel";

describe("WatchUntilPanel", () => {
  it("shows the last monitor line and stops a running watch", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(
      <WatchUntilPanel
        view={{
          monitorId: "m1",
          description: "CI green",
          lastLine: "queued",
          status: "running",
        }}
        onStop={onStop}
      />,
    );
    expect(screen.getByTestId("watch-until-panel").getAttribute("data-watch-status")).toBe(
      "running",
    );
    expect(screen.getByText("queued")).toBeTruthy();
    await user.click(screen.getByTestId("watch-until-stop"));
    expect(onStop).toHaveBeenCalled();
  });
});
