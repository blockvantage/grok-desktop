import { useEffect, useState } from "react";
import { elapsedSince } from "@/lib/elapsed";

/**
 * Live whole-second ticker from an ISO start. Clears when inactive.
 * Reduced-motion safe: plain number; callers render as text (PROG-1).
 */
export function useElapsedSeconds(
  startIso: string | null | undefined,
  active: boolean,
): number {
  const [seconds, setSeconds] = useState(() =>
    active && startIso ? elapsedSince(startIso, Date.now()) : 0,
  );

  useEffect(() => {
    if (!active || !startIso) {
      setSeconds(0);
      return;
    }
    setSeconds(elapsedSince(startIso, Date.now()));
    const id = window.setInterval(() => {
      setSeconds(elapsedSince(startIso, Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startIso, active]);

  return seconds;
}
