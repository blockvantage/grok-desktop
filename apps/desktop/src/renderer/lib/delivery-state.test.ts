import { describe, it, expect } from "vitest";
import {
  deriveDeliveryPhase,
  deliveryPhaseLabel,
  mayShowWorking,
} from "./delivery-state";

describe("delivery-state", () => {
  it("does not show Working before acceptance", () => {
    expect(
      deriveDeliveryPhase({ saving: true, taskStatus: "running" }),
    ).toBe("saving");
    expect(
      mayShowWorking(deriveDeliveryPhase({ taskStatus: "running" })),
    ).toBe(false);
    expect(
      mayShowWorking(
        deriveDeliveryPhase({ accepted: true, taskStatus: "running" }),
      ),
    ).toBe(true);
  });

  it("shows saved locally for outbox items", () => {
    expect(
      deriveDeliveryPhase({ outboxPending: true, savedLocal: true }),
    ).toBe("saved_local");
    expect(deliveryPhaseLabel("saved_local")).toMatch(/Saved locally/i);
  });

  it("shows connecting without claiming queued durability", () => {
    expect(
      deriveDeliveryPhase({ connecting: true, hasDraft: true }),
    ).toBe("connecting");
    expect(deliveryPhaseLabel("connecting")).toMatch(/waiting for the engine/i);
  });

  it("marks ambiguous timeout as delivery_unknown", () => {
    expect(
      deriveDeliveryPhase({ acceptanceTimedOut: true, saving: false }),
    ).toBe("delivery_unknown");
  });

  it("maps terminal and needs_attention", () => {
    expect(deriveDeliveryPhase({ terminal: true })).toBe("terminal");
    expect(
      deriveDeliveryPhase({ taskStatus: "waiting_approval", accepted: true }),
    ).toBe("needs_attention");
  });
});
