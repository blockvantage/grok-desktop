import { describe, it, expect } from "vitest";
import { autoTitleTask } from "./title-generation.js";

describe("autoTitleTask", () => {
  it("sets title when generator returns a value and task has none", async () => {
    const store = new Map<string, { title: string | null }>();
    store.set("t1", { title: null });
    await autoTitleTask(
      {
        get: (id) => store.get(id) ?? null,
        setTitle: (id, title) => {
          store.set(id, { title });
        },
      },
      "t1",
      "Write a long essay about cats",
      "grok-4.5",
      async () => "Cat essay",
    );
    expect(store.get("t1")?.title).toBe("Cat essay");
  });

  it("does not overwrite an existing title", async () => {
    const store = new Map<string, { title: string | null }>();
    store.set("t1", { title: "Already" });
    await autoTitleTask(
      {
        get: (id) => store.get(id) ?? null,
        setTitle: (id, title) => {
          store.set(id, { title });
        },
      },
      "t1",
      "goal",
      "m",
      async () => "New",
    );
    expect(store.get("t1")?.title).toBe("Already");
  });

  it("swallows generator errors", async () => {
    await expect(
      autoTitleTask(
        {
          get: () => ({ title: null }),
          setTitle: () => {
            throw new Error("should not call");
          },
        },
        "t1",
        "g",
        "m",
        async () => {
          throw new Error("model down");
        },
      ),
    ).resolves.toBeUndefined();
  });
});
