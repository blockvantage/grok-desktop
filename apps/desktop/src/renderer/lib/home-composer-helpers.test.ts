import { describe, it, expect } from "vitest";
import {
  projectMentionCandidatesFromList,
  pathsFromDropFiles,
  resolveHomeActiveRoot,
  resolveSmartStartIconKey,
} from "./home-composer-helpers";

describe("home-composer-helpers", () => {
  it("maps workspace list files to project mentions and drops dirs", () => {
    expect(
      projectMentionCandidatesFromList([
        { name: "a.ts", path: "/w/a.ts", isDir: false },
        { name: "sub", path: "/w/sub", isDir: true },
      ]),
    ).toEqual([
      { name: "a.ts", path: "/w/a.ts", group: "project" },
    ]);
  });

  it("extracts Electron drop paths", () => {
    expect(
      pathsFromDropFiles([
        { path: "/tmp/x.png" },
        { path: "" },
        {},
        { path: "  /y  " },
      ]),
    ).toEqual(["/tmp/x.png", "  /y  "]);
    expect(
      pathsFromDropFiles([{ name: "a.png" } as { path?: string }], () => "/tmp/a.png"),
    ).toEqual(["/tmp/a.png"]);
  });

  it("resolves active root prefer explicit then first user task root", () => {
    expect(resolveHomeActiveRoot(" /proj ", [])).toBe("/proj");
    expect(
      resolveHomeActiveRoot("", [
        { policySnapshot: { workspaceRoots: [" /from-task "] } },
      ]),
    ).toBe("/from-task");
    expect(resolveHomeActiveRoot(null, [])).toBe("");
    // Managed / generated folders must not surface as a working dir
    expect(
      resolveHomeActiveRoot("", [
        {
          policySnapshot: {
            workspaceRoots: [
              "/Library/Application Support/GrokDesk/workspaces/grok-chat-x",
              "/Users/me/real-project",
            ],
          },
        },
      ]),
    ).toBe("/Users/me/real-project");
    expect(
      resolveHomeActiveRoot(
        "/Library/Application Support/GrokDesk/workspaces/grok-chat-x",
        [],
      ),
    ).toBe("");
  });

  it("resolves smart-start icon keys with sparkles default", () => {
    expect(resolveSmartStartIconKey("pen")).toBe("pen");
    expect(resolveSmartStartIconKey("unknown")).toBe("sparkles");
    expect(resolveSmartStartIconKey(undefined)).toBe("sparkles");
  });
});
