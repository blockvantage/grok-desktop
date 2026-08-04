import { Notification } from "electron";

export function notifyNeedsYou(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.show();
}
