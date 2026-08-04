# Chat Experience Level-Up Implementation Plan

> **STATUS — ROUND COMPLETE (2026-07-17).** All 8 waves landed across 27 feature
> commits (`65946a0`..`aedb718`, atop Wave 0 setup `512880f`/`bc67c3a`/`f13929f`).
> Every spec item in `apps/desktop/EXPERIENCE_IMPROVEMENTS.md` is marked DONE. Final
> gates green: desktop **1258 tests / 209 files** + typecheck, shared **271**, engine
> **105**, gateway **685**, build main chunk **2,383 kB** (≤ 2.40 MB cap). Wave map:
> W1 schema/locale (`65946a0`,`7b441f6`) · W2 media/audio (`99626c2`,`acc0ea3`,`d6b1a14`)
> · W3 slash (`060ea3c`,`d04793a`,`583df85`,`766841b`) · W4 deliverables
> (`59e3213`,`1178220`,`a2dfe37`) · W5 progress (`7488283`,`837db27`,`97a886c`) · W6
> language (`2f35e54`,`1dac6b7`,`05ce235`,`eca7849`,`46153de`) · W7A conversation
> (`cc9dc91`,`08a5864`,`f89b791`,`35093af`) · W7B stream (`c7d58b3`,`966bfed`,`aedb718`).
> The per-step checkboxes below are the historical TDD script, left as-is.
>
> **For agentic workers:** This plan is executed by Grok worker agents orchestrated by
> Claude (orchestrator reviews diffs + runs gates between tasks). Steps use checkbox
> (`- [ ]`) syntax for tracking. Spec: `apps/desktop/EXPERIENCE_IMPROVEMENTS.md`
> (mark items DONE there as tasks land). Workers: read BOTH files before coding.

**Goal:** Ship the six chat-experience upgrades from EXPERIENCE_IMPROVEMENTS.md — slash
commands that expand at send time, audible/playable media, principal-asset deliverables,
live progress, language support that reaches the model, and chat polish round 3.

**Architecture:** Renderer is Electron React (apps/desktop), backend is the stdio
gateway (packages/gateway) + engine (packages/engine-grok), schemas in packages/shared.
All new behavior lands as pure functions in `src/renderer/lib/` first (unit-tested),
then thin wiring in the big view files. Schema changes land once, early (Wave 1), so
later waves never touch packages/shared again.

**Tech stack:** TypeScript, React 18, Tailwind (owned shadcn), zod schemas, vitest.
NO new dependencies anywhere in this plan.

**Baselines (2026-07-17, verified at Wave 0):** desktop tests **1176 passed / 195
files**; shared **269**; gateway **678** (run via `pnpm test` so the better-sqlite3
ABI pretest executes); build main chunk **2,304 kB**; Node v20.13.1.

---

## Non-negotiable rules for every worker

1. Read `apps/desktop/EXPERIENCE_IMPROVEMENTS.md` (the spec) + this plan's task before
   coding. Re-verify cited line numbers — files drift.
2. TDD for every pure function: failing test → run → implement → pass → commit.
3. i18n: every new/changed user-facing string hits ALL 7 locales
   (`src/renderer/i18n/locales/{en,de,es,fr,ja,pt,zh}.json`) — parity tests fail
   otherwise. Translate properly (CJK must differ from English; no English clones).
4. `ui-structure.test.ts`: App.tsx must contain NO em-dash (—) characters.
5. Never call the regex `exec` method in new renderer code — a security hook
   false-flags that token. Use `String.match()`. (Existing occurrences in
   composer-input.ts are grandfathered; do not add more.)
6. Floating/overlay surfaces: fully opaque `bg-[hsl(var(--surface-3))]`, NO
   backdrop-blur.
7. Gates before every commit (run from repo root):
   ```bash
   pnpm --filter @grokdesk/desktop typecheck
   (cd apps/desktop && pnpm vitest run)   # ≥1176 tests, all pass, never shrinks
   (cd apps/desktop && pnpm build)        # main chunk stays ≤ ~2.35 MB
   ```
   When packages/shared, packages/gateway, or packages/engine-grok are touched, ALSO:
   ```bash
   (cd packages/shared && pnpm vitest run)
   (cd packages/gateway && pnpm vitest run)   # requires Node 20 (.nvmrc)
   (cd packages/engine-grok && pnpm vitest run)
   ```
8. Conventional commits, one commit per task (or per step where marked). Never commit
   unrelated files.

---

## Wave 0 — Ground truth & clean tree (orchestrator + smoke worker)

### Task 0.1: Land the pre-existing WIP as its own commit

**Files:** `packages/shared/src/ipc.ts`, `packages/shared/src/policy.ts`,
`packages/gateway/src/index.ts`, `packages/gateway/src/provider-composition.ts`,
`packages/gateway/src/services/gateway-domain-deps.ts`,
`packages/gateway/src/services/role-pack-apply.ts`

The working tree has coherent uncommitted plumbing (interject/compact/rewind/power RPC
schemas, runAttempts usage bag, `media` tool name, `max` role-pack effort, modality
defaults) that landed features already expect.

- [ ] **Step 1:** Run shared + gateway + desktop gates on the tree as-is.
- [ ] **Step 2:** If green, commit exactly those six files:
  ```bash
  git add packages/shared/src/ipc.ts packages/shared/src/policy.ts \
    packages/gateway/src/index.ts packages/gateway/src/provider-composition.ts \
    packages/gateway/src/services/gateway-domain-deps.ts \
    packages/gateway/src/services/role-pack-apply.ts
  git commit -m "feat(ipc): interject/compact/rewind/power schemas + usage bag (pre-round WIP)"
  ```
  If gates fail, STOP and report — do not start Wave 1 on a broken base.
- [ ] **Step 3:** `git status` must show only `.grok-media/` and
  `apps/desktop/EXPERIENCE_IMPROVEMENTS.md` (+ this plan) untracked/modified. Commit
  the two docs: `docs: chat experience review + level-up plan`.

### Task 0.2: AV-1 — audio ground-truth smoke (worker)

**Files:** none (scratch dir only) + record verdict in
`apps/desktop/EXPERIENCE_IMPROVEMENTS.md` under AV-1.

- [ ] **Step 1:** In a scratch dir, run the real CLI with the current video template:
  ```bash
  mkdir -p /tmp/av1-smoke/artifacts && cd /tmp/av1-smoke
  grok -p "Generate a short polished teaser video for a desktop AI assistant app and save it under ./artifacts as an mp4, with a short caption file." --model grok-4.5
  ```
  (If `grok` needs different flags, check `packages/engine-grok/src/session.ts`
  `headlessSpawnArgv` for the exact argv shape and mirror it.)
