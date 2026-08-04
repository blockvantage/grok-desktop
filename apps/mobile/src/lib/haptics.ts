/**
 * Soft haptics for premium feel. No-ops when unavailable (web / tests).
 */
import { Platform } from "react-native";

type Impact = "light" | "medium" | "success" | "warning" | "error" | "selection";

let haptics: {
  impactAsync?: (s: unknown) => Promise<void>;
  notificationAsync?: (t: unknown) => Promise<void>;
  selectionAsync?: () => Promise<void>;
  ImpactFeedbackStyle?: { Light: unknown; Medium: unknown };
  NotificationFeedbackType?: {
    Success: unknown;
    Warning: unknown;
    Error: unknown;
  };
} | null = null;

try {
  // Optional native module — Expo Go has it; node tests do not.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  haptics = require("expo-haptics");
} catch {
  haptics = null;
}

export async function haptic(kind: Impact = "light"): Promise<void> {
  if (Platform.OS === "web" || !haptics) return;
  try {
    if (kind === "selection" && haptics.selectionAsync) {
      await haptics.selectionAsync();
      return;
    }
    if (
      (kind === "success" || kind === "warning" || kind === "error") &&
      haptics.notificationAsync &&
      haptics.NotificationFeedbackType
    ) {
      const map = {
        success: haptics.NotificationFeedbackType.Success,
        warning: haptics.NotificationFeedbackType.Warning,
        error: haptics.NotificationFeedbackType.Error,
      } as const;
      await haptics.notificationAsync(map[kind]);
      return;
    }
    if (haptics.impactAsync && haptics.ImpactFeedbackStyle) {
      await haptics.impactAsync(
        kind === "medium"
          ? haptics.ImpactFeedbackStyle.Medium
          : haptics.ImpactFeedbackStyle.Light,
      );
    }
  } catch {
    /* ignore */
  }
}
