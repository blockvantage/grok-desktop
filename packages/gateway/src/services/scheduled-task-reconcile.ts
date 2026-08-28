/**
 * Map engine ScheduledTask* events onto Desk schedule_rules (one calendar).
 */
import {
  decodeScheduledTaskEvent,
  engineScheduleDeskId,
  type ScheduledTaskView,
} from "@grokdesk/shared";
import type { ScheduleRule } from "@grokdesk/shared";

export type EngineScheduleStore = {
  upsertEngineRule: (input: {
    id: string;
    name: string;
    goalTemplate: string;
    cron: string;
    timezone?: string;
  }) => ScheduleRule;
  delete: (id: string) => void;
  get: (id: string) => ScheduleRule | null;
};

export function reconcileScheduledTaskEvent(
  store: EngineScheduleStore,
  raw: unknown,
): { action: ScheduledTaskView["action"]; id: string } | null {
  const view = decodeScheduledTaskEvent(raw);
  if (!view) return null;
  const id = engineScheduleDeskId(view.engineId);
  if (view.action === "deleted") {
    if (store.get(id)) store.delete(id);
    return { action: "deleted", id };
  }
  if (view.action === "created" || view.action === "fired") {
    const cron = view.cron ?? "0 9 * * *";
    const name = view.prompt.slice(0, 80) || "Engine schedule";
    store.upsertEngineRule({
      id,
      name,
      goalTemplate: view.prompt,
      cron,
    });
    return { action: view.action, id };
  }
  return { action: "other", id };
}
