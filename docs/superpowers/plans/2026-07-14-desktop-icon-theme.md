# Desktop Icon Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove white icon-corner artifacts and make the desktop tray mark adapt to the system appearance without changing the branded app icon.

**Architecture:** Preserve the existing gold-on-black mark for app packaging and renderer use. Add transparent monochrome tray files selected from Electron `nativeTheme`, refreshing only the tray image when the OS appearance changes. Re-export matching mobile assets and declare Android's themed-icon field.

**Tech Stack:** Electron 33, electron-builder, TypeScript, Vitest, Expo configuration, `sips`, `iconutil`.

---

## File structure

- `apps/desktop/build/icon.{png,ico,icns}`: cleaned branded desktop package assets.
- `apps/desktop/src/renderer/public/grok-desk-icon{,-full}.png`: cleaned branded renderer assets.
- `apps/desktop/src/renderer/public/tray-icon-{light,dark}.png`: transparent monochrome tray assets.
- `apps/desktop/src/main/tray.ts`: pure theme selector plus tray-theme listener.
- `apps/desktop/src/main/tray.test.ts`: unit tests for pure selection.
- `apps/desktop/src/packaging.smoke.test.ts`: artifact/config checks.
- `apps/mobile/assets/{icon,adaptive-icon,monochrome-icon}.png`: cleaned branded and Android themed assets.
- `apps/mobile/app.json`: Android monochrome icon declaration.

### Task 1: Add a failing asset and configuration contract

**Files:**
- Modify: `apps/desktop/src/packaging.smoke.test.ts`
- Create: `apps/desktop/src/main/tray.test.ts`

- [ ] **Step 1: Require the packaged renderer/tray files**

Append to `apps/desktop/src/packaging.smoke.test.ts`:

```ts
it("ships clean renderer and appearance-aware tray icon assets", () => {
  const rendererPublic = path.join(desktopRoot, "src/renderer/public");
  for (const name of [
    "grok-desk-icon.png", "grok-desk-icon-full.png",
    "tray-icon-light.png", "tray-icon-dark.png",
  ]) expect(fs.existsSync(path.join(rendererPublic, name))).toBe(true);
});

it("declares Android's monochrome themed icon", () => {
  const appJson = JSON.parse(fs.readFileSync(path.join(repoRoot, "apps/mobile/app.json"), "utf8")) as {
    expo?: { android?: { adaptiveIcon?: { monochromeImage?: string } } };
  };
  expect(appJson.expo?.android?.adaptiveIcon?.monochromeImage).toBe("./assets/monochrome-icon.png");
  expect(fs.existsSync(path.join(repoRoot, "apps/mobile/assets/monochrome-icon.png"))).toBe(true);
});
```

- [ ] **Step 2: Add failing pure selection tests**

Create `apps/desktop/src/main/tray.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { trayAssetName } from "./tray";

describe("trayAssetName", () => {
  it("uses a light glyph in dark system UI", () => {
    expect(trayAssetName(true)).toBe("tray-icon-light.png");
  });
  it("uses a dark glyph in light system UI", () => {
    expect(trayAssetName(false)).toBe("tray-icon-dark.png");
  });
});
```

- [ ] **Step 3: Run the focused tests and confirm failure**

Run: `pnpm --filter @grokdesk/desktop test -- src/packaging.smoke.test.ts src/main/tray.test.ts`

Expected: FAIL because the tray files, Android field, and `trayAssetName` do not yet exist.

- [ ] **Step 4: Commit the contract**

```bash
git add apps/desktop/src/packaging.smoke.test.ts apps/desktop/src/main/tray.test.ts
git commit -m "test(desktop): specify icon theme assets"
```

### Task 2: Create and validate clean image artifacts

**Files:**
- Modify: `apps/desktop/build/icon.png`, `apps/desktop/build/icon.ico`, `apps/desktop/build/icon.icns`
- Modify: `apps/desktop/src/renderer/public/grok-desk-icon.png`, `apps/desktop/src/renderer/public/grok-desk-icon-full.png`
- Create: `apps/desktop/src/renderer/public/tray-icon-light.png`, `apps/desktop/src/renderer/public/tray-icon-dark.png`
- Modify: `apps/mobile/assets/icon.png`, `apps/mobile/assets/adaptive-icon.png`
- Create: `apps/mobile/assets/monochrome-icon.png`

- [ ] **Step 1: Re-export the master mark with correct alpha**

Use the existing `apps/desktop/build/icon.png` only as the geometry source. Re-export a 1024×1024 RGBA master: keep the black rounded tile and gold lightning unchanged; make all four exterior corners fully transparent; do not flatten the image against white or leave a white/gray fringe.

- [ ] **Step 2: Export all branded PNG consumers from that master**

Produce exactly these clean RGBA outputs:

```text
apps/desktop/build/icon.png                              1024×1024
apps/desktop/src/renderer/public/grok-desk-icon.png       256×256
apps/desktop/src/renderer/public/grok-desk-icon-full.png 1024×1024
apps/mobile/assets/icon.png                              1024×1024
apps/mobile/assets/adaptive-icon.png                      512×512
```

