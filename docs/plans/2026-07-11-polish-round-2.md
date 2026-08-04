# Polish round 2 — plan (to implement)

Base: `b4a9b17` on `feat/intelligence-skills-commerce`. Four independent areas,
ordered by value. Each area ends with the verification gate in section 5.

---

## 1. License: GD2-only by default (~1h, highest value)

**Problem.** GD1/HMAC keys still verify with the dev fallback secret that ships
in the binary (`DEFAULT_LICENSE_SECRET`), so anyone can mint keys. And the
offline verify path never re-checks the key signature, so a forged activation
blob (H1-signed with that same well-known secret) rides the grace window.

**Files:** `packages/license/src/keys.ts`, `activation.ts`, `service.ts`,
`index.ts`, `license.test.ts`; `packages/gateway/src/license.integration.test.ts`.

### 1a. keys.ts — provenance helper

```ts
export function hasExplicitLicenseSecret(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.GROKDESK_LICENSE_SECRET?.trim());
}
```

Export it from `index.ts`.

### 1b. activation.ts — gate both call sites, verify key offline

- Add `allowHmac?: boolean` to the opts of `activateLicense` AND
  `verifyActivation`. In both, compute:

```ts
const allowHmac =
  opts.allowHmac ?? (opts.secret != null || hasExplicitLicenseSecret());
```

  and pass it to `parseAndVerifyLicenseKey` (replacing the hardcoded
  `allowHmac: true`).

- In `verifyActivation`, MOVE the `parseAndVerifyLicenseKey(act.key, ...)`
  call out of the `if (online)` branch so it runs unconditionally, after the
  blob-signature check and before the grace check:

```ts
const parsed = parseAndVerifyLicenseKey(act.key, { secret, publicKeyPem, nowMs: now, allowHmac });
if (!parsed.ok) return { valid: false, reason: parsed.reason, offline: !online };
if (online) { /* refresh grace as today */ }
```

  Rationale: offline should skip the network, not the crypto. This is what
  makes a hand-crafted blob worthless even though the H1 blob signature is
  forgeable with the dev secret.

### 1c. service.ts — decide at construction, from provenance

`this.secret` always resolves (fallback included), so the service must record
where the secret came from, not what it is:

```ts
this.allowHmac =
  opts.allowHmac ?? (opts.secret != null || hasExplicitLicenseSecret());
```

Add `allowHmac?: boolean` to `LicenseServiceOptions`; pass `this.allowHmac`
into both the `activateLicense` and `verifyActivation` calls.

### 1d. Tests

Vitest threads share `process.env` across files in a worker, so wrap
default-behavior tests in a save/delete/restore helper:

```ts
function withoutEnvSecret<T>(fn: () => T): T {
  const saved = process.env.GROKDESK_LICENSE_SECRET;
  delete process.env.GROKDESK_LICENSE_SECRET;
  try { return fn(); } finally {
    if (saved !== undefined) process.env.GROKDESK_LICENSE_SECRET = saved;
  }
}
```

New unit tests (license.test.ts):
1. `issueLicenseKey({})` (fallback secret) then `activateLicense` with no
   secret/env → `ok: false`, `reason: "hmac_disabled"`. Same via
   `new LicenseService().activate(...)`.
2. Explicit secret still works: `issueLicenseKey({}, SECRET)` +
   `activateLicense({ key, machineId, secret: SECRET })` → ok.
3. Forged offline blob fails: build an ActivationState by hand with a fake
   `key: "GD2.xxx.yyy"`, sign the material with
   `signActivationBlob(material, { privateKeyPem: null })` (that is exactly
   what an attacker can do: H1 + dev secret), `verifyActivation(...,
   online: false)` → `valid: false`.
4. Real GD2 offline still passes: `issueLicenseKeyEd25519` with a generated
   pair, activate with `publicKeyPem`/`privateKeyPem`, verify offline → valid.

Gateway integration test (`license.integration.test.ts`) currently mints with
the fallback secret (`issueLicenseKey({ email })`) — it will fail after the
gate. Fix: in `beforeAll`, set `process.env.GROKDESK_LICENSE_SECRET =
"gw-integration-secret"` BEFORE the Gateway is constructed (LicenseService
reads env in its constructor), mint with that same secret, and delete the env
var in `afterAll`.

