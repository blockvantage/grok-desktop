import { useCallback, useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { rpc } from "@/lib/api";
import { useT } from "@/i18n";
import { useToast } from "@/components/ui/toast";

function useDesktopTaskGrant(taskId: string) {
  const t = useT();
  const { toast } = useToast();
  const [granted, setGranted] = useState(false);
  const [softPaused, setSoftPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const g = (await rpc("desktop.task.getGrant", {
        taskId,
      })) as { granted?: boolean; softPaused?: boolean };
      setGranted(Boolean(g?.granted));
      setSoftPaused(Boolean(g?.softPaused));
    } catch {
      setGranted(false);
      setSoftPaused(false);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return window.grokdesk?.desktop?.onStatus((s) => {
      const st = s as { taskId?: string; softPaused?: boolean };
      if (st.taskId === taskId && typeof st.softPaused === "boolean") {
        setSoftPaused(st.softPaused);
      }
    });
  }, [taskId]);

  async function setGrant(next: boolean) {
    setLoading(true);
    try {
      await rpc("desktop.task.setGrant", {
        taskId,
        granted: next,
      });
      setGranted(next);
      if (next) {
        toast({
          title: t("desktop.toggle"),
          description: t("desktop.grantOnNote"),
        });
      }
      if (!next) setSoftPaused(false);
    } finally {
      setLoading(false);
    }
  }

  async function resume() {
    await rpc("desktop.task.resume", { taskId });
    setSoftPaused(false);
  }

  return { granted, softPaused, loading, setGrant, resume };
}

/** Inline switch — used where the header still shows desktop control. */
export function DesktopTaskToggle(props: { taskId: string }) {
  const t = useT();
  const { granted, softPaused, loading, setGrant, resume } =
    useDesktopTaskGrant(props.taskId);

  return (
    <div className="flex items-center gap-2" title={t("desktop.grantOnNote")}>
      <span className="text-xs text-muted-foreground">{t("desktop.toggle")}</span>
      <Switch
        checked={granted}
        disabled={loading}
        onCheckedChange={(v) => void setGrant(Boolean(v))}
        aria-label={t("desktop.toggle")}
      />
      {softPaused ? (
        <button
          type="button"
          className="text-2xs text-warning underline-offset-2 hover:underline"
          onClick={() => void resume()}
        >
          {t("desktop.resume")}
        </button>
      ) : null}
    </div>
  );
}

/** Overflow-menu items for the slim task header. */
export function DesktopTaskMenuItems(props: { taskId: string }) {
  const t = useT();
  const { granted, softPaused, loading, setGrant, resume } =
    useDesktopTaskGrant(props.taskId);

  return (
    <>
      <DropdownMenuCheckboxItem
        checked={granted}
        disabled={loading}
        onCheckedChange={(v) => void setGrant(Boolean(v))}
        onSelect={(e) => e.preventDefault()}
        title={t("desktop.grantOnNote")}
      >
        {t("desktop.toggle")}
      </DropdownMenuCheckboxItem>
      {softPaused ? (
        <DropdownMenuItem onClick={() => void resume()}>
          {t("desktop.resume")} ({t("desktop.toggle")})
        </DropdownMenuItem>
      ) : null}
    </>
  );
}
