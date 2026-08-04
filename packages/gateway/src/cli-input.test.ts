import { describe, expect, it, vi } from "vitest";
import {
  createGatewayLineHandler,
  GATEWAY_CLI_MAX_LINE_BYTES,
} from "./cli-input.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("gateway CLI input", () => {
  it("processes a host_result while its originating request is still pending", async () => {
    const hostRoundTrip = deferred<string>();
    const sent: unknown[] = [];
    const handleHostResult = vi.fn(() => hostRoundTrip.resolve("opened"));
    const handleLine = createGatewayLineHandler({
      dispatch: async () => hostRoundTrip.promise,
      handleHostResult,
      shutdown: vi.fn(async () => {}),
      send: (message) => sent.push(message),
      exit: vi.fn(),
    });

    handleLine(
      JSON.stringify({ id: "request-1", method: "browser.openHtml", params: {} }),
    );
    handleLine(
      JSON.stringify({
        type: "host_result",
        id: "host-1",
        ok: true,
        result: { ok: true },
      }),
    );

    await vi.waitFor(() => {
      expect(handleHostResult).toHaveBeenCalledWith({
        id: "host-1",
        ok: true,
        result: { ok: true },
        error: undefined,
      });
      expect(sent).toContainEqual({
        id: "request-1",
        ok: true,
        result: "opened",
      });
    });
  });

  it("preserves request ordering while host results bypass the request queue", async () => {
    const hostRoundTrip = deferred<string>();
    const sent: unknown[] = [];
    const dispatch = vi.fn(async (request: { id: string }) => {
      if (request.id === "request-1") return hostRoundTrip.promise;
      return "second";
    });
    const handleLine = createGatewayLineHandler({
      dispatch,
      handleHostResult: () => hostRoundTrip.resolve("first"),
      shutdown: vi.fn(async () => {}),
      send: (message) => sent.push(message),
      exit: vi.fn(),
    });

    handleLine(JSON.stringify({ id: "request-1", method: "first" }));
    handleLine(JSON.stringify({ id: "request-2", method: "second" }));
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);

    handleLine(
      JSON.stringify({ type: "host_result", id: "host-1", ok: true }),
    );

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledTimes(2);
      expect(sent).toEqual([
        { id: "request-1", ok: true, result: "first" },
        { id: "request-2", ok: true, result: "second" },
      ]);
    });
  });

  it("rejects oversized JSON lines without parsing", () => {
    const sent: unknown[] = [];
    const dispatch = vi.fn(async () => "ok");
    const handleLine = createGatewayLineHandler({
      dispatch,
      handleHostResult: vi.fn(),
      shutdown: vi.fn(async () => {}),
      send: (message) => sent.push(message),
      exit: vi.fn(),
    });
    handleLine("x".repeat(GATEWAY_CLI_MAX_LINE_BYTES + 1));
    expect(dispatch).not.toHaveBeenCalled();
    expect(sent).toEqual([
      {
        id: null,
        ok: false,
        error: `Line too large (max ${GATEWAY_CLI_MAX_LINE_BYTES} bytes)`,
      },
    ]);
  });
});
