import { powerMonitor } from "electron";

/**
 * Wire Electron powerMonitor sleep/wake (and lock/unlock on macOS/Windows)
 * to gateway power-state for scheduler pause + auth refresh on wake.
 */
export function wirePowerMonitor(
  onState: (s: "active" | "suspended") => void,
): () => void {
  const suspend = () => onState("suspended");
  const resume = () => onState("active");
  powerMonitor.on("suspend", suspend);
  powerMonitor.on("resume", resume);
  const lockCapable =
    process.platform === "darwin" || process.platform === "win32";
  if (lockCapable) {
    // macOS/Windows lock/unlock behaves like short sleeps for token rotation.
    powerMonitor.on("lock-screen", suspend);
    powerMonitor.on("unlock-screen", resume);
  }
  return () => {
    powerMonitor.off("suspend", suspend);
    powerMonitor.off("resume", resume);
    if (lockCapable) {
      powerMonitor.off("lock-screen", suspend);
      powerMonitor.off("unlock-screen", resume);
    }
  };
}
