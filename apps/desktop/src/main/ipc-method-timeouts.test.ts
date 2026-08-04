import { describe, expect, it } from "vitest";
import {
  DEFAULT_GATEWAY_TIMEOUT_MS,
  gatewayMethodTimeoutMs,
  LONG_GATEWAY_TIMEOUT_MS,
} from "./ipc-method-timeouts";

describe("gatewayMethodTimeoutMs", () => {
  it("uses short deadlines for durable acceptance and reads", () => {
    expect(gatewayMethodTimeoutMs("outbox.enqueue")).toBe(12_000);
    expect(gatewayMethodTimeoutMs("outbox.list")).toBe(12_000);
    expect(gatewayMethodTimeoutMs("events.page")).toBe(12_000);
    expect(gatewayMethodTimeoutMs("tasks.list")).toBe(12_000);
    expect(gatewayMethodTimeoutMs("tasks.create")).toBe(15_000);
  });

  it("keeps long deadlines for asset/runtime operations", () => {
    expect(gatewayMethodTimeoutMs("workspace.readAsset")).toBe(
      LONG_GATEWAY_TIMEOUT_MS,
    );
    expect(gatewayMethodTimeoutMs("workspace.prepareAsset")).toBe(
      LONG_GATEWAY_TIMEOUT_MS,
    );
    expect(gatewayMethodTimeoutMs("chats.exportMarkdown")).toBe(
      LONG_GATEWAY_TIMEOUT_MS,
    );
  });

  it("defaults unknown methods to a bounded medium timeout", () => {
    expect(gatewayMethodTimeoutMs("totally.unknown")).toBe(
      DEFAULT_GATEWAY_TIMEOUT_MS,
    );
  });
});
