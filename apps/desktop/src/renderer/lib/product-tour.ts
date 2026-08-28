/**
 * Opt-in 5-scene Desk tour (Phase 3.6).
 * Modeled on CLI /tutorial; not the first-launch wizard.
 */

export const PRODUCT_TOUR_SCENES = [
  "approvals",
  "files",
  "followUps",
  "memory",
  "trust",
] as const;

export type ProductTourSceneId = (typeof PRODUCT_TOUR_SCENES)[number];

export const PRODUCT_TOUR_STORAGE_KEY = "grokdesk.productTour.completed.v1";

export function shouldShowProductTour(input: {
  onboardingCompleted: boolean;
  tourCompleted: boolean;
}): boolean {
  return input.onboardingCompleted && !input.tourCompleted;
}

export function loadProductTourCompleted(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): boolean {
  try {
    return storage?.getItem(PRODUCT_TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveProductTourCompleted(
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  try {
    storage?.setItem(PRODUCT_TOUR_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function productTourSceneIndex(id: ProductTourSceneId): number {
  return PRODUCT_TOUR_SCENES.indexOf(id);
}

export function nextProductTourScene(
  id: ProductTourSceneId,
): ProductTourSceneId | null {
  const i = productTourSceneIndex(id);
  if (i < 0 || i >= PRODUCT_TOUR_SCENES.length - 1) return null;
  return PRODUCT_TOUR_SCENES[i + 1]!;
}
