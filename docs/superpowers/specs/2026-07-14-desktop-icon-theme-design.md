# Desktop icon cleanup and appearance-aware tray design

## Goal

Remove the visible white corner/background artifacts from Grok Desk icon exports. Keep the existing gold-on-black brand mark for app-launcher and in-app use, while making the desktop tray icon automatically readable in light and dark system appearances.

## Scope

- Desktop is the primary target.
- Re-export the existing mark with correct alpha handling for renderer and packaging assets.
- Keep the branded color icon for the macOS dock, Windows/Linux launcher, browser favicon, and renderer branding.
- Add dedicated monochrome tray icons: dark glyph for light system UI and light glyph for dark system UI.
- Update Electron tray setup to choose the correct tray icon at startup and update it when `nativeTheme` changes.
- Update the mobile launcher icon assets with the cleaned branded icon.
- Add Android's `monochromeImage` so Android themed icons can adapt to the user's launcher theme.

## Platform behavior

| Surface | Appearance behavior |
| --- | --- |
| macOS dock / Windows / Linux launcher | Static, branded gold-on-black icon; operating systems do not offer a reliable system-appearance swap for the installed app icon. |
| Electron tray | Automatically swaps between monochrome light and dark variants using Electron `nativeTheme.shouldUseDarkColors`, and responds to `nativeTheme.updated`. |
| Desktop renderer | Static branded icon with transparent outer corners. |
| Android launcher | Branded adaptive icon plus a monochrome themed-icon asset for compatible launchers. |
| iOS launcher | Cleaned static branded icon; automatic system-appearance icon swapping is not supported by the app configuration. |

## Asset strategy

Use the existing mark as the sole source of brand geometry; do not generate or redraw the logo. Clean the background/outer-corner alpha and create size-appropriate PNG exports, plus the existing `.icns` and `.ico` packaging formats. The monochrome tray and Android themed assets use the same recognizable lightning mark without the rounded black tile, leaving sufficient transparent padding for system rendering.

## Error handling

Tray asset resolution retains a transparent one-pixel fallback if an expected tray file is missing. Theme updates must only replace the tray image, preserving the existing menu, tooltip, and status polling behavior.

## Validation

- Inspect exported PNG alpha channels: each outer corner is transparent and has no white fringe.
- Verify desktop packaging references still resolve to `build/icon.icns`, `build/icon.ico`, and `build/icon.png`.
- Add or update focused tests for tray theme image selection and theme-change behavior where the current test setup permits it.
- Run desktop typecheck and relevant tray/packaging tests.
- Confirm Expo configuration references the cleaned mobile asset and Android `monochromeImage`.
