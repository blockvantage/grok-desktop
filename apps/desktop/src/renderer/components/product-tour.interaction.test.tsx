/**
 * jsdom: 5-scene product tour next/skip (Phase 3.6).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProductTour } from "./product-tour";

vi.mock("@/i18n", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => {
    if (key === "tour.stepOf") return `${vars?.current} of ${vars?.total}`;
    return key;
  },
}));

describe("ProductTour", () => {
  it("walks five scenes then completes", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ProductTour open onOpenChange={onOpenChange} onComplete={onComplete} />,
    );
    expect(screen.getByTestId("product-tour").getAttribute("data-tour-scene")).toBe(
      "approvals",
    );
    await user.click(screen.getByTestId("product-tour-next"));
    expect(screen.getByTestId("product-tour").getAttribute("data-tour-scene")).toBe(
      "files",
    );
    await user.click(screen.getByTestId("product-tour-next"));
    await user.click(screen.getByTestId("product-tour-next"));
    await user.click(screen.getByTestId("product-tour-next"));
    expect(screen.getByTestId("product-tour").getAttribute("data-tour-scene")).toBe(
      "trust",
    );
    await user.click(screen.getByTestId("product-tour-done"));
    expect(onComplete).toHaveBeenCalled();
  });

  it("skip marks the tour complete", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(
      <ProductTour open onOpenChange={vi.fn()} onComplete={onComplete} />,
    );
    await user.click(screen.getByTestId("product-tour-skip"));
    expect(onComplete).toHaveBeenCalled();
  });
});
