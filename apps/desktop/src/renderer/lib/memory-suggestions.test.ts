import { describe, expect, it } from "vitest";
import {
  approveMemorySuggestion,
  createSuggestionFromTakeaways,
  dismissMemorySuggestion,
  editMemorySuggestion,
  emptyMemorySuggestionStore,
  isUsableTakeawaysContent,
  looksSensitive,
  memorySuggestionMemoryStorage,
  pendingMemorySuggestions,
  saveMemorySuggestionStore,
  loadMemorySuggestionStore,
  suggestionToMemoryUpsert,
} from "./memory-suggestions";

const usableContent = [
  "From task t1",
  "Goal: ship the launch brief",
  "",
  "Summary / last answer:",
  "We agreed the audience is SMBs and the channel mix is email + LinkedIn.",
  "Next step: draft creative by Friday.",
].join("\n");

describe("memory-suggestions", () => {
  it("rejects thin takeaways as unusable", () => {
    expect(isUsableTakeawaysContent("short")).toBe(false);
    expect(
      isUsableTakeawaysContent(
        "From task x\nGoal: y\n\nNo assistant answer captured yet.\nGoal: y",
      ),
    ).toBe(false);
    expect(isUsableTakeawaysContent(usableContent)).toBe(true);
  });

  it("creates a pending suggestion from usable takeaways without committing", () => {
    const empty = emptyMemorySuggestionStore();
    const { store, suggestion } = createSuggestionFromTakeaways(empty, {
      taskId: "task-1",
      goal: "ship the launch brief",
      title: "Launch brief",
      content: usableContent,
      now: "2026-07-31T12:00:00.000Z",
    });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.status).toBe("pending");
    expect(suggestion!.taskId).toBe("task-1");
    expect(pendingMemorySuggestions(store)).toHaveLength(1);
    // Not auto-approved
    expect(store.suggestions.every((s) => s.status !== "approved")).toBe(true);
  });

  it("does not create a suggestion for empty/unusable content", () => {
    const { suggestion } = createSuggestionFromTakeaways(
      emptyMemorySuggestionStore(),
      {
        taskId: "t",
        goal: "x",
        content: "too short",
      },
    );
    expect(suggestion).toBeNull();
  });

  it("dedupes pending by taskId and skips after dismiss", () => {
    let store = emptyMemorySuggestionStore();
    const first = createSuggestionFromTakeaways(store, {
      taskId: "task-1",
      goal: "g",
      content: usableContent,
    });
    store = first.store;
    const second = createSuggestionFromTakeaways(store, {
      taskId: "task-1",
      goal: "g2",
      content: usableContent + "\nExtra line for update path.",
    });
    expect(second.store.suggestions.filter((s) => s.status === "pending")).toHaveLength(
      1,
    );
    expect(second.suggestion?.content).toContain("Extra line");

    store = dismissMemorySuggestion(second.store, second.suggestion!.id);
    const afterDismiss = createSuggestionFromTakeaways(store, {
      taskId: "task-1",
      goal: "g3",
      content: usableContent,
    });
    expect(afterDismiss.suggestion).toBeNull();
  });

  it("supports edit then approve (with patch) and maps to memory upsert", () => {
    const { store, suggestion } = createSuggestionFromTakeaways(
      emptyMemorySuggestionStore(),
      {
        taskId: "task-2",
        goal: "goal",
        content: usableContent,
      },
    );
    const id = suggestion!.id;
    const approved = approveMemorySuggestion(store, id, {
      title: "Edited title",
      content: usableContent + "\nEdited preference: short emails.",
    });
    expect(approved.approved).not.toBeNull();
    expect(approved.approved!.status).toBe("approved");
    expect(approved.approved!.title).toBe("Edited title");
    expect(approved.approved!.content).toContain("Edited preference");
    expect(pendingMemorySuggestions(approved.store)).toHaveLength(0);

    const upsert = suggestionToMemoryUpsert(approved.approved!);
    expect(upsert).toEqual({
      kind: "episodic",
      title: "Edited title",
      content: approved.approved!.content,
    });
  });

  it("edit alone keeps pending status", () => {
    const { store, suggestion } = createSuggestionFromTakeaways(
      emptyMemorySuggestionStore(),
      {
        taskId: "task-3",
        goal: "goal",
        content: usableContent,
      },
    );
    const next = editMemorySuggestion(store, suggestion!.id, {
      title: "Only edit",
    });
    expect(next.suggestions[0]!.status).toBe("pending");
    expect(next.suggestions[0]!.title).toBe("Only edit");
  });

  it("dismiss removes from pending queue", () => {
    const { store, suggestion } = createSuggestionFromTakeaways(
      emptyMemorySuggestionStore(),
      {
        taskId: "task-4",
        goal: "goal",
        content: usableContent,
      },
    );
    const next = dismissMemorySuggestion(store, suggestion!.id);
    expect(pendingMemorySuggestions(next)).toHaveLength(0);
    expect(next.suggestions[0]!.status).toBe("dismissed");
  });

  it("flags sensitive content for review", () => {
    expect(looksSensitive("my api_key is abc")).toBe(true);
    expect(looksSensitive("prefer short emails")).toBe(false);
    const { suggestion } = createSuggestionFromTakeaways(
      emptyMemorySuggestionStore(),
      {
        taskId: "task-5",
        goal: "g",
        content: usableContent + "\nDo not store the password hunter2.",
      },
    );
    expect(suggestion?.sensitiveHint).toBe(true);
  });

  it("persists store via storage adapter", () => {
    const mem = memorySuggestionMemoryStorage();
    const { store } = createSuggestionFromTakeaways(
      emptyMemorySuggestionStore(),
      {
        taskId: "task-6",
        goal: "g",
        content: usableContent,
      },
    );
    saveMemorySuggestionStore(store, mem);
    const loaded = loadMemorySuggestionStore(mem);
    expect(loaded.suggestions).toHaveLength(1);
    expect(loaded.suggestions[0]!.taskId).toBe("task-6");
  });
});
