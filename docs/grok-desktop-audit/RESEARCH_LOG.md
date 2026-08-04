# Research log

| Date | URL / source | Subject | Related finding | Application | Caused change? | Limitations | Quality |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-07-23 | In-repo Electron main webPreferences | sandbox / contextIsolation defaults | SEC inventory | Confirmed sandbox true | No (already set) | Not live Electron docs fetch | primary code |
| 2026-07-23 | In-repo release-desktop.yml | Release unlock gate gap | F-2026-07-23-001 | Added refuse_unlock + artifact grep | Yes | No live Actions run | primary code |
| 2026-07-23 | Local `apps/desktop/out/main/index.js` | Baked unlock true | F-2026-07-23-001 | Proved footgun | Yes | Local artifact only | artifact |
| 2026-07-23 | https://grokdesk.app | Marketing claims | F-006/7/11 | Keychain, deletes always, memory home | In-app fixes; site open | Live public site | primary web |
| 2026-07-23 | In-repo realpath/symlink tests | Workspace confine | F-013/14 | Symlink escape on read/reveal | Yes | Unit only | primary code |
| 2026-07-23 | Windows path case | isPathInsideRoot | F-015 | Case-insensitive drive paths | Yes | Unit only | primary code |

External doc fetches (Electron security checklist, Apple notarization, WCAG) pending deeper phases.
