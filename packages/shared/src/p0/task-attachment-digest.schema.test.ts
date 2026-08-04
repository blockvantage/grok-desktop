import { describe, expect, it } from "vitest";
import { TaskAttachmentSchema } from "../ipc.js";

describe("accepted attachment digest schema", () => {
  it("preserves the gateway-computed content digest", () => {
    const digest = "a".repeat(64);
    expect(
      TaskAttachmentSchema.parse({
        id: "attachment",
        name: "photo.png",
        sourcePath: "/tmp/photo.png",
        kind: "image",
        contentSha256: digest,
      }).contentSha256,
    ).toBe(digest);
  });
});