- [ ] **Step 2:** Probe the produced mp4 for an audio stream:
  ```bash
  f=$(ls artifacts/*.mp4 | head -1)
  ffprobe -v error -select_streams a -show_entries stream=codec_name "$f" 2>/dev/null \
    || mdls -name kMDItemAudioSampleRate -name kMDItemAudioBitRate "$f"
  ```
  Audio present ⇢ ffprobe prints a codec (e.g. `aac`) / mdls shows a sample rate.
- [ ] **Step 3:** Repeat once with an explicit audio ask appended: "…with a fitting
  music bed or ambient audio track in the mp4." Probe again.
- [ ] **Step 4:** Record BOTH verdicts in EXPERIENCE_IMPROVEMENTS.md AV-1 mark
  ("default: audio yes/no · with-ask: audio yes/no" + probe output). This decides
  Task 2.2's branch. No commit yet (Task 2.2 commits the doc edit).

### Task 0.3: CHAT-8 — regression verdicts (worker, read-only)

- [ ] **Step 1:** Verify in source, recording file:line for each:
  a. Question chips: does `followUpBusy` reach TaskStream and disable chips? Is the
     extracted question `prompt` rendered as the header (search
     `user-question`, `questionChips` in `task-stream.tsx`)?
  b. Approval card: does the in-stream approval card render tool/command/path detail
     from the event payload (search `approvalNeeded`, `ToolActionRow` reuse near
     `task-workspace-view.tsx:1340`)?
  c. Streaming caret: does `.stream-caret` CSS target `.typeset > :last-child::after`
     (in-flow) or the wrapper div (detached)? Check `globals.css` + `task-stream.tsx`.
- [ ] **Step 2:** Write a one-line verdict per item into EXPERIENCE_IMPROVEMENTS.md
  CHAT-8 (REGRESSED at file:line / OK since commit X). Regressed items become Wave 7
  work; OK items are marked no-change. No commit (Wave 7 commits it).

---

## Wave 1 — Schema round (ONE worker; the only wave touching packages/shared)

### Task 1.1: Artifact payloads carry sizeBytes + mime (ASSET-2)

**Files:**
- Modify: `packages/gateway/src/services/workspace-deliverables.ts`
- Modify: `packages/gateway/src/services/harvest-artifact-payload.ts`
- Modify: `packages/gateway/src/services/runner.ts` (harvest call site ~1100-1164)
- Check:  `packages/gateway/src/services/workspace-asset.ts` (mime map — reuse it)
- Test:   the package's existing test file for these modules — extend, don't fork

- [ ] **Step 1: Failing tests** — `listDeliverableFiles` returns `sizeBytes`;
  `guessArtifactMime` maps mp4→`video/mp4`, png→`image/png`, mp3→`audio/mpeg`,
  unknown→`undefined`; `harvestArtifactCreatedPayload` passes both through:
  ```ts
  it("returns sizeBytes for harvested files", () => {
    // write a temp file of 5 bytes in a tmp dir, harvest, expect sizeBytes 5
  });
  it("guesses mime from extension", () => {
    expect(guessArtifactMime("a.mp4")).toBe("video/mp4");
    expect(guessArtifactMime("a.mp3")).toBe("audio/mpeg");
    expect(guessArtifactMime("a.zzz")).toBeUndefined();
  });
  it("payload carries sizeBytes and mime", () => {
    const p = harvestArtifactCreatedPayload(
      { title: "a.mp4", path: "/x/a.mp4", kind: "media", sizeBytes: 9, mime: "video/mp4" },
      "id1",
    );
    expect(p.sizeBytes).toBe(9);
    expect(p.mime).toBe("video/mp4");
  });
  ```
- [ ] **Step 2:** Run (Node 20): `cd packages/gateway && pnpm vitest run` → new tests FAIL.
- [ ] **Step 3: Implement.** In `workspace-deliverables.ts`: return
  `{ name, path, sizeBytes }` from `listDeliverableFiles` (the walker already has
  `st.size`); add `guessArtifactMime(name)` — reuse/extract the extension→mime map
  from `workspace-asset.ts` into one exported helper so there is exactly one map.
  In `harvest-artifact-payload.ts`:
  ```ts
  export type HarvestItemLike = {
    title: string;
    path: string;
    kind: "file" | "report" | "media" | "card";
    sizeBytes?: number;
    mime?: string;
  };
  export type HarvestArtifactPayload = HarvestItemLike & { id: string };
  ```
  In `runner.ts` harvest site: thread `sizeBytes` + `guessArtifactMime(name)` into the
  items. If a zod schema validates artifact event payloads anywhere in
  packages/shared (grep `artifact` in `packages/shared/src/`), add the two OPTIONAL
  fields there too — optional so old persisted events still parse.
- [ ] **Step 4:** Gates (gateway + shared + desktop). PASS.
- [ ] **Step 5:** `git commit -m "feat(gateway): artifact payloads carry sizeBytes + mime"`

### Task 1.2: `locale` + `goalSource` ride tasks.create / follow-up (LANG-1 + CMD-4 schema)

**Files:**
- Modify: `packages/shared/src/ipc.ts` (`CreateTaskInputSchema` ~line 22; the
  follow-up method schema — find `parentTaskId`/`goalText` usages)
- Modify: `packages/gateway/src/services/` task-create path (trace: where
  `tasks.create` params become the Task given to the runner/engine — search
  `CreateTaskInputSchema` and `goal:` consumers)
- Modify: `packages/engine-grok/src/types.ts` (Task type ~98-117) and
  `packages/engine-grok/src/session.ts` (promptParts ~344-361)
- Test: engine session test (extend existing prompt-assembly test file in
  `packages/engine-grok/src/`)

- [ ] **Step 1: Schema.** Add to `CreateTaskInputSchema` AND the follow-up params:
  ```ts
  /** UI locale for reply language (LANG-1). */
  locale: z.string().min(2).max(5).optional(),
  /** Compact composer text before slash expansion (CMD-4). */
  goalSource: z.string().optional(),
  ```
- [ ] **Step 2: Failing engine test** — prompt contains the reply-language line when
  locale is set and non-English; absent for `en`/undefined:
  ```ts
  it("adds a reply-language instruction for non-English locales", () => {
    const prompt = buildPromptForTest({ ...task, locale: "de" });
    expect(prompt).toContain("Reply to the user in German");
  });
  it("omits the language line for en", () => {
    expect(buildPromptForTest({ ...task, locale: "en" })).not.toContain("Reply to the user in");
  });
  ```
  (If prompt assembly isn't directly testable, extract the promptParts build into a
  pure `buildRunPrompt(task, opts)` in session.ts and test that — preferred.)
