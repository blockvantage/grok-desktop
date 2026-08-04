import { useCallback, useEffect, useMemo, useState } from "react";
import type { InboxItem } from "@grokdesk/shared";
import { rpc, subscribeGatewayNotify } from "@/lib/api";

export type UseInboxResult = {
  items: InboxItem[];
  refresh: () => Promise<void>;
  unread: number;
  markRead: (id: string) => Promise<void>;
  dismiss: (id: string) => Promise<void>;
};

/**
 * Inbox list via gateway push + slow safety-net poll.
 * Failures are swallowed so a dead gateway does not crash the shell.
 */
export function useInbox(pollMs = 30_000): UseInboxResult {
  const [items, setItems] = useState<InboxItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await rpc<InboxItem[]>("inbox.list", {});
      setItems(Array.isArray(list) ? list : []);
    } catch {
      // Gateway may be restarting; keep last known items.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unsub = subscribeGatewayNotify((msg) => {
      if (msg.method === "notify.inboxChanged") void refresh();
    });
    let timer: ReturnType<typeof setInterval> | undefined;

    const schedule = () => {
      if (timer) clearInterval(timer);
      const hidden =
        typeof document !== "undefined" &&
        document.visibilityState === "hidden";
      const ms = hidden ? Math.max(pollMs, 60_000) : pollMs;
      timer = setInterval(() => void refresh(), ms);
    };

    schedule();
    const onVis = () => {
      schedule();
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      unsub();
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh, pollMs]);

  const markRead = useCallback(async (id: string) => {
    try {
      await rpc("inbox.markRead", { id });
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, read: true } : i)),
      );
    } catch {
      // leave local state; next poll will reconcile
    }
  }, []);

  const dismiss = useCallback(async (id: string) => {
    try {
      await rpc("inbox.dismiss", { id });
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch {
      // leave local state; next poll will reconcile
    }
  }, []);

  const unread = useMemo(
    () => items.filter((i) => !i.read).length,
    [items],
  );

  return { items, refresh, unread, markRead, dismiss };
}
