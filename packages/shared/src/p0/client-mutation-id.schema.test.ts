import { describe, it, expect } from "vitest";
import { parseIpcRequest } from "../ipc.js";

describe("REMOTE-02 clientMutationId schema", () => {
  it("accepts clientMutationId on tasks.create", () => {
    const req = parseIpcRequest({
      id: "1",
      method: "tasks.create",
      params: {
        goal: "hello",
        clientMutationId: "mut-1",
      },
    });
    expect(req.method).toBe("tasks.create");
    if (req.method === "tasks.create") {
      expect(req.params.clientMutationId).toBe("mut-1");
    }
  });

  it("accepts clientMutationId on remote.rekey with optional deviceId", () => {
    const req = parseIpcRequest({
      id: "2",
      method: "remote.rekey",
      params: {
        devicePub: "a".repeat(32),
        clientMutationId: "rekey-1",
      },
    });
    expect(req.method).toBe("remote.rekey");
  });

  it("strips unknown fields but keeps clientMutationId", () => {
    const req = parseIpcRequest({
      id: "3",
      method: "tasks.delete",
      params: {
        taskId: "t1",
        clientMutationId: "del-1",
        unknownExtra: true,
      },
    });
    if (req.method === "tasks.delete") {
      expect(req.params.clientMutationId).toBe("del-1");
      expect(
        (req.params as { unknownExtra?: boolean }).unknownExtra,
      ).toBeUndefined();
    }
  });
});
