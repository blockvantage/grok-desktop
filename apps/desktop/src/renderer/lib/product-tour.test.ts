import { describe, expect, it } from "vitest";
import {
  PRODUCT_TOUR_SCENES,
  loadProductTourCompleted,
  nextProductTourScene,
  saveProductTourCompleted,
  shouldShowProductTour,
} from "./product-tour";

describe("product tour", () => {
  it("is five scenes covering approvals, files, follow-ups, memory, trust", () => {
    expect([...PRODUCT_TOUR_SCENES]).toEqual([
      "approvals",
      "files",
      "followUps",
      "memory",
      "trust",
    ]);
    expect(nextProductTourScene("approvals")).toBe("files");
    expect(nextProductTourScene("trust")).toBeNull();
  });

  it("shows only after first-run onboarding, until completed", () => {
    expect(
      shouldShowProductTour({
        onboardingCompleted: false,
        tourCompleted: false,
      }),
    ).toBe(false);
    expect(
      shouldShowProductTour({
        onboardingCompleted: true,
        tourCompleted: false,
      }),
    ).toBe(true);
    expect(
      shouldShowProductTour({
        onboardingCompleted: true,
        tourCompleted: true,
      }),
    ).toBe(false);
  });

  it("persists completion in storage", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
    };
    expect(loadProductTourCompleted(storage)).toBe(false);
    saveProductTourCompleted(storage);
    expect(loadProductTourCompleted(storage)).toBe(true);
  });
});
