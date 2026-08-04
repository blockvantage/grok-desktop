import { describe, it, expect } from "vitest";
import {
  collapseEventsToBlocks,
  extractResultSummary,
  prepareChatStream,
  unwrapMessagePayload,
} from "./stream-view.js";

describe("unwrapMessagePayload", () => {
  it("unwraps legacy JSON-in-text thought tokens", () => {
    const r = unwrapMessagePayload({
      role: "assistant",
      text: JSON.stringify({ type: "thought", data: "Hello" }),
    });
    expect(r.channel).toBe("thought");
    expect(r.text).toBe("Hello");
    expect(r.drop).toBe(false);
  });

  it("drops end envelopes that leaked as message text", () => {
    const r = unwrapMessagePayload({
      role: "assistant",
      text: JSON.stringify({
        type: "end",
        stopReason: "EndTurn",
        sessionId: "abc",
        requestId: "xyz",
      }),
    });
    expect(r.drop).toBe(true);
    expect(r.text).toBe("");
  });

  it("keeps clean channel payloads", () => {
    const r = unwrapMessagePayload({
      role: "assistant",
      channel: "text",
      text: "hi",
    });
    expect(r.channel).toBe("text");
    expect(r.text).toBe("hi");
    expect(r.drop).toBe(false);
  });
});

