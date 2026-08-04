import { describe, expect, it } from "vitest";
import { isKeepAwakeTagged, setDeskKeepAwake } from "./keep-awake";

describe("keep-awake (P4)", () => {
  it("activates and deactivates without throwing in Node", async () => {
    const on = await setDeskKeepAwake(true);
    expect(on.active).toBe(true);
    expect(isKeepAwakeTagged()).toBe(true);
    const off = await setDeskKeepAwake(false);
    expect(off.active).toBe(false);
    expect(isKeepAwakeTagged()).toBe(false);
  });
});
