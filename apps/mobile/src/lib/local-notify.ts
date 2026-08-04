/**
 * Local (on-device) notifications for approvals / completions.
 * Remote FCM/APNs push still requires a dev build (PM-13) — this path works
 * when the app is backgrounded but still process-alive, and for foreground
 * presentation settings.
 */
import { Platform } from "react-native";

export type LocalNotifyPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

let configured = false;

async function ensureConfigured(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    const Notifications = await import("expo-notifications");
    if (!configured) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      configured = true;
    }
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    return status === "granted";
  } catch {
    return false;
  }
}

/** Fire a local notification (best-effort; no-op if denied / Expo limits). */
export async function notifyLocal(payload: LocalNotifyPayload): Promise<void> {
  try {
    const ok = await ensureConfigured();
    if (!ok) return;
    const Notifications = await import("expo-notifications");
    await Notifications.scheduleNotificationAsync({
      content: {
        title: payload.title,
        body: payload.body,
        data: payload.data ?? {},
        sound: true,
      },
      trigger: null,
    });
  } catch {
    /* Expo Go / simulator may lack full support */
  }
}
