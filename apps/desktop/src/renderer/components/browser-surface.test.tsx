import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserGlobe } from "./browser-globe";
import {
  DeliverableRow,
  type WorkspaceDeliverable,
} from "./views/task-workspace-parts";

function deliverable(path: string): WorkspaceDeliverable {
  return {
    key: path,
    title: path.split("/").at(-1) ?? path,
    path,
    source: "artifact",
    isImage: false,
    isVideo: false,
    isAudio: false,
  };
}

describe("in-app browser surface", () => {
  it("offers a localized one-click browser action only for HTML deliverables", () => {
    const html = renderToStaticMarkup(
      <DeliverableRow
        d={deliverable("/workspace/site/index.html")}
        onOpen={vi.fn()}
        onOpenInBrowser={vi.fn()}
      />,
    );
    const markdown = renderToStaticMarkup(
      <DeliverableRow
        d={deliverable("/workspace/notes.md")}
        onOpen={vi.fn()}
        onOpenInBrowser={vi.fn()}
      />,
    );

    expect(html).toContain('data-open-in-browser="/workspace/site/index.html"');
    expect(html).toContain('aria-label="Open in agent browser"');
    expect(markdown).not.toContain("data-open-in-browser");
  });

  it("exposes a separate localized pin control and truthful pane state", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <BrowserGlobe
          active={false}
          open
          pinned
          capabilityState="degraded"
          onToggle={vi.fn()}
          onPin={vi.fn()}
        />
      </TooltipProvider>,
    );

    expect(html).toContain('data-browser-state="degraded"');
    expect(html).toContain('data-pinned="true"');
    expect(html).toContain("Agent browser · degraded");
    expect(html).toContain('aria-label="Unpin browser pane"');
    expect(html).toContain("data-browser-pin");
  });
});
