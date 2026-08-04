import { describe, it, expect } from "vitest";
import { artifactCreateFromEvent } from "./artifact-event-persist.js";

describe("artifactCreateFromEvent", () => {
  it("returns null for non-artifact events", () => {
    expect(
      artifactCreateFromEvent({
        kind: "message",
        taskId: "t1",
        payload: { title: "x" },
      }),
    ).toBeNull();
  });

  it("maps fields with defaults", () => {
    expect(
      artifactCreateFromEvent({
        kind: "artifact_created",
        taskId: "t1",
        payload: {},
      }),
    ).toEqual({
      taskId: "t1",
      title: "Artifact",
      kind: "file",
      path: null,
    });
  });

  it("preserves valid kind and path", () => {
    expect(
      artifactCreateFromEvent({
        kind: "artifact_created",
        taskId: "t2",
        payload: {
          title: "Shot",
          kind: "media",
          path: "/ws/a.png",
        },
      }),
    ).toEqual({
      taskId: "t2",
      title: "Shot",
      kind: "media",
      path: "/ws/a.png",
    });
  });

  it("falls back kind for unknown strings", () => {
    expect(
      artifactCreateFromEvent({
        kind: "artifact_created",
        taskId: "t3",
        payload: { kind: "weird", title: "x" },
      })?.kind,
    ).toBe("file");
  });

  it("bounds title and rejects oversized paths", () => {
    const longTitle = "T".repeat(800);
    const out = artifactCreateFromEvent({
      kind: "artifact_created",
      taskId: "t4",
      payload: {
        title: longTitle,
        path: "p".repeat(5_000),
      },
    });
    expect(out?.title.length).toBe(512);
    expect(out?.path).toBeNull();
  });
});