- [ ] **Step 3: Implement.** `types.ts`: `locale?: string` on Task. `session.ts`: add
  ONE part after the `Task goal:` line:
  ```ts
  const LANGUAGE_NAMES: Record<string, string> = {
    en: "English", es: "Spanish", fr: "French", de: "German",
    pt: "Portuguese", ja: "Japanese", zh: "Chinese (Simplified)",
  };
  // in promptParts, after the task-goal entry:
  task.locale && task.locale !== "en" && LANGUAGE_NAMES[task.locale]
    ? `Reply to the user in ${LANGUAGE_NAMES[task.locale]} unless they clearly write in a different language.`
    : "",
  ```
  Gateway: pass `locale` and `goalSource` through the create/follow-up path into the
  Task handed to the engine (locale) and into the initial user-message event payload
  (goalSource — find where the user turn event is appended; attach
  `goalSource` to that payload so the renderer can show the compact form). Prefer
  pass-through over persistence; add a DB column ONLY if the runner path genuinely
  requires re-reading it (it shouldn't for locale).
- [ ] **Step 4:** Gates (shared + gateway + engine + desktop typecheck). PASS.
- [ ] **Step 5:** `git commit -m "feat(schema): locale + goalSource on task create/follow-up; engine reply-language line"`

---

## Wave 2 — Hear the media (ONE worker)

### Task 2.1: Audio artifacts are playable media (AV-4)

**Files:**
- Modify: `packages/gateway/src/services/workspace-deliverables.ts:90`
- Modify: `apps/desktop/src/renderer/lib/api.ts` (~line 396)
- Modify: `apps/desktop/src/renderer/lib/deliverables.ts`
- Modify: `apps/desktop/src/renderer/components/task-stream.tsx` (`ArtifactMedia`
  ~1218-1344), `components/views/artifacts-view.tsx` (~100-141),
  `components/media-lightbox.tsx` (~205-230),
  `components/views/task-workspace-parts.tsx` (DeliverableRow icon ~151-201)
- Test: colocated renderer lib tests + gateway deliverables test

- [ ] **Step 1: Failing tests.** Gateway: `guessArtifactKind("a.mp3")` → `"media"`
  (+ wav/m4a/aac/ogg/flac). Renderer:
  ```ts
  expect(isAudioPath("x/track.mp3")).toBe(true);
  expect(isAudioPath("x/clip.mp4")).toBe(false);
  expect(isMediaPath("x/track.wav")).toBe(true);
  ```
- [ ] **Step 2:** Run both suites → FAIL.
- [ ] **Step 3: Implement.**
  Gateway regex: `/\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|mp3|wav|m4a|aac|ogg|flac)$/i`.
  api.ts, next to VIDEO_EXTENSIONS:
  ```ts
  /** Extensions the asset bridge can inline as <audio> playback. */
  export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "ogg", "flac"];
  export function isAudioPath(p: string | null | undefined): boolean {
    if (!p) return false;
    const ext = p.split(".").pop()?.toLowerCase() ?? "";
    return AUDIO_EXTENSIONS.includes(ext);
  }
  ```
  and include `isAudioPath(p)` in `isMediaPath`. `deliverables.ts`: add
  `isAudio: boolean` to `DeliverableRow` + populate. Confirm the gateway asset mime
  map covers all six extensions (Task 1.1 unified it) and the asset protocol serves
  them (`asset-protocol.ts` size gates are extension-agnostic — just verify).
  Renderer surfaces — audio branch BEFORE the failed-preview fallback:
  ```tsx
  {isAudio ? (
    <audio src={src} controls preload="metadata" className="w-full" />
  ) : /* existing video/image branches */}
  ```
  in `ArtifactMedia` (task-stream), artifacts-view preview, and the lightbox
  (`props.audio` new flag mirroring `props.video`). DeliverableRow: `Music` icon
  (lucide) for audio rows.
- [ ] **Step 4:** Gates. PASS.
- [ ] **Step 5:** `git commit -m "feat(media): audio artifacts classify + play inline (chat, rail, lightbox)"`

### Task 2.2: /video asks for sound — or says it can't (AV-2)

**Files:** all 7 locale JSONs (`slash.videoGoal`, `slash.videoDesc`),
`apps/desktop/EXPERIENCE_IMPROVEMENTS.md` (AV-1/AV-2 marks)

- [ ] **Step 1:** Branch on Task 0.2's verdict:
  - CLI CAN produce audio (with-ask smoke had an audio stream): update
    `slash.videoGoal` in ALL 7 locales to include the audio ask, e.g. en:
    "Generate a short polished teaser video for this project and save it under
    ./artifacts as an mp4 with a fitting music bed or ambient audio track, plus a
    short caption file." Keep `slash.videoDesc` time expectation.
  - CLI CANNOT: leave videoGoal, and make `slash.videoDesc` honest, e.g. en:
    "Cinematic teaser video, silent (takes a minute or two)" — all 7 locales.
- [ ] **Step 2:** Desktop gates (i18n parity + proseKeys). PASS.
- [ ] **Step 3:** Mark AV-1 + AV-2 in EXPERIENCE_IMPROVEMENTS.md with the smoke
  evidence. `git commit -m "feat(slash): /video requests an audio track (smoke-proven)"`
  (or `fix(copy): honest silent-video description` on the other branch).

### Task 2.3: Player polish — posters, preload, volume memory (AV-3)

**Files:**
- Create: `apps/desktop/src/renderer/hooks/use-video-poster.ts`
- Create: `apps/desktop/src/renderer/lib/media-src.ts`
- Modify: `task-stream.tsx` (video ~1284), `artifacts-view.tsx` (~103),
  `media-lightbox.tsx` (~210), `task-workspace-parts.tsx` (video rail rows)
- Test: `apps/desktop/src/renderer/lib/media-src.test.ts`

- [ ] **Step 1: Failing test** for the pure helper:
  ```ts
  import { videoDisplaySrc } from "@/lib/media-src";
  it("appends a first-frame fragment to plain srcs", () => {
    expect(videoDisplaySrc("grokdesk-asset://local/abc")).toBe("grokdesk-asset://local/abc#t=0.001");
  });
  it("does not double-append or touch data urls", () => {
    expect(videoDisplaySrc("x#t=0.001")).toBe("x#t=0.001");
    expect(videoDisplaySrc("data:video/mp4;base64,AAAA")).toBe("data:video/mp4;base64,AAAA");
  });
  ```
- [ ] **Step 2:** FAIL → implement:
  ```ts
  /** First-frame fragment so <video> paints a poster without a poster file. */
  export function videoDisplaySrc(src: string): string {
    if (!src || src.startsWith("data:") || src.includes("#t=")) return src;
    return `${src}#t=0.001`;
  }
  ```
- [ ] **Step 3:** Wire `videoDisplaySrc(src)` + `preload="metadata"` on ALL `<video>`
  elements (three sites). Lightbox volume memory:
  ```tsx
  const VOLUME_KEY = "grokdesk.mediaVolume.v1";
  // onVolumeChange: localStorage.setItem(VOLUME_KEY, JSON.stringify({v: el.volume, m: el.muted}))
  // ref callback on mount: restore both if present
  ```
  Rail video thumbnails in `use-video-poster.ts`: given a src, draw the seeked first
  frame of a detached `<video>` to a canvas → dataURL, cache in a module-level
  `Map<string, string>`; return `poster | null`. Use it in DeliverableRow to give
  video rows the same full-width `aspect-video object-cover` thumb images already get
  (render the dataURL in an `<img>`).
- [ ] **Step 4:** Gates. PASS.
- [ ] **Step 5:** `git commit -m "feat(media): video posters, metadata preload, volume memory"`

---

## Wave 3 — Slash: expand at send time (ONE worker, renderer-only)

### Task 3.1: `armedSlashCommand` + `expandSlashGoal` (CMD-1 core)

**Files:**
- Modify: `apps/desktop/src/renderer/lib/composer-input.ts`
- Test: `apps/desktop/src/renderer/lib/composer-input.test.ts`

- [ ] **Step 1: Failing tests** (impl uses `String.match`, never the regex `exec`
  method — see rule 5):
  ```ts
  describe("armedSlashCommand / expandSlashGoal", () => {
    const tr = (k: string, p?: Record<string, string>) =>
      k === "slash.argsTopic" ? `Topic: ${p?.args}` : `[${k}]`;
    it("arms on a leading fill token", () => {
      expect(armedSlashCommand("/research grok pricing")?.command.id).toBe("research");
      expect(armedSlashCommand("/research grok pricing")?.args).toBe("grok pricing");
    });
    it("does not arm on action tokens, paths, unknown tokens, or mid-text", () => {
      expect(armedSlashCommand("/folder")).toBeNull();
      expect(armedSlashCommand("/Users/maceo/notes")).toBeNull();
      expect(armedSlashCommand("/nope hi")).toBeNull();
      expect(armedSlashCommand("see /research")).toBeNull();
    });
    it("expands template + weaves args at send time", () => {
      const r = expandSlashGoal("/research grok pricing", tr);
      expect(r.goal).toBe("[slash.researchGoal]\n\nTopic: grok pricing");
      expect(r.command?.id).toBe("research");
      expect(r.source).toBe("/research grok pricing");
    });
    it("expands a bare token to the template alone", () => {
      expect(expandSlashGoal("/brief", tr).goal).toBe("[slash.briefGoal]");
    });
    it("passes non-command text through unchanged", () => {
      const r = expandSlashGoal("plain question", tr);
      expect(r.goal).toBe("plain question");
      expect(r.command).toBeNull();
    });
    it("captures multiline args", () => {
      const r = expandSlashGoal("/brief launch plan\nfor Q3", tr);
      expect(r.goal).toContain("Topic: launch plan\nfor Q3");
    });
  });
  ```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** in composer-input.ts:
  ```ts
  export type ArmedSlash = { command: SlashCommand; args: string };

  /** The fill command a composer text is armed with (leading exact token). */
  export function armedSlashCommand(
    text: string,
    cmds: SlashCommand[] = SLASH_COMMANDS,
  ): ArmedSlash | null {
    const m = text.match(/^\/([a-zA-Z0-9_-]+)(?:\s([\s\S]*))?$/);
    if (!m) return null;
    const token = (m[1] ?? "").toLowerCase();
    const cmd = cmds.find(
      (c) => (c.token === token || c.id === token) && c.kind === "fill",
    );
    if (!cmd?.goalKey) return null;
    return { command: cmd, args: (m[2] ?? "").trim() };
  }

  export type ExpandedGoal = {
    goal: string;
    command: SlashCommand | null;
    /** What the user actually typed (send as goalSource when a command expanded). */
    source: string;
  };

  /** Send-time swap: leading fill token → full localized template (+ woven args). */
  export function expandSlashGoal(
    text: string,
    translate: (key: string, params?: Record<string, string>) => string,
    cmds: SlashCommand[] = SLASH_COMMANDS,
  ): ExpandedGoal {
    const armed = armedSlashCommand(text, cmds);
    if (!armed) return { goal: text, command: null, source: text };
    const template = translate(armed.command.goalKey!);
    const goal = armed.args
      ? weaveSlashArgs(template, armed.args, translate("slash.argsTopic", { args: armed.args }))
      : template;
    return { goal, command: armed.command, source: text };
  }
  ```
- [ ] **Step 4:** PASS. `git commit -m "feat(slash): armedSlashCommand + expandSlashGoal (send-time expansion core)"`

### Task 3.2: Menu selection completes the token; effort follows recognition (CMD-1 UI + CMD-3)

**Files:**
- Modify: `composer-input.ts` (add `armedEffortTransition`), both composers'
  `applySlash` (`home-view.tsx:392-446`, `task-workspace-view.tsx:947-1000`)
- Test: `composer-input.test.ts`

- [ ] **Step 1: Failing tests** for the pure effort state machine:
  ```ts
  describe("armedEffortTransition", () => {
    it("escalates once and remembers the prior effort", () => {
      const r = armedEffortTransition({ saved: null, applied: null }, "normal", "heavy");
      expect(r.set).toBe("heavy");
      expect(r.state).toEqual({ saved: "normal", applied: "heavy" });
    });
    it("restores on disarm only when untouched", () => {
      const armed = { saved: "normal", applied: "heavy" } as const;
      expect(armedEffortTransition(armed, "heavy", null).set).toBe("normal");
      expect(armedEffortTransition(armed, "max", null).set).toBeUndefined(); // user changed it
    });
    it("is a no-op while armed state is unchanged", () => {
      const r = armedEffortTransition({ saved: "normal", applied: "heavy" }, "heavy", "heavy");
      expect(r.set).toBeUndefined();
    });
  });
  ```
- [ ] **Step 2:** FAIL → implement:
  ```ts
  export type ArmedEffortState = { saved: EffortLevel | null; applied: EffortLevel | null };
  export function armedEffortTransition(
    state: ArmedEffortState,
    currentEffort: EffortLevel,
    armedEffort: EffortLevel | null,
  ): { state: ArmedEffortState; set?: EffortLevel } {
    if (armedEffort) {
      if (state.applied === armedEffort) return { state };
      return { state: { saved: currentEffort, applied: armedEffort }, set: armedEffort };
    }
    if (state.applied) {
      const set = currentEffort === state.applied && state.saved ? state.saved : undefined;
      return { state: { saved: null, applied: null }, set };
    }
    return { state };
  }
  ```
- [ ] **Step 3: Rewire both composers.** In `applySlash`/`applySlashFollow`, the fill
  branch becomes token completion (NO template fill, NO direct onEffort call):
  ```ts
  if (cmd.kind === "fill") {
    const r = applySlashCommand(text, slash, `/${cmd.token} `);
    setText(r.text); setCursor(r.cursor);
    if (cmd.token === "organize" && !props.root) props.onPickRoot?.();
    return;
  }
  ```
  (Keep the SC-2 /organize folder-picker behavior; action commands unchanged.)
  Add the recognition-driven effort effect in BOTH composers:
  ```tsx
  const armed = useMemo(() => armedSlashCommand(goalText), [goalText]);
  const armedEffortRef = useRef<ArmedEffortState>({ saved: null, applied: null });
  useEffect(() => {
    const r = armedEffortTransition(armedEffortRef.current, effort, armed?.command.effort ?? null);
    armedEffortRef.current = r.state;
    if (r.set) onEffort(r.set);
  }, [armed?.command.id]);
  ```
- [ ] **Step 4:** Update the ~3 existing tests asserting template-fill-at-select
  (`composer-input.test.ts:176-203`) to the new completion semantics. Gates PASS.
- [ ] **Step 5:** `git commit -m "feat(slash): selection completes token; effort follows recognition"`

### Task 3.3: Armed-command chip (CMD-2)

**Files:**
- Create: `apps/desktop/src/renderer/components/armed-command-chip.tsx`
- Modify: both composers to render it; all 7 locale JSONs
- Test: colocated `armed-command-chip.test.tsx` ONLY if a component-test pattern
  already exists nearby; otherwise pure-logic tests suffice (chip is presentational)

- [ ] **Step 1: Component** (opaque surface, no backdrop-blur):
  ```tsx
  export function ArmedCommandChip(props: {
    label: string;       // t(cmd.labelKey)
    effect: string;      // t("slash.armedEffect.<id>") — one line, see keys below
    escalates: boolean;  // cmd.effort != null
    onClear: () => void;
  }) { /* pill: Sparkles icon, label, muted effect text, optional Zap glyph
         when escalates, X button (aria-label t("slash.armedClear")) */ }
  ```
  New keys ×7 locales: `slash.armedEffect.brief/research/organize/image/video`
  (one-line "what happens on send", e.g. research en: "Deep research with sources ·
  runs at heavy effort"), `slash.armedClear` ("Remove command"),
  `slash.expandsOnSend` ("Expands when you send").
- [ ] **Step 2:** Render above the textarea in BOTH composers when
  `armed != null` (from Task 3.2's memo); `onClear` strips the leading
  `/token ` prefix from the text (keep any args as plain text).
- [ ] **Step 3:** Gates (i18n parity!). PASS.
- [ ] **Step 4:** `git commit -m "feat(slash): armed-command chip shows what will run"`

### Task 3.4: Send paths expand; sent bubble shows the compact form (CMD-1 send + CMD-4)

**Files:**
- Modify: `apps/desktop/src/renderer/lib/create-task-optimistic.ts`
  (`buildCreateTaskParams` ~24-52, `buildFollowUpTaskParams` ~129-172)
- Modify: `task-workspace-view.tsx` follow-up submit (~1705-1785) + queue drain
- Modify: the user-turn renderer (`components/conversation/conversation-turn.tsx`)
- Test: `create-task-optimistic.test.ts` (extend existing)

- [ ] **Step 1: Failing tests:**
  ```ts
  it("expands a slash goal at param-build time and carries goalSource", () => {
    const p = buildCreateTaskParams({ ...baseForm, goal: "/brief launch" });
    expect(p.goal).not.toContain("/brief");
    expect(p.goalSource).toBe("/brief launch");
  });
  it("sends plain goals verbatim without goalSource", () => {
    const p = buildCreateTaskParams({ ...baseForm, goal: "hello" });
    expect(p.goal).toBe("hello");
    expect(p.goalSource).toBeUndefined();
  });
  ```
- [ ] **Step 2:** FAIL → implement: both param builders call
  `expandSlashGoal(goal, t)` (import `t` from `@/i18n/active`); when
  `r.command != null`, set `goal: r.goal, goalSource: r.source`. Queue drain: verify
  the drained text flows through `buildFollowUpTaskParams` (it should — if any drain
  path bypasses it, route it through). Also send `locale: getActiveLocale()` on both
  builders (completes LANG-1 renderer side).
- [ ] **Step 3: Bubble.** In the user-turn component: when the message payload has
  `goalSource`, render `goalSource` as the bubble text (mono-styled leading
  `/token`), plus a quiet disclosure `t("workspace.viewFullPrompt")` ("View full
  prompt") that expands the full sent goal (existing Collapsible/details pattern).
  New key ×7. If the payload lacks goalSource (old tasks), render as today.
- [ ] **Step 4:** Gates. Manual check: `pnpm dev`, send `/brief launch` → bubble shows
  compact, task runs with the template, chip cleared.
- [ ] **Step 5:** `git commit -m "feat(slash): expand at send; compact bubble with full-prompt disclosure"`

---

## Wave 4 — Principal assets (ONE worker)

### Task 4.1: Hero + principal + "All files (N)" rail (ASSET-1)

**Files:**
- Modify: `apps/desktop/src/renderer/lib/deliverables.ts` (+ its test)
- Modify: `task-workspace-view.tsx` Deliverables section,
  `task-workspace-parts.tsx` (DeliverableRow)
- Locale keys ×7: `workspace.allFiles` ("All files ({n})"),
  `workspace.heroDeliverable` (aria)

- [ ] **Step 1: Failing tests** for a pure splitter:
  ```ts
  it("picks newest media as hero, next 4 as principal, rest as overflow", () => {
    const rows = [img1, txt1, vid2 /* newest media */, file3, file4, file5, file6];
    const g = groupDeliverables(rows);
    expect(g.hero?.key).toBe(vid2.key);
    expect(g.principal.length).toBeLessThanOrEqual(4);
    expect(g.overflow.length).toBe(rows.length - 1 - g.principal.length);
  });
  it("no media → no hero, principal from the top", () => { /* hero null */ });
  ```
- [ ] **Step 2:** FAIL → implement in deliverables.ts:
  ```ts
  export type DeliverableGroups = {
    hero: DeliverableRow | null;
    principal: DeliverableRow[];
    overflow: DeliverableRow[];
  };
  export function groupDeliverables(rows: DeliverableRow[]): DeliverableGroups {
    const rank = (r: DeliverableRow) =>
      r.isImage || r.isVideo || r.isAudio ? 0 : r.title.match(/\.(md|txt|pdf)$/i) ? 1 : 2;
    const sorted = [...rows].sort((a, b) => rank(a) - rank(b)); // rows arrive newest-first per kind
    const hero = sorted.find((r) => r.isImage || r.isVideo) ?? null;
    const rest = sorted.filter((r) => r !== hero);
    return { hero, principal: rest.slice(0, 4), overflow: rest.slice(4) };
  }
  ```
  Rail render: hero card = full-width media preview (image thumb / Task 2.3 video
  poster, click → lightbox) + caption `artifactKindLabel · formatBytes(sizeBytes)`;
  add `formatBytes` to `lib/format.ts` (KB/MB, 1 decimal, tests); principal rows as
  today; overflow inside a `<details>`-style collapse labeled
  `t("workspace.allFiles", {n})`.
- [ ] **Step 3:** Gates. PASS. `git commit -m "feat(deliverables): hero + principal + collapsed overflow"`

### Task 4.2: Turn-end deliverables digest in chat (ASSET-3)

**Files:** `task-stream.tsx` (artifact folding ~306-324 + a new digest block renderer);
keys ×7: `stream.moreFiles` ("{n} more files"), `stream.openDeliverables`
("Open deliverables")

- [ ] **Step 1:** Extend the existing collapse logic: when a turn ends (task not live
  or a later user/assistant message exists), fold that turn's NON-media artifact
  blocks into one digest block: newest media of the turn inline (playable, existing
  ArtifactMedia) + `{n} more files` + an "Open deliverables" button that calls the
  existing rail-focus handler (find how the header toggles the rail; reuse).
  Implement the grouping as a pure function over blocks
  (`foldTurnArtifacts(blocks): blocks`) in `task-stream` or a lib file WITH unit
  tests (blocks in → digest out; media stays inline; live turn unchanged).
- [ ] **Step 2:** Gates. `git commit -m "feat(stream): turn-end deliverables digest card"`

### Task 4.3: Raise media harvest cap + surface skips (ASSET-4)

**Files:** `packages/gateway/src/services/workspace-deliverables.ts`,
`runner.ts` harvest site; gateway tests

- [ ] **Step 1: Failing tests:** a 30 MB (mock-stat) mp4 is harvested; a 30 MB txt is
  not; skipped files are counted:
  `listDeliverableFiles` returns `{ files, skipped: { oversize: n, overflow: m } }`.
- [ ] **Step 2:** Implement: media extensions (reuse the Task 2.1 regex) get a
  200 MB ceiling, others keep 25 MB; count oversize/overflow skips; runner appends
  ONE step event when `skipped.oversize + skipped.overflow > 0`:
  payload message `Skipped {n} file(s) — over size limit or file cap` (this is a
  gateway-side English string rendered as step text — mirror how other runner step
  messages are produced; if they use i18n keys resolved renderer-side, add key
  `stream.harvestSkipped` ×7 instead).
- [ ] **Step 3:** Gates (Node 20). `git commit -m "feat(gateway): media harvest to 200MB, surface skipped files"`

---

## Wave 5 — Live progress (ONE worker, renderer-only)

### Task 5.1: Elapsed time (PROG-1)

**Files:**
- Create: `apps/desktop/src/renderer/hooks/use-elapsed.ts` + `lib/elapsed.ts`
- Modify: `task-stream.tsx` WorkingIndicator (~1006-1048), `home-view.tsx` running
  banner (~639-679)
- Test: `lib/elapsed.test.ts`

- [ ] **Step 1: Failing tests:**
  ```ts
  expect(formatElapsed(0)).toBe("0:00");
  expect(formatElapsed(65)).toBe("1:05");
  expect(formatElapsed(3600)).toBe("60:00");
  expect(elapsedSince("2026-07-17T00:00:00Z", Date.parse("2026-07-17T00:01:05Z"))).toBe(65);
  ```
- [ ] **Step 2:** Implement pure fns; `useElapsedSeconds(startIso, active)` hook wraps
  them with a 1s interval (cleared when `!active`). Start time: the task's current
  attempt `startedAt` if the task payload exposes it, else `task.updatedAt` at the
  moment status became running — inspect the TaskRecord shape in packages/shared and
  use the best available; document the choice in a code comment stating the
  constraint (attempt start not exposed ⇒ updatedAt approximation).
- [ ] **Step 3:** Render: WorkingIndicator gains a right-aligned `tabular-nums` m:ss;
  home running banner appends `· {m:ss}`. Reduced-motion safe (plain text).
- [ ] **Step 4:** Gates. `git commit -m "feat(progress): elapsed time on working indicator + running banner"`

### Task 5.2: Media-aware progress card (PROG-2)

**Files:**
- Create: `apps/desktop/src/renderer/lib/media-progress.ts` (+ test)
- Modify: `task-stream.tsx` WorkingIndicator branch
- Keys ×7: `progress.renderingVideo` ("Rendering video — usually 1–2 min"),
  `progress.renderingImage` ("Creating image — under a minute")

- [ ] **Step 1: Failing tests:**
  ```ts
  expect(mediaToolKind("image_to_video")).toBe("video");
  expect(mediaToolKind("reference_to_video")).toBe("video");
  expect(mediaToolKind("generate_image")).toBe("image");
  expect(mediaToolKind("shell")).toBeNull();
  expect(mediaToolKind(undefined)).toBeNull();
  ```
- [ ] **Step 2:** Implement:
  ```ts
  export function mediaToolKind(tool: string | null | undefined): "video" | "image" | null {
    if (!tool) return null;
    const t = tool.toLowerCase();
    if (t.includes("video")) return "video";
    if (t.includes("image") || t.includes("imagine")) return "image";
    return null;
  }
  ```
- [ ] **Step 3:** In the stream: when the newest RUNNING ToolAction's tool name maps
  to a media kind, WorkingIndicator renders the media card INSTEAD of dots:
  `aspect-video` shimmer surface (existing skeleton/pulse tokens; CSS only) + the
  progress key + Task 5.1 elapsed. When the artifact event for that turn arrives,
  the card unmounts (the real media block renders with the existing completion
  sweep). Exactly ONE live signal: the card replaces, never joins, the dots (CH-4
  discipline).
- [ ] **Step 4:** Gates. `git commit -m "feat(progress): media rendering card with elapsed + eta copy"`

### Task 5.3 + 5.4: Concrete tool detail persists; header carries activity (PROG-3/4)

**Files:** `task-stream.tsx` (~289-294, 1014-1046), `task-workspace-view.tsx` header
StatusPill area; keys ×7: none new (reuses humanized labels)

- [ ] **Step 1 (PROG-3):** While ANY tool row is running, WorkingIndicator must show
  that tool's humanized label + detail — never the rotating generic lines; latest
  `run_progress` message renders as the indicator caption when present. Trace
  `hasLiveProgress` (~289) to confirm the message text is actually displayed; wire it
  if it only flips a boolean.
- [ ] **Step 2 (PROG-4):** Workspace header: beside the StatusPill, a muted truncated
  caption with the live activity summary (the activity store's `liveSummary` already
  built at ~225). One line, `max-w-[240px] truncate`, no animation.
- [ ] **Step 3:** Gates. `git commit -m "feat(progress): persistent tool detail + header activity caption"`

---

## Wave 6 — Language (ONE worker)

### Task 6.1: Dictation speaks the UI language (LANG-2)

**Files:** `hooks/use-dictation.ts:96`, callers `home-view.tsx:220`,
`task-workspace-view.tsx:353`; check the main-process dictation handler forwards
`language` to the STT request (grep `dictation.start` in `src/main/`)

- [ ] **Step 1:** In use-dictation.ts, default from the active locale instead of "en":
  ```ts
  import { getActiveLocale } from "@/i18n/active";
  // in start():
  language: opts.language ?? getActiveLocale(),
  ```
  (STT expects short codes — "en" today; LocaleCode values are short codes. Verify
  the main handler passes it through untouched; if it maps/validates, extend the map.)
- [ ] **Step 2:** Unit test: mock `window.grokdesk.dictation.start`, set active locale
  `es`, call start, expect `{ language: "es" }` (there are existing hook tests —
  follow their pattern; if none, test via a small extracted
  `dictationLanguage(optsLang, activeLocale)` pure fn).
- [ ] **Step 3:** Gates. `git commit -m "fix(dictation): follow the active UI locale"`

### Task 6.2: Intl calls use the app locale (LANG-3)

**Files:** `lib/format.ts` (18-21, 40, 52), `shell/app-sidebar.tsx`,
`security-update-banner.tsx`, `views/settings/license-tab.tsx`;
`i18n/active.ts` (+ test)

- [ ] **Step 1:** Add to active.ts:
  ```ts
  /** BCP-47 tag for Intl.* — zh renders zh-CN per context.tsx convention. */
  export function getActiveIntlLocale(): string {
    const l = getActiveLocale();
    return l === "zh" ? "zh-CN" : l;
  }
  ```
  Test: active locale zh → "zh-CN"; de → "de".
- [ ] **Step 2:** Replace every `toLocaleDateString(undefined, …)` /
  `toLocaleString(undefined, …)` in the four files with
  `…(getActiveIntlLocale(), …)`. Grep the whole renderer for `toLocale` to catch
  strays; fix all.
- [ ] **Step 3:** Gates. `git commit -m "fix(i18n): dates and numbers follow the app locale"`

### Task 6.3: Tray + native dialogs localize (LANG-4)

**Files:**
- Create: `apps/desktop/src/main/main-i18n.ts`
- Modify: `src/main/tray.ts` (37-108, 115), `src/main/index.ts` (559, 846),
  preload (`src/preload/index.ts`) + `context.tsx` (push locale on change)
- Test: `src/main/main-i18n.test.ts` (follow the pattern of other src/main tests; if
  none run in vitest node config, colocate under the node test project used by
  `tsconfig.node.json`)

- [ ] **Step 1:** `main-i18n.ts` — a dependency-free mini catalog:
  ```ts
  export type MainLocale = "en" | "es" | "fr" | "de" | "pt" | "ja" | "zh";
  const LOCALES: readonly MainLocale[] = ["en", "es", "fr", "de", "pt", "ja", "zh"];
  const M: Record<string, Record<MainLocale, string>> = {
    trayOpen:      { en: "Open Grok Desk", de: "Grok Desk öffnen", /* …all 7 */ },
    trayRemote:    { en: "Remote access…", /* … */ },
    trayPauseAll:  { en: "Pause all tasks", /* … */ },
    trayResumeAll: { en: "Resume all tasks", /* … */ },
    trayStopRemote:{ en: "Stop remote control", /* … */ },
    trayQuit:      { en: "Quit", /* … */ },
    engineReady:   { en: "engine ready", /* … */ },
    engineStarting:{ en: "engine starting", /* … */ },
    engineReconnecting: { en: "engine reconnecting", /* … */ },
    engineStopped: { en: "engine stopped", /* … */ },
    engineIdle:    { en: "engine idle", /* … */ },
    dialogImportKey: { en: "Import Grok Desk product key", /* … */ },
    dialogStartFailed: { en: "Grok Desk failed to start", /* … */ },
  };
  let current: MainLocale = "en";
  export function setMainLocale(l: string): void {
    if ((LOCALES as readonly string[]).includes(l)) current = l as MainLocale;
  }
  export function mt(key: keyof typeof M): string {
    return M[key]?.[current] ?? M[key]?.en ?? String(key);
  }
  ```
  (Write real translations for all 13 keys × 7 — ja/zh must not be English.)
  Test: `setMainLocale("de"); expect(mt("trayQuit")).toBe("Beenden")` + fallback for
  unknown locale.
- [ ] **Step 2:** Wire: tray.ts labels + tooltip through `mt()`; rebuild the tray menu
  when locale changes. index.ts dialog strings through `mt()`. New IPC:
  preload exposes `app.setLocale(locale)` → ipcMain handler calls `setMainLocale` +
  tray rebuild; `context.tsx` effect (where `document.documentElement.lang` is set,
  ~81-83) also calls `window.grokdesk?.app?.setLocale?.(locale)`.
- [ ] **Step 3:** Gates + manual: switch to de in Settings → tray menu German without
  restart. `git commit -m "feat(i18n): tray and native dialogs follow the app locale"`

### Task 6.4: String stragglers + locale-list constant (LANG-5 + LANG-6)

**Files:** `license-activation-screen.tsx:154`, `ui/toast.tsx` (aria-labels),
`context-meter.tsx` (aria-label), `ui/markdown.tsx` ("Remote images blocked");
`i18n/catalog.ts` + `i18n/i18n.test.ts`

- [ ] **Step 1:** Route the four hardcoded strings through `t()` with new keys ×7
  (`license.productKeyPlaceholder`, `toast.regionLabel`, `toast.dismiss`,
  `meter.contextUsage`, `markdown.remoteImagesBlocked`). Components without hook
  access use `t` from `@/i18n/active`.
- [ ] **Step 2 (LANG-6):** Export `export const ALL_LOCALES = Object.keys(CATALOG) as
  LocaleCode[]` from catalog.ts; make i18n.test.ts iterate/assert from `ALL_LOCALES`
  and `LOCALE_META` instead of hardcoded arrays/counts, so adding a locale = one
  import + one META entry + one JSON. Do NOT add new locales this round.
- [ ] **Step 3:** Gates. `git commit -m "fix(i18n): straggler strings + single locale list"`

### Task 6.5: LANG-1 live smoke (worker, no code)

- [ ] With UI locale de (set in Settings or force `locale: "de"` param), create a task
  "summarize the files in this folder" against a scratch folder with 2 text files;
  confirm the reply is German. Repeat once with ja. Record both in
  EXPERIENCE_IMPROVEMENTS.md LANG-1 mark; commit doc:
  `docs: LANG-1 smoke evidence (de/ja)`.

---

## Wave 7 — Chat polish round 3 (TWO workers in parallel, disjoint files)

### Task 7A (worker A): CHAT-1, CHAT-3, CHAT-6, CHAT-7

**Files:** `components/conversation/conversation-turn.tsx`,
`components/conversation/citation-cards.tsx`, `ui/markdown.tsx`; keys ×7

- [ ] **CHAT-1:** Assistant-turn hover/focus action row: Copy (writes the turn's full
  markdown via `navigator.clipboard.writeText`; success toast) + Retry (enabled when
  the task is terminal/failed; calls the existing follow-up/re-run handler with the
  prior user message — trace what the failed-state retry currently uses and reuse
  it). Keys: `turn.copy`, `turn.copied`, `turn.retry` ×7. Keyboard reachable
  (`focus-within:opacity-100`, not hover-only — SH-8 lesson).
- [ ] **CHAT-3:** `+{n} more` (citation-cards.tsx:36-40) becomes a button toggling
  full list; key `citations.showAll` ("Show all {n}") + `citations.showLess` ×7.
- [ ] **CHAT-6:** Turn edit mode: explicit Save/Cancel buttons (Enter/Esc kbd hints);
  keys `turn.saveEdit`, `turn.cancelEdit` ×7.
- [ ] **CHAT-7:** Expand/collapse button in `.code-block-head` beside Copy when the
  block overflows the CH-9 max-height (measure via ref scrollHeight >
  clientHeight); keys `markdown.expand`, `markdown.collapse` ×7.
- [ ] Gates after each item; one commit per item
  (`feat(chat): assistant turn actions`, `feat(chat): expandable citations`,
  `feat(chat): explicit edit save/cancel`, `feat(chat): code block expand toggle`).

### Task 7B (worker B): CHAT-2, CHAT-4, CHAT-5 (+ CHAT-8 fixes if Task 0.3 found regressions)

**Files:** `task-workspace-view.tsx`, `task-stream.tsx`,
`components/conversation/queued-message-row.tsx`, `lib/` for pure helpers; keys ×7

- [ ] **CHAT-2:** Persist per-task follow-up drafts: new
  `lib/follow-up-drafts.ts` — `saveFollowUpDraft(taskId, {text, attachmentPaths})`,
  `loadFollowUpDraft(taskId)`, `clearFollowUpDraft(taskId)` over localStorage key
  `grokdesk.followUpDrafts.v1` (single JSON map, prune entries older than 14 days on
  load). Unit tests for the pure map ops. Wire: debounce-save on change (mirror
  home's `saveWorkSession` pattern, `home-view.tsx:506-518`), restore on mount,
  clear on successful send/enqueue.
- [ ] **CHAT-4:** Unread boundary: remember last-seen max event seq per task
  (module map or localStorage); on reopening a task with newer items, render one
  hairline separator `t("stream.newSince")` ("New") above the first unseen block;
  clear on next open. Pure helper + test:
  `unreadBoundarySeq(lastSeenSeq, blocks) -> seq | null`.
- [ ] **CHAT-5:** Queue delete → undo toast (stash the removed row, `t("queue.removed")`
  + `t("queue.undo")` action re-inserts at the same index; reuse the toast action
  pattern if one exists, else add an action button to the toast primitive ONLY if it
  already supports it — otherwise a 6s inline "Removed — Undo" row in place of the
  deleted row, no primitive surgery). Attachment validation on drain: before
  submitting a queued row, check the files still exist (find the existing fs-check
  RPC the composer uses for attachments; if none exists, use the prepare-asset
  failure as the signal); missing files mark the row `failed` with
  `t("queue.missingAttachment")` and a re-pick button (reuse the row's existing
  attachment picker).
- [ ] **CHAT-8:** Apply fixes for whichever of the three Task 0.3 verdicts said
  REGRESSED, per the original CH-2/CH-8/CH-12 specs in UI_IMPROVEMENTS.md.
- [ ] Gates after each item; one commit per item.

---

## Wave 8 — Closeout (orchestrator)

- [ ] Full gate run (desktop + gateway + shared + engine + build) on the final tree.
- [ ] Update every mark in `apps/desktop/EXPERIENCE_IMPROVEMENTS.md` (DONE/SKIPPED +
  evidence); check off this plan.
- [ ] `pnpm dev` visual QA script: send `/brief launch` (chip → compact bubble →
  disclosure), `/video` (progress card → hero video with poster + audible audio or
  honest silent copy), audio artifact playback, de locale end-to-end (UI + dictation
  + tray + reply language), unread separator, assistant copy/retry.
- [ ] Final commit of doc updates: `docs: close out chat experience level-up round`.

## Orchestration protocol

- One Grok worker per task (Waves 1-6 sequential; Wave 7 A∥B). Worker prompt =
  this plan's task section verbatim + the two doc paths + the non-negotiable rules.
- Orchestrator between tasks: `git diff` review (scope creep, i18n parity touch count
  = 7, no new deps, no em-dash in App.tsx), run gates, then dispatch the next task.
  A worker that fails gates twice gets its diff reverted and the task re-dispatched
  with the failure output.
- File-conflict law: only one worker may touch `task-stream.tsx` /
  `task-workspace-view.tsx` at a time (Waves 4, 5, 7B all touch them — strictly
  sequential; 7A's files are disjoint from 7B's).
