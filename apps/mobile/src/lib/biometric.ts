/**
 * Optional biometric unlock gate (P4).
 * Uses expo-local-authentication when present; otherwise reports unavailable
 * so Settings can show a clear disabled state without crashing Node tests.
 */

export type BiometricStatus = {
  available: boolean;
  enrolled: boolean;
  label: string;
};

export async function getBiometricStatus(): Promise<BiometricStatus> {
  try {
    const LocalAuth = await import("expo-local-authentication").catch(
      () => null,
    );
    if (!LocalAuth?.hasHardwareAsync) {
      return {
        available: false,
        enrolled: false,
        label: "Biometrics not available on this build",
      };
    }
    const available = await LocalAuth.hasHardwareAsync();
    const enrolled = available ? await LocalAuth.isEnrolledAsync() : false;
    return {
      available,
      enrolled,
      label: !available
        ? "No biometric hardware"
        : !enrolled
          ? "No biometrics enrolled"
          : "Face ID / fingerprint ready",
    };
  } catch {
    return {
      available: false,
      enrolled: false,
      label: "Biometrics unavailable",
    };
  }
}

/**
 * Prompt unlock when enabled. Returns true if unlocked or gate disabled.
 * When biometrics unavailable but gate enabled, returns false with reason
 * unless `allowPassThroughWithoutHardware` is true (dev/tests).
 */
export async function ensureBiometricUnlock(opts: {
  enabled: boolean;
  promptMessage?: string;
  allowPassThroughWithoutHardware?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  if (!opts.enabled) return { ok: true };
  const status = await getBiometricStatus();
  if (!status.available || !status.enrolled) {
    if (opts.allowPassThroughWithoutHardware) {
      return { ok: true, reason: status.label };
    }
    return { ok: false, reason: status.label };
  }
  try {
    const LocalAuth = await import("expo-local-authentication");
    const result = await LocalAuth.authenticateAsync({
      promptMessage: opts.promptMessage ?? "Unlock Grok Desk Remote",
      cancelLabel: "Cancel",
      disableDeviceFallback: false,
    });
    if (result.success) return { ok: true };
    return { ok: false, reason: "Authentication cancelled or failed" };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