- [ ] **Step 3: Export themed glyphs from the original lightning geometry**

Create 64×64 transparent PNGs with generous padding and no background tile:

```text
apps/desktop/src/renderer/public/tray-icon-light.png  solid white lightning glyph
apps/desktop/src/renderer/public/tray-icon-dark.png   solid near-black lightning glyph
apps/mobile/assets/monochrome-icon.png                solid black lightning glyph
```

Do not use an AI redraw. The desktop glyphs must be readable after resizing to 22px; the Android glyph is one opaque color with transparent outside pixels.

- [ ] **Step 4: Regenerate package containers**

Build `icon.ico` with 16, 24, 32, 48, 64, 128, and 256px entries, and build `icon.icns` with standard macOS sizes through 1024px, both from the clean branded master. Verify `sips -g format apps/desktop/build/icon.png` succeeds and `iconutil -c iconset apps/desktop/build/icon.icns -o /tmp/grokdesk-icon.iconset` succeeds.

- [ ] **Step 5: Validate pixel size and alpha**

Run:

```bash
sips -g pixelWidth -g pixelHeight -g hasAlpha apps/desktop/build/icon.png apps/desktop/src/renderer/public/grok-desk-icon.png apps/desktop/src/renderer/public/grok-desk-icon-full.png apps/desktop/src/renderer/public/tray-icon-light.png apps/desktop/src/renderer/public/tray-icon-dark.png apps/mobile/assets/icon.png apps/mobile/assets/adaptive-icon.png apps/mobile/assets/monochrome-icon.png
```

Expected: all report `hasAlpha: yes`; branded desktop sizes are 1024, 256, and 1024; each tray glyph is 64×64.

- [ ] **Step 6: Commit image artifacts**

```bash
git add apps/desktop/build apps/desktop/src/renderer/public apps/mobile/assets
git commit -m "fix(assets): clean icon corners and add themed glyphs"
```

### Task 3: Add desktop appearance switching and Android configuration

**Files:**
- Modify: `apps/desktop/src/main/tray.ts`
- Modify: `apps/mobile/app.json`

- [ ] **Step 1: Export the pure theme selector**

Change the Electron import to include `nativeTheme`, then add:

```ts
export function trayAssetName(shouldUseDarkColors: boolean): string {
  return shouldUseDarkColors ? "tray-icon-light.png" : "tray-icon-dark.png";
}
```

- [ ] **Step 2: Prefer the selected tray asset and retain fallback behavior**

At the start of `resolveTrayImage()`, put this candidate before the current branded candidates:

```ts
path.join(__dirname, "../renderer", trayAssetName(nativeTheme.shouldUseDarkColors)),
```

Keep the existing 22×22 resize and transparent one-pixel fallback exactly as-is.

- [ ] **Step 3: Refresh only the tray image on system appearance change**

Immediately after `const tray = new Tray(resolveTrayImage());`, add:

```ts
const refreshTrayImage = () => tray.setImage(resolveTrayImage());
nativeTheme.on("updated", refreshTrayImage);
```

Do not change the tray menu, tooltip, status subscriptions, or polling.

- [ ] **Step 4: Declare the Android themed icon**

Add the following property inside `expo.android.adaptiveIcon` in `apps/mobile/app.json`:

```json
"monochromeImage": "./assets/monochrome-icon.png"
```

- [ ] **Step 5: Run focused tests and confirm pass**

Run: `pnpm --filter @grokdesk/desktop test -- src/packaging.smoke.test.ts src/main/tray.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit runtime and config changes**

```bash
git add apps/desktop/src/main/tray.ts apps/mobile/app.json
git commit -m "feat(desktop): adapt tray icon to system appearance"
```

### Task 4: Verify build integration

**Files:**
- Verify: `apps/desktop/electron-builder.yml`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/renderer/components/brand-mark.tsx`

- [ ] **Step 1: Run static and behavioral validation**

Run:

```bash
pnpm --filter @grokdesk/desktop typecheck
pnpm --filter @grokdesk/desktop test
```

Expected: both commands pass with no TypeScript or Vitest failures.

- [ ] **Step 2: Build and confirm renderer asset inclusion**

Run:

```bash
pnpm --filter @grokdesk/desktop build
test -f apps/desktop/out/renderer/tray-icon-light.png
test -f apps/desktop/out/renderer/tray-icon-dark.png
rg -n "icon: build/icon\\.(icns|ico|png)" apps/desktop/electron-builder.yml
```

Expected: the build passes, both tray files are copied to `out/renderer`, and macOS, Windows, and Linux icon references remain present.

- [ ] **Step 3: Commit any necessary integration correction**

Run: `git status --short`

Expected: no source or asset changes beyond committed work. If a build-specific inclusion correction was necessary, commit it with `git commit -am "fix(desktop): include themed tray icon assets"`.
