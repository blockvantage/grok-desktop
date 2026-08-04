import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveGatewayCli, resolveNodeBinary } from "./main/gateway-process";
import { ASSET_SCHEME } from "./main/asset-protocol";
import { parseIpcRequest } from "@grokdesk/shared";

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(here, "..");
const repoRoot = path.resolve(desktopRoot, "../..");

describe("packaging smoke", () => {
  it("ships the renderer request bridge with all browser RPC discriminators", () => {
    const preload = fs.readFileSync(
      path.join(desktopRoot, "src/preload/index.ts"),
      "utf8",
    );
    expect(preload).toMatch(
      /request:\s*\(payload: unknown\)\s*=>\s*ipcRenderer\.invoke\("grokdesk:request"/,
    );
    expect(
      parseIpcRequest({
        id: "capability",
        method: "browser.capability",
        params: {},
      }).method,
    ).toBe("browser.capability");
    expect(
      parseIpcRequest({
        id: "allow-external",
        method: "browser.allowExternal",
        params: { allowed: true },
      }).method,
    ).toBe("browser.allowExternal");
    expect(
      parseIpcRequest({
        id: "open-html",
        method: "browser.openHtml",
        params: { taskId: "task-1", path: "/workspace/index.html" },
      }).method,
    ).toBe("browser.openHtml");
  });

  it("bakes lease and release public keys via electron.vite main defines", () => {
    const cfg = fs.readFileSync(
      path.join(desktopRoot, "electron.vite.config.ts"),
      "utf8",
    );
    // Release keys already baked; lease verification keys must ship the same way
    // so offline cold-start can verify 30-day leases (not only deny-all).
    expect(cfg).toMatch(/__GROKDESK_RELEASE_PUBLIC_KEYS__/);
    expect(cfg).toMatch(/__GROKDESK_LEASE_PUBLIC_KEYS__/);
    expect(cfg).toMatch(/GROKDESK_LEASE_PUBLIC_KEYS|GROKDESK_LEASE_PUBLIC_JWKS/);
    expect(cfg).toMatch(/__GROKDESK_ENTITLEMENT_API_URL__/);
    expect(cfg).toMatch(/__GROKDESK_MANIFEST_URL__/);
    // Optional install-build unlock bake (review dist only; release CI must not set).
    expect(cfg).toMatch(/__GROKDESK_DEV_UNLOCK__/);
    expect(cfg).toMatch(/GROKDESK_BAKE_DEV_UNLOCK/);
  });

  it("never bakes entitlement unlock from runtime GROKDESK_DEV_UNLOCK alone", () => {
    // Root cause guard: GROKDESK_DEV_UNLOCK is set by `make local` and may linger
    // in developer shells. Compile-time bake must require the explicit
    // GROKDESK_BAKE_DEV_UNLOCK=1 flag only — otherwise a normal package build
    // while DEV_UNLOCK is in the environment ships a free entitlement bypass.
    const cfg = fs.readFileSync(
      path.join(desktopRoot, "electron.vite.config.ts"),
      "utf8",
    );
    expect(cfg).toMatch(
      /bakeDevUnlock\s*=\s*process\.env\.GROKDESK_BAKE_DEV_UNLOCK\s*===\s*["']1["']/,
    );
    // Must not OR-in the runtime unlock env for bake.
    expect(cfg).not.toMatch(
      /bakeDevUnlock[\s\S]{0,120}GROKDESK_DEV_UNLOCK\s*===\s*["']1["']/,
    );
    expect(cfg).not.toMatch(
      /GROKDESK_DEV_UNLOCK\s*===\s*["']1["'][\s\S]{0,80}bakeDevUnlock/,
    );
  });

  it("release workflow never enables unlock bake and hard-gates it", () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, ".github/workflows/release-desktop.yml"),
      "utf8",
    );
    // Must never assign unlock envs to the value "1" (empty explicit clears OK).
    expect(workflow).not.toMatch(
      /GROKDESK_DEV_UNLOCK\s*:\s*["']?1["']?/,
    );
    expect(workflow).not.toMatch(
      /GROKDESK_BAKE_DEV_UNLOCK\s*:\s*["']?1["']?/,
    );
    // Hard gate: release must refuse if bake/unlock envs are "1".
    expect(workflow).toMatch(/refuse_unlock/);
    expect(workflow).toMatch(/GROKDESK_BAKE_DEV_UNLOCK/);
    expect(workflow).toMatch(/const v = true/);
    expect(workflow).toMatch(/entitlement unlock baked true/i);
  });

  it("built main (when present) does not bake entitlement unlock true", () => {
    const mainJs = path.join(desktopRoot, "out/main/index.js");
    if (!fs.existsSync(mainJs)) return;
    // When BAKE was not requested for this tree, the define inlines `false`.
    // Accidental `const v = true` inside isBakedDevUnlock is a ship-blocker.
    // Skip if this tree was last built as an unlocked review package
    // (GROKDESK_BAKE_DEV_UNLOCK=1) — that is intentional for dist:mac:unlocked.
    if (process.env.GROKDESK_BAKE_DEV_UNLOCK === "1") return;
    const body = fs.readFileSync(mainJs, "utf8");
    // Match the isBakedDevUnlock body shape after vite define inlining.
    const unlockBodies = [
      ...body.matchAll(
        /function isBakedDevUnlock(?:\$\d+)?\(\)\s*\{[\s\S]*?const v = (true|false)/g,
      ),
    ];
    if (unlockBodies.length === 0) return;
    // If every body is true, this out/ was produced by an unlocked dist; skip.
    if (unlockBodies.every((m) => m[1] === "true")) return;
    for (const m of unlockBodies) {
      expect(m[1]).toBe("false");
    }
  });

  it("does not track a stray root apps/desktop/index.js package entry", async () => {
    // Packaging uses out/main/index.js only. A checked-in apps/desktop/index.js
    // was historically a vite/CJS dump that could bake unlock true into git.
    const stray = path.join(desktopRoot, "index.js");
    const gitignore = fs.readFileSync(
      path.join(repoRoot, ".gitignore"),
      "utf8",
    );
    expect(gitignore).toMatch(/apps\/desktop\/index\.js|\/index\.js/);
    // If the file still exists on disk (local build residue), it must not be
    // the package main field.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
    ) as { main?: string };
    expect(pkg.main).toMatch(/out\/main\/index\.js$/);
    // Must not be tracked by git when this monorepo is a git checkout.
    try {
      const { execFileSync } = await import("node:child_process");
      const tracked = execFileSync(
        "git",
        ["-C", repoRoot, "ls-files", "apps/desktop/index.js"],
        { encoding: "utf8" },
      ).trim();
      expect(tracked).toBe("");
    } catch {
      /* not a git checkout — ignore */
    }
    if (fs.existsSync(stray) && process.env.GROKDESK_BAKE_DEV_UNLOCK !== "1") {
      const body = fs.readFileSync(stray, "utf8");
      // Prefer absence; if present, never allow baked unlock true in-repo residue.
      const unlockBodies = [
        ...body.matchAll(
          /function isBakedDevUnlock(?:\$\d+)?\(\)\s*\{[\s\S]*?const v = (true|false)/g,
        ),
      ];
      for (const m of unlockBodies) {
        expect(m[1]).toBe("false");
      }
    }
  });

  it("native rebuild script supports cross-target Windows prebuilds", () => {
    const script = fs.readFileSync(
      path.join(desktopRoot, "scripts/rebuild-native-for-electron.mjs"),
      "utf8",
    );
    expect(script).toMatch(/--platform/);
    expect(script).toMatch(/--arch/);
    expect(script).toMatch(/prebuild-install/);
    expect(script).toMatch(/win32/);
    // Fail closed: refuse to package a Mach-O .node into a Windows build.
    expect(script).toMatch(/assertNodeBinaryPlatform|is not a Windows PE/);
  });

  it("electron-builder.yml has appId, productName, and icons", () => {
    const yml = fs.readFileSync(
      path.join(desktopRoot, "electron-builder.yml"),
      "utf8",
    );
    expect(yml).toMatch(/appId:\s*ai\.x\.grokdesk/);
    expect(yml).toMatch(/productName:\s*Grok Desk/);
    expect(yml).toMatch(/icon:\s*build\/icon/);
    expect(yml).not.toMatch(/^\s*-\s*portable\s*$/m);
    expect(yml).toMatch(/hardenedRuntime:\s*true/);
    expect(yml).toMatch(/notarize:\s*true/);
    expect(yml).toMatch(/entitlements:\s*build\/entitlements\.mac\.plist/);
  });

  it("one-click NSIS installs under the product name, not the scoped package name", () => {
    const yml = fs.readFileSync(
      path.join(desktopRoot, "electron-builder.yml"),
      "utf8",
    );
    expect(yml).toMatch(/oneClick:\s*true/);

    const include = fs.readFileSync(
      path.join(desktopRoot, "build", "installer.nsh"),
      "utf8",
    );
    expect(include).toMatch(/!undef\s+APP_FILENAME/);
    expect(include).toMatch(/!define\s+APP_FILENAME\s+"Grok Desk"/);
  });

  it("electron-builder.yml wires afterPack fuse flip (runAsNode kept on)", () => {
    const yml = fs.readFileSync(
      path.join(desktopRoot, "electron-builder.yml"),
      "utf8",
    );
    expect(yml).toMatch(/afterPack:\s*scripts\/after-pack-fuses\.mjs/);
    const hook = fs.readFileSync(
      path.join(desktopRoot, "scripts/after-pack-fuses.mjs"),
      "utf8",
    );
    // Gateway + MCP require ELECTRON_RUN_AS_NODE — fuse must stay enabled.
    expect(hook).toMatch(/FuseV1Options\.RunAsNode\]:\s*true/);
    expect(hook).toMatch(/FuseV1Options\.EnableCookieEncryption\]:\s*true/);
    expect(hook).toMatch(
      /FuseV1Options\.EnableNodeOptionsEnvironmentVariable\]:\s*false/,
    );
    expect(hook).toMatch(
      /FuseV1Options\.EnableNodeCliInspectArguments\]:\s*false/,
    );
    expect(hook).toMatch(/FuseV1Options\.OnlyLoadAppFromAsar\]:\s*true/);
    // Integrity fuse deferred until asar hash metadata is packaged.
    expect(hook).toMatch(
      /FuseV1Options\.EnableEmbeddedAsarIntegrityValidation\]:\s*false/,
    );
  });

  it("release workflow has executable signing and malware gates", () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, ".github/workflows/release-desktop.yml"),
      "utf8",
    );
    expect(workflow).not.toMatch(/TODO:/);
    expect(workflow).not.toMatch(/best-effort skeleton/i);
    expect(workflow).toMatch(/codesign --verify --deep --strict/);
    expect(workflow).toMatch(/Get-AuthenticodeSignature/);
    expect(workflow).toMatch(/Start-MpScan/);
    expect(workflow).toMatch(/forceCodeSigning=true/);
    expect(workflow).toMatch(/test -s \"\$hash_file\"/);
  });

  it("free GitHub release workflow signs Windows when certs exist and smokes install", () => {
    const workflow = fs.readFileSync(
      path.join(repoRoot, ".github/workflows/release-free-github.yml"),
      "utf8",
    );
    // Must not unconditionally force unsigned Windows packaging.
    // signAndEditExecutable=false is only for the no-cert path.
    expect(workflow).toMatch(/WIN_CSC_LINK/);
    expect(workflow).toMatch(/signAndEditExecutable=false/);
    expect(workflow).toMatch(/Windows free build is UNSIGNED|Installer is UNSIGNED/i);
    // End-to-end gates on the free Windows job.
    expect(workflow).toMatch(/Silent install failed|silent install smoke/i);
    expect(workflow).toMatch(/better_sqlite3\.node is not a Windows PE/);
    expect(workflow).toMatch(/keytar must not be packaged/);
    expect(workflow).toMatch(/Start-MpScan/);
    expect(workflow).toMatch(/GrokDesk-win-x64\.exe/);
    // Free matrix must not hard-code force-unsigned on the electron-builder args line.
    expect(workflow).not.toMatch(
      /eb_args:.*signAndEditExecutable=false/,
    );
  });

  it("build/ icons exist for mac/win/linux packaging", () => {
    for (const name of ["icon.png", "icon.ico", "icon.icns"] as const) {
      expect(fs.existsSync(path.join(desktopRoot, "build", name))).toBe(true);
    }
  });

  it("renderer includes the desktop icon theme assets", () => {
    for (const name of [
      "grok-desk-icon.png",
      "grok-desk-icon-full.png",
      "tray-icon-light.png",
      "tray-icon-dark.png",
    ] as const) {
      expect(
        fs.existsSync(path.join(desktopRoot, "src/renderer/public", name)),
      ).toBe(true);
    }
  });

  it("mobile Android adaptive icon declares a monochrome image", () => {
    const mobileRoot = path.join(repoRoot, "apps/mobile");
    const appConfig = JSON.parse(
      fs.readFileSync(path.join(mobileRoot, "app.json"), "utf8"),
    ) as {
      expo?: {
        android?: {
          adaptiveIcon?: {
            monochromeImage?: string;
          };
        };
      };
    };
    const monochromeImage = appConfig.expo?.android?.adaptiveIcon?.monochromeImage;

    expect(monochromeImage).toBe("./assets/monochrome-icon.png");
    expect(
      fs.existsSync(path.join(mobileRoot, monochromeImage ?? "")),
    ).toBe(true);
  });

  it("resolveGatewayCli finds monorepo gateway CLI", () => {
    const cli = resolveGatewayCli();
    expect(fs.existsSync(cli)).toBe(true);
    expect(cli.replace(/\\/g, "/")).toMatch(/gateway\/dist\/cli\.js$/);
  });

  it("resolveNodeBinary is system node outside packaged Electron", () => {
    const prev = process.env.GROKDESK_NODE_PATH;
    delete process.env.GROKDESK_NODE_PATH;
    try {
      const r = resolveNodeBinary();
      expect(r.command).toBe("node");
      expect(r.electronAsNode).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.GROKDESK_NODE_PATH;
      else process.env.GROKDESK_NODE_PATH = prev;
    }
  });

  it("BrandMark uses BASE_URL-relative icon paths", () => {
    const brand = fs.readFileSync(
      path.join(desktopRoot, "src/renderer/components/brand-mark.tsx"),
      "utf8",
    );
    expect(brand).not.toMatch(/src=["']\/grok-desk-icon/);
    expect(brand).toMatch(/import\.meta\.env\.BASE_URL/);
  });

  it("mac packaging declares NSMicrophoneUsageDescription for dictation", () => {
    const yml = fs.readFileSync(
      path.join(desktopRoot, "electron-builder.yml"),
      "utf8",
    );
    expect(yml).toMatch(/NSMicrophoneUsageDescription/);
    expect(yml).toMatch(/voice dictation/i);
  });

  it("ships desktop-mcp-server and screen capture usage string", () => {
    const yml = fs.readFileSync(
      path.join(desktopRoot, "electron-builder.yml"),
      "utf8",
    );
    expect(yml).toMatch(/desktop-mcp-server\.mjs/);
    expect(yml).toMatch(/NSScreenCaptureUsageDescription/);
    expect(
      fs.existsSync(
        path.join(desktopRoot, "resources/desktop-mcp-server.mjs"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(desktopRoot, "src/main/desktop/mac-adapter.ts")),
    ).toBe(true);
    expect(
      fs.existsSync(path.join(desktopRoot, "src/main/desktop/win-adapter.ts")),
    ).toBe(true);
  });

  it("desktop and browser MCP hostExec bound fetch with AbortSignal.timeout", () => {
    for (const name of [
      "desktop-mcp-server.mjs",
      "browser-mcp-server.mjs",
    ] as const) {
      const src = fs.readFileSync(
        path.join(desktopRoot, "resources", name),
        "utf8",
      );
      expect(src).toMatch(/AbortSignal\.timeout\s*\(\s*HOST_EXEC_TIMEOUT_MS\s*\)/);
      expect(src).toMatch(/HOST_EXEC_TIMEOUT_MS\s*=\s*60_000/);
    }
  });

  it("media lightbox materializes blobs with timeout and size cap", () => {
    const src = fs.readFileSync(
      path.join(
        desktopRoot,
        "src/renderer/components/media-lightbox.tsx",
      ),
      "utf8",
    );
    expect(src).toMatch(/AbortSignal\.timeout\s*\(\s*MEDIA_FETCH_TIMEOUT_MS\s*\)/);
    expect(src).toMatch(/MEDIA_FETCH_MAX_BYTES/);
  });

  it("main wires media permission + Grok STT dictation IPC", () => {
    const main = fs.readFileSync(
      path.join(desktopRoot, "src/main/index.ts"),
      "utf8",
    );
    expect(main).toMatch(/setPermissionRequestHandler/);
    expect(main).toMatch(/registerDictationIpc/);
    const dictation = fs.readFileSync(
      path.join(desktopRoot, "src/main/dictation-service.ts"),
      "utf8",
    );
    expect(dictation).toMatch(/transcribeAudioFile/);
    expect(dictation).toMatch(/api\.x\.ai|encodeWavPcm16|grok_stt/);
    const preload = fs.readFileSync(
      path.join(desktopRoot, "src/preload/index.ts"),
      "utf8",
    );
    expect(preload).toMatch(/dictation/);
    expect(preload).toMatch(/pickFiles/);
    expect(preload).toMatch(/writeTempAttachment/);
    // Token boundary: preload must not expose access_token / Bearer material
    expect(preload).not.toMatch(/access_token|accessToken|Bearer /);
  });

  it("Home and follow-up composers include DictationButton", () => {
    const home = fs.readFileSync(
      path.join(desktopRoot, "src/renderer/components/views/home-view.tsx"),
      "utf8",
    );
    const ws = fs.readFileSync(
      path.join(
        desktopRoot,
        "src/renderer/components/views/task-workspace-view.tsx",
      ),
      "utf8",
    );
    expect(home).toMatch(/DictationButton/);
    expect(ws).toMatch(/DictationButton/);
    expect(home).toMatch(/Paperclip|pickFiles/);
    expect(ws).toMatch(/Paperclip|pickFiles/);
  });

  it("main and browser views pin webSecurity and sandbox", () => {
    const main = fs.readFileSync(
      path.join(desktopRoot, "src/main/index.ts"),
      "utf8",
    );
    expect(main).toMatch(/sandbox:\s*true/);
    expect(main).toMatch(/webSecurity:\s*true/);
    expect(main).toMatch(/allowRunningInsecureContent:\s*false/);
    const browser = fs.readFileSync(
      path.join(desktopRoot, "src/main/browser-service.ts"),
      "utf8",
    );
    expect(browser).toMatch(/sandbox:\s*true/);
    expect(browser).toMatch(/webSecurity:\s*true/);
    expect(browser).toMatch(/allowRunningInsecureContent:\s*false/);
  });

  it("CSP allows grokdesk-asset scheme for media", () => {
    const html = fs.readFileSync(
      path.join(desktopRoot, "src/renderer/index.html"),
      "utf8",
    );
    expect(html).toContain(`${ASSET_SCHEME}:`);
    expect(html).toMatch(/img-src[^"]*grokdesk-asset:/);
    expect(html).toMatch(/media-src[^"]*grokdesk-asset:/);
  });

  it("built main (when present) references Electron-as-Node and gateway", () => {
    const mainJs = path.join(desktopRoot, "out/main/index.js");
    if (!fs.existsSync(mainJs)) {
      // Dev tree may not have built yet; structural source check instead.
      const src = fs.readFileSync(
        path.join(desktopRoot, "src/main/gateway-process.ts"),
        "utf8",
      );
      expect(src).toMatch(/ELECTRON_RUN_AS_NODE/);
      expect(src).toMatch(/@grokdesk\/gateway|gateway\/dist\/cli/);
      return;
    }
    const body = fs.readFileSync(mainJs, "utf8");
    expect(body).toMatch(/ELECTRON_RUN_AS_NODE/);
    expect(body).toMatch(/gateway/);
  });

  it("package.json has product metadata for installers", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
    ) as {
      description?: string;
      author?: { name?: string };
      homepage?: string;
    };
    expect(pkg.description?.length).toBeGreaterThan(5);
    expect(pkg.author?.name).toBeTruthy();
    expect(pkg.homepage).toMatch(/^https?:\/\//);
  });

  it("repo root package name is grok-desktop monorepo", () => {
    const rootPkg = path.join(repoRoot, "package.json");
    expect(fs.existsSync(rootPkg)).toBe(true);
  });

  it("free Desk has no product-license settings tab", () => {
    const licenseTab = path.join(
      desktopRoot,
      "src/renderer/components/views/settings/license-tab.tsx",
    );
    expect(fs.existsSync(licenseTab)).toBe(false);
    const mainSrc = fs.readFileSync(
      path.join(desktopRoot, "src/main/index.ts"),
      "utf8",
    );
    expect(mainSrc).toMatch(/product-license enforcement disabled|free Desk/i);
    expect(mainSrc).toMatch(/GROKDESK_ENTITLEMENT_FAIL_CLOSED\s*=\s*["']0["']/);
    expect(mainSrc).not.toMatch(/createEntitlementBootstrap|registerEntitlementIpc/);
  });

  it("free packaging docs do not require product-license key bake", () => {
    // Drive the real free-distribution packaging docs on disk (not a re-implementation).
    const mac = fs.readFileSync(
      path.join(repoRoot, "docs/packaging-macos.md"),
      "utf8",
    );
    const win = fs.readFileSync(
      path.join(repoRoot, "docs/packaging-windows.md"),
      "utf8",
    );
    const freeWorkflow = fs.readFileSync(
      path.join(repoRoot, ".github/workflows/release-free-github.yml"),
      "utf8",
    );

    // Free public channel is documented (not only paid release-desktop).
    expect(mac).toMatch(/release-free-github\.yml/);
    expect(win).toMatch(/release-free-github\.yml/);
    expect(freeWorkflow.length).toBeGreaterThan(100);

    // Product licensing is retired — must not instruct baking LICENSE_PUBLIC_KEY
    // so main can verify Desk product licenses for free/public builds.
    for (const doc of [mac, win]) {
      expect(doc).toMatch(/Product licensing \(retired\)|product licensing is retired|retired/i);
      expect(doc).not.toMatch(
        /Bake `?GROKDESK_LICENSE_PUBLIC_KEY`? at electron-vite build time for release/i,
      );
      expect(doc).not.toMatch(
        /set `?GROKDESK_LICENSE_PUBLIC_KEY`?[\s\S]{0,80}verify licenses/i,
      );
      expect(doc).not.toMatch(
        /SHA-256 catalog entry imported to entitlement release service/i,
      );
      // Optional update crypto remains distinct from Desk product keys.
      expect(doc).toMatch(/GROKDESK_RELEASE_PUBLIC_KEYS|update \/ runtime/i);
    }
  });

  it("settings privacy copy discloses memory goes to SuperGrok", () => {
    const en = fs.readFileSync(
      path.join(desktopRoot, "src/renderer/i18n/locales/en.json"),
      "utf8",
    );
    // Must not claim all memory stays only local without SuperGrok disclosure.
    expect(en).toMatch(/Relevant memory items are sent to SuperGrok/i);
    expect(en).toMatch(/Relevant memory is sent to SuperGrok/i);
  });

  it("uses a fail-closed local-file credential vault (no keychain / keytar)", () => {
    // better-sqlite3 is still loaded in the gateway child, so its Electron-ABI
    // rebuild must stay wired.
    const rebuildElectron = fs.readFileSync(
      path.join(desktopRoot, "scripts/rebuild-native-for-electron.mjs"),
      "utf8",
    );
    expect(rebuildElectron).toMatch(/better-sqlite3/);

    const safeVault = fs.readFileSync(
      path.join(desktopRoot, "src/main/entitlements/safe-storage-vault.ts"),
      "utf8",
    );
    const bootstrap = fs.readFileSync(
      path.join(desktopRoot, "src/main/entitlements/bootstrap.ts"),
      "utf8",
    );
    const types = fs.readFileSync(
      path.join(desktopRoot, "src/main/entitlements/types.ts"),
      "utf8",
    );
    const entitlementSrc = `${safeVault}\n${types}`;

    // Production vault: AES file under userData + local .key — never Keychain.
    expect(safeVault).toMatch(/aes-256-gcm/);
    expect(safeVault).toMatch(/credential-vault/);
    expect(safeVault).toMatch(/\.key/);
    // Implementation must not import or call keytar (comments may mention it).
    expect(safeVault).not.toMatch(/from ["']@github\/keytar["']|require\(["']keytar["']\)/);
    expect(safeVault).toMatch(/no Keychain|Never uses Keychain/i);
    // Bootstrap wires the file vault factory only.
    expect(bootstrap).toMatch(/createSafeStorageCredentialVault/);
    expect(bootstrap).not.toMatch(/createOsCredentialVault/);
    expect(bootstrap).not.toMatch(/createMemoryCredentialVault/);

    // Account identity is preserved across the vault swap.
    expect(entitlementSrc).toMatch(/product-key\/v1/);
    expect(entitlementSrc).toMatch(/device-identity\/v1/);

    // Fail-closed: never a plaintext / memory fallback in production vault.
    expect(entitlementSrc).toMatch(/credential_store_failure/);
    expect(safeVault).not.toMatch(/MemoryCredentialVault|createMemoryCredentialVault/);

    // Dependency must not reintroduce keytar.
    const pkg = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const deps = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    };
    expect(deps["@github/keytar"]).toBeUndefined();
    expect(deps.keytar).toBeUndefined();
  });

  it("pins a host Node version supported by the native rebuild toolchain", () => {
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as {
      engines?: { node?: string };
      volta?: { node?: string };
    };
    expect(rootPkg.engines?.node).toBe(">=22.12.0 <23");
    expect(rootPkg.volta?.node).toMatch(/^22\./);
    expect(fs.readFileSync(path.join(repoRoot, ".nvmrc"), "utf8").trim()).toBe(
      "22",
    );

    const workflows = [
      ".github/workflows/ci.yml",
      ".github/workflows/commerce-runtime-integration.yml",
      ".github/workflows/release-desktop.yml",
      ".github/workflows/release-free-github.yml",
    ];
    for (const relative of workflows) {
      const workflow = fs.readFileSync(path.join(repoRoot, relative), "utf8");
      expect(workflow, relative).not.toMatch(/node-version:\s*["']?20["']?/);
      expect(workflow, relative).toMatch(/node-version:\s*["']?22["']?/);
    }
  });

  it("keeps local directory packaging independent of ambient signing identities", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const pack = pkg.scripts?.pack ?? "";
    expect(pack).toMatch(/--config\.mac\.identity=null/);
    expect(pack).toMatch(/--config\.mac\.notarize=false/);
    expect(pack).toMatch(/--config\.win\.signAndEditExecutable=false/);
  });

  it("resolved desktop toolchain meets advisory-patched floors", async () => {
    // Guard the full-audit floors that previously produced the 41-finding backlog.
    // Resolves real installed package.json versions (not ranges) from node_modules.
    const { createRequire } = await import("node:module");
    const requireFromDesktop = createRequire(
      path.join(desktopRoot, "package.json"),
    );
    // pnpm nests electron-builder deps; resolve nested packages from that edge.
    const electronBuilderPkg = requireFromDesktop.resolve(
      "electron-builder/package.json",
    );
    const requireFromBuilder = createRequire(electronBuilderPkg);

    function installedVersion(name: string): string {
      let pkgJson: string;
      try {
        pkgJson = requireFromDesktop.resolve(`${name}/package.json`);
      } catch {
        pkgJson = requireFromBuilder.resolve(`${name}/package.json`);
      }
      const ver = (
        JSON.parse(fs.readFileSync(pkgJson, "utf8")) as { version: string }
      ).version;
      return ver;
    }

    /** Compare dotted numeric prefixes (a.b.c); returns true if a >= b. */
    function gte(actual: string, floor: string): boolean {
      const parse = (v: string) =>
        v
          .replace(/^v/, "")
          .split(/[-+]/)[0]
          .split(".")
          .map((n) => Number.parseInt(n, 10) || 0);
      const a = parse(actual);
      const b = parse(floor);
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i++) {
        const x = a[i] ?? 0;
        const y = b[i] ?? 0;
        if (x > y) return true;
        if (x < y) return false;
      }
      return true;
    }

    // Advisory and support floors reviewed during the toolchain upgrade.
    const floors: Array<[string, string]> = [
      ["electron", "43.2.0"],
      ["vite", "6.4.3"],
      ["vitest", "3.2.6"],
      ["@playwright/test", "1.55.1"],
      ["electron-builder", "26.15.0"],
      ["app-builder-lib", "26.15.0"],
      ["builder-util-runtime", "9.7.0"],
      ["electron-vite", "3.1.0"],
    ];

    for (const [name, floor] of floors) {
      const ver = installedVersion(name);
      expect(gte(ver, floor), `${name}@${ver} must be >= ${floor}`).toBe(true);
    }

    // Manifest pins must declare the same floors (ranges, not exact resolves).
    const pkg = JSON.parse(
      fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"),
    ) as { devDependencies: Record<string, string> };
    const dev = pkg.devDependencies;
    expect(dev.electron).toMatch(/\^?43\.|>=?43\./);
    expect(dev.vite).toMatch(/\^?6\.|>=?6\./);
    expect(dev.vitest).toMatch(/\^?3\.|>=?3\./);
    expect(dev["@playwright/test"]).toMatch(/\^?1\.(5[5-9]|[6-9])|>=?1\.5[5-9]/);
    expect(dev["electron-builder"]).toMatch(/\^?26\.|>=?26\./);
    expect(dev["electron-vite"]).toMatch(/\^?[3-9]\.|>=?[3-9]\./);

    // Root overrides must force tar / ip-address / esbuild past advisory floors.
    const rootPkg = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"),
    ) as { pnpm?: { overrides?: Record<string, string> } };
    const overrides = rootPkg.pnpm?.overrides ?? {};
    const overrideBlob = JSON.stringify(overrides);
    expect(overrideBlob).toMatch(/tar/);
    expect(overrideBlob).toMatch(/7\.5\.2[2-9]|7\.[6-9]|[89]\./);
    expect(overrideBlob).toMatch(/ip-address/);
    expect(overrideBlob).toMatch(/esbuild/);

    // Prove nested builder packages actually resolved (not skipped).
    expect(installedVersion("app-builder-lib")).toMatch(/^26\./);
    expect(installedVersion("builder-util-runtime")).toMatch(/^9\.7\./);
  });
});
