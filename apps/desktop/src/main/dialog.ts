import { dialog, BrowserWindow } from "electron";

export async function pickDirectory(
  parent?: BrowserWindow | null,
): Promise<string | null> {
  const opts = {
    properties: ["openDirectory", "createDirectory"] as Array<
      "openDirectory" | "createDirectory"
    >,
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, opts)
    : await dialog.showOpenDialog(opts);
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0] ?? null;
}

export async function pickFiles(
  parent?: BrowserWindow | null,
): Promise<string[]> {
  const opts = {
    properties: ["openFile", "multiSelections"] as Array<
      "openFile" | "multiSelections"
    >,
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, opts)
    : await dialog.showOpenDialog(opts);
  if (result.canceled) return [];
  return result.filePaths ?? [];
}
