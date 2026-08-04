import path from "node:path";

export interface EnvLike {
  platform: NodeJS.Platform | "darwin" | "win32" | "linux";
  home: string;
  appData: string;
  localAppData: string;
}

export interface DataPaths {
  dataDir: string;
  logsDir: string;
  dbPath: string;
}

export function resolveDataPaths(env: EnvLike): DataPaths {
  if (env.platform === "darwin") {
    const dataDir = path.join(
      env.home,
      "Library",
      "Application Support",
      "GrokDesk",
    );
    const logsDir = path.join(env.home, "Library", "Logs", "GrokDesk");
    return { dataDir, logsDir, dbPath: path.join(dataDir, "grokdesk.sqlite") };
  }

  if (env.platform === "win32") {
    const dataDir = path.join(env.appData || env.home, "GrokDesk");
    const logsDir = path.join(env.localAppData || dataDir, "GrokDesk", "logs");
    return { dataDir, logsDir, dbPath: path.join(dataDir, "grokdesk.sqlite") };
  }

  const dataDir = path.join(env.home, ".local", "share", "GrokDesk");
  const logsDir = path.join(env.home, ".local", "state", "GrokDesk", "logs");
  return { dataDir, logsDir, dbPath: path.join(dataDir, "grokdesk.sqlite") };
}

export function resolveDataPathsFromProcess(
  proc: NodeJS.Process = process,
): DataPaths {
  const explicitDataDir = proc.env.GROKDESK_DATA_DIR?.trim();
  if (explicitDataDir) {
    if (!path.isAbsolute(explicitDataDir)) {
      throw new Error("GROKDESK_DATA_DIR must be an absolute path");
    }
    const dataDir = path.resolve(explicitDataDir);
    return {
      dataDir,
      logsDir: path.join(dataDir, "logs"),
      dbPath: path.join(dataDir, "grokdesk.sqlite"),
    };
  }
  return resolveDataPaths({
    platform: proc.platform,
    home: proc.env.HOME || proc.env.USERPROFILE || "",
    appData: proc.env.APPDATA || "",
    localAppData: proc.env.LOCALAPPDATA || "",
  });
}
