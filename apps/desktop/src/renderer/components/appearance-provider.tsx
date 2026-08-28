import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyAppearance,
  detectSystemDark,
  loadAppearancePreference,
  resolveAppearance,
  storeAppearancePreference,
  type AppearancePreference,
  type ResolvedAppearance,
} from "@/lib/appearance";

type AppearanceContextValue = {
  preference: AppearancePreference;
  resolved: ResolvedAppearance;
  setPreference: (next: AppearancePreference) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider(props: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<AppearancePreference>(
    loadAppearancePreference,
  );
  const [systemDark, setSystemDark] = useState(detectSystemDark);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const setPreference = useCallback((next: AppearancePreference) => {
    setPreferenceState(next);
    storeAppearancePreference(next);
  }, []);

  const resolved = resolveAppearance(preference, systemDark);
  applyAppearance(resolved);

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <AppearanceContext.Provider value={value}>
      {props.children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    return {
      preference: "dark",
      resolved: "dark",
      setPreference: () => undefined,
    };
  }
  return ctx;
}
