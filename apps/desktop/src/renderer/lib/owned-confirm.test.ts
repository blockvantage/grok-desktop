import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("owned confirm (0.6)", () => {
  it("renderer no longer calls window.confirm", () => {
    const roots = [
      path.join(process.cwd(), "src/renderer/App.tsx"),
      path.join(
        process.cwd(),
        "src/renderer/components/views/task-workspace-view.tsx",
      ),
    ];
    for (const file of roots) {
      const src = fs.readFileSync(file, "utf8");
      expect(src).not.toMatch(/window\.confirm\s*\(/);
      expect(src).toMatch(/ownedConfirm|useOwnedConfirm/);
    }
  });
});
