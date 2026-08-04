import { describe, it, expect } from "vitest";
import { harvestArtifactCreatedPayload } from "./harvest-artifact-payload.js";

describe("harvestArtifactCreatedPayload", () => {
  it("copies fields with injected id", () => {
    expect(
      harvestArtifactCreatedPayload(
        { title: "Notes", path: "/ws/n.md", kind: "file" },
        "id-1",
      ),
    ).toEqual({
      id: "id-1",
      title: "Notes",
      path: "/ws/n.md",
      kind: "file",
    });
  });

  it("payload carries sizeBytes and mime", () => {
    const p = harvestArtifactCreatedPayload(
      {
        title: "a.mp4",
        path: "/x/a.mp4",
        kind: "media",
        sizeBytes: 9,
        mime: "video/mp4",
      },
      "id1",
    );
    expect(p.sizeBytes).toBe(9);
    expect(p.mime).toBe("video/mp4");
  });
});
