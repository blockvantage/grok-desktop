/**
 * electron-builder afterPack: flip recommended Electron security fuses.
 *
 * electron-builder 25.x does not honor a top-level `electronFuses` config key
 * (that landed later). Use @electron/fuses against the packaged binary.
 *
 * CRITICAL: RunAsNode must remain ENABLED. Packaged gateway + desk MCP spawn
 * process.execPath with ELECTRON_RUN_AS_NODE=1 so better-sqlite3 matches the
 * Electron ABI. Flipping RunAsNode off would brick those children.
 *
 * EnableEmbeddedAsarIntegrityValidation is intentionally NOT flipped here:
 * it requires asar integrity metadata that electron-builder 25 does not
 * generate without newer electronFuses integration. Enabling the fuse without
 * hashes can refuse to load the app. Track under O-009 residual.
 *
 * grantFileProtocolExtraPrivileges stays default (enabled): packaged renderer
 * is loadFile() → file://.
 */
import path from "node:path";
import fs from "node:fs";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";

/**
 * @param {import('electron-builder').AfterPackContext} context
 */
export default async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const productFilename = packager.appInfo.productFilename;

  /** @type {string} */
  let electronBinaryPath;
  if (electronPlatformName === "darwin") {
    electronBinaryPath = path.join(
      appOutDir,
      `${productFilename}.app`,
      "Contents",
      "MacOS",
      productFilename,
    );
  } else if (electronPlatformName === "win32") {
    electronBinaryPath = path.join(appOutDir, `${productFilename}.exe`);
  } else {
    electronBinaryPath = path.join(appOutDir, productFilename);
  }

  if (!fs.existsSync(electronBinaryPath)) {
    throw new Error(
      `afterPack fuses: electron binary not found at ${electronBinaryPath}`,
    );
  }

  // Apple Silicon ad-hoc re-sign after fuse flip (electron-builder re-signs after).
  const needsResetAdHoc =
    electronPlatformName === "darwin" &&
    (context.arch === 3 /* arm64 */ || process.arch === "arm64");

  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,
    // Keep true — gateway/MCP require ELECTRON_RUN_AS_NODE.
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    // See file header — integrity fuse needs metadata we do not emit yet.
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false,
    // file:// renderer via loadFile — keep extra privileges.
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: true,
    resetAdHocDarwinSignature: needsResetAdHoc,
  });

  // eslint-disable-next-line no-console
  console.log(
    `[afterPack] Electron fuses applied (runAsNode=on) → ${electronBinaryPath}`,
  );
}
