import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rendererRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function read(relativePath: string): string {
  return fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");
}

describe("accepted-turn revision wiring", () => {
  it("connects eligible conversation turns to the existing composer", () => {
    const stream = read("components/task-stream.tsx");
    const workspace = read("components/views/task-workspace-view.tsx");

    expect(stream).toMatch(/editableTaskId/);
    expect(stream).toMatch(/onEditConversationTurn/);
    expect(workspace).toMatch(/revisionDraft/);
    expect(workspace).toMatch(/exposedRevisionEditTaskId/);
    expect(workspace).toMatch(/revisionEligibilityTaskId/);
    expect(workspace).toMatch(/conversation\.editingMessage/);
    expect(workspace).toMatch(/turn\.cancelEdit/);
    expect(workspace).toMatch(/turn\.saveEdit/);
    expect(workspace).toMatch(/onSaveConversationTurnEdit|saveConversationTurnEdit/);
  });

  it("revalidates and submits the edit session without queueing or updating", () => {
    const workspace = read("components/views/task-workspace-view.tsx");
    const app = read("App.tsx");

    expect(workspace).toMatch(/newRevisionMutationId/);
    expect(workspace).toMatch(/revisionSubmitIntent\(editingRevision/);
    expect(workspace).toMatch(/revision\.clientMutationId/);
    expect(workspace).toMatch(/revision\.revisionOfTaskId/);
    // A revision is never queueable — it submits directly (agentBusy: false).
    expect(workspace).toMatch(/agentBusy: false/);
    expect(app).toMatch(/revisionOfTaskId/);
    expect(app).toMatch(/followUpTask\(g, atts, clientMutationId, revisionOfTaskId\)/);
    expect(app).not.toMatch(/tasks\.update[\s\S]{0,120}revision/i);
  });
});
