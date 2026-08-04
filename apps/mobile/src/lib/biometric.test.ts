import { describe, expect, it } from "vitest";
import { ensureBiometricUnlock, getBiometricStatus } from "./biometric";

describe("biometric gate (P4)", () => {
  it("reports unavailable in Node without expo-local-authentication hardware", async () => {
    const s = await getBiometricStatus();
    expect(s.available).toBe(false);
    expect(s.label.length).toBeGreaterThan(0);
  });

  it("passes when gate disabled", async () => {
    const r = await ensureBiometricUnlock({ enabled: false });
    expect(r.ok).toBe(true);
  });

  it("fails closed when enabled without hardware unless pass-through", async () => {
    const hard = await ensureBiometricUnlock({
      enabled: true,
      allowPassThroughWithoutHardware: false,
    });
    expect(hard.ok).toBe(false);
    const soft = await ensureBiometricUnlock({
      enabled: true,
      allowPassThroughWithoutHardware: true,
    });
    expect(soft.ok).toBe(true);
  });
});
