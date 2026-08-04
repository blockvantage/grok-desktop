import { describe, it, expect } from "vitest";
import {
  desktopConfigureInput,
  hostSessionIdsFromThreadRoot,
} from "./run-task-host-config.js";

describe("hostSessionIdsFromThreadRoot", () => {
  it("uses root for both browser and desktop", () => {
    expect(hostSessionIdsFromThreadRoot("chat-root")).toEqual({
      browserSessionId: "chat-root",
      desktopSessionId: "chat-root",
    });
  });
});

describe("desktopConfigureInput", () => {
  it("maps grant + machine onto session id", () => {
    expect(
      desktopConfigureInput({
        desktopSessionId: "root",
        granted: true,
        displayId: "main",
        machine: { enabled: true },
      }),
    ).toEqual({
      taskId: "root",
      granted: true,
      displayId: "main",
      machine: { enabled: true },
    });
  });
});
