import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { ErrorBoundary, ErrorFallback } from "./error-boundary";

describe("ErrorFallback", () => {
  it("renders the error message and a reload action", () => {
    const html = renderToStaticMarkup(
      <ErrorFallback error={new Error("boom-xyz")} onReload={() => {}} />,
    );
    expect(html).toContain("Something went wrong");
    expect(html).toContain("boom-xyz");
    expect(html).toContain("Reload");
    expect(html).toContain('role="alert"');
  });

  it("falls back to a generic message when the error has none", () => {
    const html = renderToStaticMarkup(
      <ErrorFallback error={null} onReload={() => {}} />,
    );
    expect(html).toContain("unexpected error");
  });
});

describe("ErrorBoundary", () => {
  it("derives error state from a thrown error", () => {
    const state = ErrorBoundary.getDerivedStateFromError(new Error("kaboom"));
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error?.message).toBe("kaboom");
  });

  it("renders children when there is no error", () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <div>healthy child</div>
      </ErrorBoundary>,
    );
    expect(html).toContain("healthy child");
  });
});