describe("collapseEventsToBlocks", () => {
  it("merges word-by-word thought tokens into one block", () => {
    const events = ["The", " user", " wants"].map((data, i) => ({
      id: `e${i}`,
      seq: i + 1,
      kind: "message",
      payload: {
        role: "assistant",
        text: JSON.stringify({ type: "thought", data }),
      },
    }));
    const blocks = collapseEventsToBlocks(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "thought",
      text: "The user wants",
    });
  });

  it("never shows raw end JSON as Grok prose", () => {
    const events = [
      {
        id: "1",
        seq: 1,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "thought",
          text: "planning the brief",
        },
      },
      {
        id: "2",
        seq: 2,
        kind: "message",
        payload: {
          role: "assistant",
          text: JSON.stringify({
            type: "end",
            stopReason: "EndTurn",
            sessionId: "s",
            requestId: "r",
          }),
        },
      },
      {
        id: "3",
        seq: 3,
        kind: "step",
        payload: { title: "Grok Build session", status: "start" },
      },
      {
        id: "4",
        seq: 4,
        kind: "step",
        payload: { title: "Grok Build session", status: "end" },
      },
      {
        id: "5",
        seq: 5,
        kind: "status_change",
        payload: { status: "done" },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    const jsony = blocks.filter(
      (b) =>
        (b.kind === "assistant" || b.kind === "thought") &&
        "text" in b &&
        b.text.includes("{"),
    );
    expect(jsony).toHaveLength(0);
    expect(blocks.some((b) => b.kind === "thought")).toBe(true);
    // Session bookends dropped when we have real content
    expect(blocks.every((b) => b.kind !== "step" || b.title !== "Session")).toBe(
      true,
    );
  });

  it("keeps thought and text as separate blocks", () => {
    const events = [
      {
        id: "1",
        seq: 1,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "thought",
          text: "planning…",
        },
      },
      {
        id: "2",
        seq: 2,
        kind: "message",
        payload: { role: "assistant", channel: "text", text: "Done." },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    expect(blocks.map((b) => b.kind)).toEqual(["thought", "assistant"]);
  });

  it("hides queued/running status noise", () => {
    const events = [
      {
        id: "1",
        seq: 1,
        kind: "status_change",
        payload: { status: "queued" },
      },
      {
        id: "2",
        seq: 2,
        kind: "status_change",
        payload: { status: "running" },
      },
      {
        id: "3",
        seq: 3,
        kind: "status_change",
        payload: { status: "failed" },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: "status", status: "failed" });
  });
});

describe("prepareChatStream", () => {
  it("folds intermediate assistant status into a progress trail", () => {
    const events = [
      {
        id: "u1",
        seq: 1,
        kind: "message",
        payload: { role: "user", channel: "text", text: "Analyze site" },
      },
      {
        id: "a1",
        seq: 2,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "I'll analyze the product and find prospects.",
        },
      },
      {
        id: "a2",
        seq: 3,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "Payverge is a restaurant OS — next I'll map ICP.",
        },
      },
      {
        id: "a3",
        seq: 4,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "## What I did\n\nBuilt a full prospect brief with a table.\n\n| Priority | Handle |\n| --- | --- |\n| Start | @x |",
        },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    const chat = prepareChatStream(blocks, false);
    expect(chat.map((b) => b.kind)).toEqual([
      "user",
      "progress",
      "assistant",
    ]);
    const progress = chat.find((b) => b.kind === "progress");
    expect(progress?.kind).toBe("progress");
    if (progress?.kind === "progress") {
      expect(progress.lines).toHaveLength(2);
      expect(progress.live).toBe(false);
      expect(progress.lines[1]!.text).toMatch(/restaurant OS/);
    }
    const answer = chat.find((b) => b.kind === "assistant");
    expect(answer && "text" in answer && answer.text).toMatch(/What I did/);
  });

  it("keeps live status-only turns as a live progress line", () => {
    const events = [
      {
        id: "u1",
        seq: 1,
        kind: "message",
        payload: { role: "user", channel: "text", text: "Go" },
      },
      {
        id: "a1",
        seq: 2,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "Looking at the site…",
        },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    const chat = prepareChatStream(blocks, true);
    expect(chat.map((b) => b.kind)).toEqual(["user", "progress"]);
    const progress = chat.find((b) => b.kind === "progress");
    if (progress?.kind === "progress") {
      expect(progress.live).toBe(true);
      expect(progress.lines[0]!.text).toMatch(/Looking/);
    }
  });

  it("shows substantial mid-run status as assistant, not buried progress", () => {
    const events = [
      {
        id: "u1",
        seq: 1,
        kind: "message",
        payload: { role: "user", channel: "text", text: "Open Orange" },
      },
      {
        id: "a1",
        seq: 2,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "Orange is installed. Next I'll read the TP requirements and run the LogReg workflow headless (and open it in Orange if possible).",
        },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    const chat = prepareChatStream(blocks, true);
    // Long status must stay a visible assistant bubble so the UI isn't empty mid-tool.
    expect(chat.some((b) => b.kind === "assistant")).toBe(true);
    const answer = chat.find((b) => b.kind === "assistant");
    expect(answer && "text" in answer && answer.text).toMatch(/Orange is installed/);
  });

  it("folds thought tokens into the progress trail", () => {
    const events = [
      {
        id: "t1",
        seq: 1,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "thought",
          text: "planning the brief",
        },
      },
      {
        id: "a1",
        seq: 2,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "## Done\n\nHere is the full write-up with details and a list.\n\n- one\n- two\n- three\n\nMore prose after the list to make this a final answer block.",
        },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    const chat = prepareChatStream(blocks, false);
    expect(chat.some((b) => b.kind === "progress")).toBe(true);
    expect(chat.some((b) => b.kind === "assistant")).toBe(true);
    expect(chat.some((b) => b.kind === "thought")).toBe(false);
  });

  it("keeps a short final as assistant when task is done", () => {
    const events = [
      {
        id: "u1",
        seq: 1,
        kind: "message",
        payload: { role: "user", channel: "text", text: "Ship it" },
      },
      {
        id: "a1",
        seq: 2,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "Done.",
        },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    const chat = prepareChatStream(blocks, {
      active: false,
      taskStatus: "done",
    });
    expect(chat.map((b) => b.kind)).toEqual(["user", "assistant"]);
    const answer = chat.find((b) => b.kind === "assistant");
    expect(answer && "text" in answer && answer.text).toBe("Done.");
  });

  it("folds three status lines + long final into progress + assistant", () => {
    const events = [
      {
        id: "u1",
        seq: 1,
        kind: "message",
        payload: { role: "user", channel: "text", text: "Research" },
      },
      {
        id: "a1",
        seq: 2,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "I'll start by scanning the marketing site carefully.",
        },
      },
      {
        id: "a2",
        seq: 3,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "Next I'll map the ICP segments for this product.",
        },
      },
      {
        id: "a3",
        seq: 4,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "Working on drafting the full brief next.",
        },
      },
      {
        id: "a4",
        seq: 5,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "## Final brief\n\nHere is the complete write-up with recommendations.\n\n| Priority | Action |\n| --- | --- |\n| High | Outreach |\n\nMore detail follows for the reader.",
        },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    const chat = prepareChatStream(blocks, {
      active: false,
      taskStatus: "done",
    });
    expect(chat.map((b) => b.kind)).toEqual(["user", "progress", "assistant"]);
    const progress = chat.find((b) => b.kind === "progress");
    if (progress?.kind === "progress") {
      expect(progress.lines.length).toBeGreaterThanOrEqual(3);
    }
    const answer = chat.find((b) => b.kind === "assistant");
    expect(answer && "text" in answer && answer.text).toMatch(/Final brief/);
  });

  it("keeps multi-turn progress trails independent per user segment", () => {
    const events = [
      {
        id: "u1",
        seq: 1,
        kind: "message",
        payload: { role: "user", channel: "text", text: "First" },
      },
      {
        id: "a1",
        seq: 2,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "I'll look into the first request.",
        },
      },
      {
        id: "a2",
        seq: 3,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "## Answer one\n\nDetailed response for the first turn with enough structure.\n\n| Col | Val |\n| --- | --- |\n| A | 1 |",
        },
      },
      {
        id: "u2",
        seq: 4,
        kind: "message",
        payload: { role: "user", channel: "text", text: "Follow up" },
      },
      {
        id: "a3",
        seq: 5,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "I'll handle the follow-up next.",
        },
      },
      {
        id: "a4",
        seq: 6,
        kind: "message",
        payload: {
          role: "assistant",
          channel: "text",
          text: "## Answer two\n\nSecond turn final with table and length.\n\n| Col | Val |\n| --- | --- |\n| B | 2 |",
        },
      },
    ];
    const blocks = collapseEventsToBlocks(events);
    const chat = prepareChatStream(blocks, {
      active: false,
      taskStatus: "done",
    });
    expect(chat.map((b) => b.kind)).toEqual([
      "user",
      "progress",
      "assistant",
      "user",
      "progress",
      "assistant",
    ]);
    const progresses = chat.filter((b) => b.kind === "progress");
    expect(progresses).toHaveLength(2);
    if (progresses[0]?.kind === "progress" && progresses[1]?.kind === "progress") {
      expect(progresses[0].lines[0]!.text).toMatch(/first request/);
      expect(progresses[1].lines[0]!.text).toMatch(/follow-up/);
    }
  });
});

