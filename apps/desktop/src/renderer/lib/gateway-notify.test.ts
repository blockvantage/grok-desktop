import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { subscribeGatewayNotify } from "./api";

describe("subscribeGatewayNotify", () => {
  const listeners: Array<(msg: unknown) => void> = [];
  const g = globalThis as unknown as {
    window?: { grokdesk?: unknown };
  };

  beforeEach(() => {
    listeners.length = 0;
    g.window = {
      grokdesk: {
        onGatewayNotify: (cb: (msg: unknown) => void) => {
          listeners.push(cb);
          return () => {
            const i = listeners.indexOf(cb);
            if (i >= 0) listeners.splice(i, 1);
          };
        },
      },
    };
  });

  afterEach(() => {
    delete g.window;
  });

  it("forwards notify frames to the callback and unsubscribes", () => {
    const cb = vi.fn();
    const unsub = subscribeGatewayNotify(cb);
    expect(listeners).toHaveLength(1);
    listeners[0]!({ method: "notify.tasksChanged", params: {} });
    expect(cb).toHaveBeenCalledWith({
      method: "notify.tasksChanged",
      params: {},
    });
    unsub();
    expect(listeners).toHaveLength(0);
  });
});
