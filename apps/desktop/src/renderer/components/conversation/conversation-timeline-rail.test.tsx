import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConversationTimelineRail } from "./conversation-timeline-rail";
import type { ConversationTick } from "@/lib/conversation-timeline";

const ticks: ConversationTick[] = [
  {
    id: "t1",
    index: 1,
    state: "done",
    label: "Write the brief",
    hasAnswer: true,
  },
  {
    id: "t2",
    index: 2,
    state: "running",
    label: "Expand it",
    hasAnswer: false,
  },
];

describe("ConversationTimelineRail", () => {
  it("renders a tick per turn and marks the active one", () => {
    const html = renderToStaticMarkup(
      <ConversationTimelineRail
        ticks={ticks}
        activeTurnId="t2"
        onJump={vi.fn()}
      />,
    );
    expect(html).toContain('data-testid="conversation-timeline-rail"');
    expect(html).toContain('data-timeline-tick="t1"');
    expect(html).toContain('data-timeline-tick="t2"');
    expect(html).toContain('data-timeline-active="true"');
    expect(html).toContain("Jump to turn 1");
  });
});