describe("extractResultSummary", () => {
  it("prefers deliverable file names over event noise", () => {
    const s = extractResultSummary(
      [
        {
          id: "1",
          seq: 1,
          kind: "message",
          payload: {
            role: "assistant",
            text: "Grok Build completed",
            channel: "text",
          },
        },
      ],
      {
        status: "done",
        deliverableNames: [
          "marketing-campaign-brief.md",
          "campaign-next-steps-checklist.md",
        ],
      },
    );
    expect(s).toContain("marketing-campaign-brief.md");
    expect(s).not.toMatch(/Grok Build completed/i);
    expect(s).not.toMatch(/events/i);
  });

  it("falls back to a useful done message without files", () => {
    const s = extractResultSummary([], { status: "done" });
    expect(s.toLowerCase()).toMatch(/finish|deliverable|work log/);
  });

  it("separates the overflow count from the listed file names", () => {
    const summary = (n: number) =>
      extractResultSummary([], {
        status: "done",
        deliverableNames: Array.from(
          { length: n },
          (_, i) => `file-${i + 1}.md`,
        ),
      });
    // No overflow: head only, and no dangling separator.
    expect(summary(2)).toBe("Created file-1.md, file-2.md");
    // Exactly one extra: singular form, separated.
    expect(summary(3)).toBe("Created file-1.md, file-2.md · 1 more file");
    // Several extra: plural form, separated.
    expect(summary(5)).toBe("Created file-1.md, file-2.md · 3 more files");
  });
});