**Known residual (document, don't fix now):** a holder of a valid GD2 key can
re-sign their own blob to extend grace; the GD2 default public key is a
fail-closed placeholder until the real release key is embedded via
`GROKDESK_LICENSE_PUBLIC_KEY`.

---

## 2. Workspace `.grok` safety (~1h)

**Problems.** (a) Expanded secrets land in `<workspace>/.grok/config.toml`,
committable in a user's own project. (b) `stripMcpServerSections` deletes ALL
`[mcp_servers.*]` tables, including user-authored ones (and `[mcp.*]` too).
(c) The Windows/permission fallback copies only `SKILL.md`, dropping skill
resources.

**Files:** `packages/shared/src/mcp-config-write.ts` + `.test.ts`.

### 2a. `.gitignore` guard

In `writeProjectMcpConfig`, after `mkdirSync(grokDir)`: if
`.grok/.gitignore` does not exist, write `"config.toml\nskills/\n"`. Never
overwrite an existing one.

### 2b. Preserve foreign tables (marker approach)

- `renderMcpServersToml`: emit `# managed-by: grok-desk` as the first line
  inside every table Desk writes.
- `stripMcpServerSections(toml, managedIds: Set<string>)`: only remove a
  `[mcp_servers.<name>]` table when `name ∈ managedIds` OR the table body
  carries the marker (covers tables for servers disabled since the last
  write). Keep stripping the generator comment lines. Drop the
  `name.startsWith("mcp.")` clause — it eats user config.
- `writeProjectMcpConfig` passes
  `new Set(servers.map((s) => sanitizeMcpServerId(s.id)))` built from ALL
  Desk-known servers (enabled and disabled), so disabling one removes its
  stale table on the next write.

### 2c. Full skill-dir copy fallback

Replace the shallow `copyFileSync(SKILL.md)` fallback with
`fs.cpSync(src, dest, { recursive: true })`. Keep the per-pack try/catch.
Factor into an exported `copySkillDir(src, dest)` so it is directly testable.

### 2d. Tests

- User table `[mcp_servers.custom]` (no marker) survives a Desk rewrite.
- A Desk-marked table for a now-disabled server is removed.
- `.gitignore` created once; a pre-existing custom `.gitignore` is untouched.
- `copySkillDir` copies nested resource files, not just SKILL.md.

---

## 3. IPC schema + inbox retention (~45m)

### 3a. `settings.set` typed at the IPC layer

`packages/shared/src/ipc.ts` still has `params: z.record(z.unknown())` for
`settings.set` (the gateway service validates, but the wire schema should
too). Single source of truth: export a zod object
(`partialAppSettingsSchema`) from `packages/shared/src/settings-schema.ts`
(reimplement `parsePartialAppSettings` on top of it so the two can't drift)
and use it in ipc.ts. Field types: `maxConcurrentTasks:
z.number().int().min(1).max(8)`, `skillsPaths: z.array(z.string())`,
`mcpServers: z.array(mcpServerRowSchema)`, plus the remaining AppSettings
fields (copy the list from `packages/gateway/src/services/settings.ts`).
Do NOT include `license` — unknown keys get stripped, and the gateway's
"never accept license from set()" stays as the second belt.

Test (shared `ipc.test.ts`): params containing `license` validate but the
parsed value has no `license` key; `maxConcurrentTasks: 0` and
`skillsPaths: 42` are rejected.

### 3b. Inbox retention sweep

`packages/gateway/src/services/inbox.ts`: add `prune(maxAgeDays = 30)` that
deletes items which are read or dismissed AND older than the cutoff (check
the actual column names in db.ts before writing SQL). Call it in the
constructor and from `ProactivityService.tick`. Test: old read item pruned,
fresh unread kept.

---

## 4. Settings view polish (~2-3h, biggest area)

**File:** `apps/desktop/src/renderer/components/views/settings-view.tsx`
(+ `i18n/locales/*.json`, `i18n/i18n.test.ts`).

### 4a. Wire the ~60 hardcoded strings

Keys already exist UNUSED in en.json for most of them: settings.refreshStatus,
signOut, signInSuperGrok, notSignedIn, defaultModel(+Desc),
workspaceBehavior(+Desc), security(+Desc), connectors(+Desc),
enableRecommended, searchConnectors, loadingPresets, noConnectorsMatch,
clearFilters, whatYouGet, enableConnector, disableConnector, selectConnector,
activeMcp(+Desc), addCustom, noMcpYet, name, command, status, on, id, args,
skillsFolders(+Desc), bundledOn, noExtraSkills, browse, add, configured,
toolsHealth, localPerms, activate, notActivated, active, licensed,
licenseActivated, activationFailed, appVersion, machine. For strings with no
key, add one to en.json AND all six other locales (the i18n test enforces
key parity; preserve `{placeholder}` tokens exactly).

### 4b. Fix button-in-button gallery rows

Preset rows are `<button>` elements containing a shadcn `<Button>` (invalid
HTML, breaks keyboard/AT). Convert the row to
`<div role="button" tabIndex={0}>` with Enter/Space in onKeyDown and
`aria-selected`; keep the visual design identical.

### 4c. Separate loading / error / empty; no silent mutations

- Track `loading` and `error` separately for `connectors.listPresets`; a
  failure currently shows "Loading presets…" forever. Error state gets a
  Retry button.
- Every mutation currently fired as `void rpc(...)`
  (enablePreset/disablePreset/enableRecommended/addMcp) needs try/catch with
  user-visible feedback. First grep the renderer for an existing toast
  system (sonner / use-toast) and use it; otherwise inline error text near
  the control.

### 4d. License form UX

Prefix check (`GD1.`/`GD2.`) before submit with an inline message; disable
Activate + pending label while the rpc is in flight (no double-submit);
errors in `text-destructive`, success in a distinct positive style; all
messages localized.

**Renderer constraints (enforced by tests/hooks):** never call RegExp's
`exec` method in renderer files — the security hook flags the "dot exec
open-paren" token as child_process, so use String.match instead; do not touch
App.tsx or ui-structure.test.ts; no em-dash characters in App.tsx.

---

## 5. Verification gate (after each area, all before commit)

```sh
pnpm -r --filter @grokdesk/shared --filter @grokdesk/license \
        --filter @grokdesk/engine-grok --filter @grokdesk/gateway build
pnpm -r test          # baseline: shared 63, license 7, engine 28, gateway 51, desktop 36
cd apps/desktop && pnpm typecheck && npx electron-vite build
```

Plus: zero em-dashes in `src/renderer/App.tsx`, and no RegExp `exec` calls
anywhere under `src/renderer/`.
