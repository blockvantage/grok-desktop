import { useEffect, useState } from "react";
import type { DesktopStatusDto } from "@/components/desktop-control-hud";

export function useDesktopStatus(taskId: string | null): DesktopStatusDto | null {
  const [status, setStatus] = useState<DesktopStatusDto | null>(null);

  useEffect(() => {
    if (!taskId) {
      setStatus(null);
      return;
    }
    return window.grokdesk?.desktop?.onStatus((s) => {
      const st = s as DesktopStatusDto;
      if (st.taskId === taskId) setStatus(st);
    });
  }, [taskId]);

  return status;
}
