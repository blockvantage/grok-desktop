if (typeof document !== "undefined") {
  await import("@testing-library/jest-dom/vitest");
  const { afterEach } = await import("vitest");
  const { cleanup } = await import("@testing-library/react");
  afterEach(() => cleanup());
  if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = function scrollIntoView() {
      /* jsdom stub */
    };
  }
}
