/**
 * Task 14: filename-first strip, calm completed review, renamed actions.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
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

const stripSrc = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "review-changes-strip.tsx"),
  "utf8",
);

describe("ReviewChangesStrip (Task 14)", () => {
  it("shows filename first, not full path as primary label", () => {
    const html = renderToStaticMarkup(
      <ReviewChangesStrip
        view={{
          titleKey: "reviewChanges.title",
          files: [{ path: "/Users/me/project/src/a.ts", action: "write" }],
        }}
        onKeepFile={vi.fn()}
        onUndoFile={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );
    expect(html).toContain("data-review-filename");
    expect(html).toContain(">a.ts<");
    // Full path not the primary mono span content before expand
    expect(html).not.toMatch(/data-review-filename[^>]*>\/Users\/me\/project/);
    expect(html).toContain('data-review-calm="true"');
    expect(html).not.toMatch(/approval-arrive(?![^"]*needs)/);
  });

  it("renames actions to Accept change, Revert file, Reveal in folder", () => {
    const html = renderToStaticMarkup(
      <ReviewChangesStrip
        view={{
          titleKey: "reviewChanges.title",
          files: [{ path: "/ws/a.ts", action: "edit" }],
        }}
        onKeepFile={vi.fn()}
        onUndoFile={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );
    expect(html).toContain("Accept change");
    expect(html).toContain("Revert file");
    expect(html).toContain("Reveal in folder");
    expect(html).toContain('data-testid="review-changes-keep"');
    expect(html).toContain('data-testid="review-changes-undo"');
    expect(html).toContain('data-testid="review-changes-open"');
  });

  it("marks vanished files unavailable and disables open/revert", () => {
    const html = renderToStaticMarkup(
      <ReviewChangesStrip
        view={{
          titleKey: "reviewChanges.title",
          files: [{ path: "/ws/gone.ts", action: "write" }],
        }}
        unavailablePaths={["/ws/gone.ts"]}
        onKeepFile={vi.fn()}
        onUndoFile={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );
    expect(html).toContain('data-review-available="false"');
    expect(html).toContain("Unavailable");
    expect(html).toMatch(/data-testid="review-changes-undo"[^>]*disabled/);
    expect(html).toMatch(/data-testid="review-changes-open"[^>]*disabled/);
    // Accept still allowed so user can dismiss the row
    expect(html).toContain('data-testid="review-changes-keep"');
  });

  it("only applies the one-shot approval entrance when needsUserAttention", () => {
    const calm = renderToStaticMarkup(
      <ReviewChangesStrip
        view={{
          titleKey: "reviewChanges.title",
          files: [{ path: "/ws/a.ts", action: "write" }],
        }}
      />,
    );
    expect(calm).toContain('data-review-calm="true"');
    expect(calm).not.toContain("approval-arrive");

    const loud = renderToStaticMarkup(
      <ReviewChangesStrip
        view={{
          titleKey: "reviewChanges.title",
          files: [{ path: "/ws/a.ts", action: "write" }],
        }}
        needsUserAttention
      />,
    );
    expect(loud).toContain("approval-arrive");
    expect(loud).toContain("motion-reduce:animate-none");
  });

  it("product path uses path toggle and calm defaults", () => {
    expect(stripSrc).toMatch(/reviewFileBasename/);
    expect(stripSrc).toMatch(/reviewChanges\.accept/);
    expect(stripSrc).toMatch(/reviewChanges\.revert/);
    expect(stripSrc).toMatch(/reviewChanges\.reveal/);
    expect(stripSrc).toMatch(/needsUserAttention/);
    expect(stripSrc).toMatch(/motion-reduce:animate-none/);
  });
});
