import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("file review copy (0.5)", () => {
  it("workspace review strip does not wire a fake revert action", () => {
    const src = fs.readFileSync(
      path.join(
        process.cwd(),
        "src/renderer/components/views/task-workspace-view.tsx",
      ),
      "utf8",
    );
    expect(src).not.toMatch(/onUndoFile=/);
    expect(src).toMatch(/rewindConversationHint/);
  });
});
