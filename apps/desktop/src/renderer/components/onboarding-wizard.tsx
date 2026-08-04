import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  FolderOpen,
  Loader2,
  LogIn,
  Megaphone,
  Search,
  Shield,
  Sparkles,
  Target,
  Wrench,
} from "lucide-react";
import type { AuthState } from "@grokdesk/shared";
import { BrandMark } from "@/components/brand-mark";
import { RuntimeInstallStep } from "@/components/runtime-install-step";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UpdateStatus } from "@grokdesk/shared";
import {
  ONBOARDING_INTENTS,
  ONBOARDING_SCENES,
  canAdvanceFromScene,
  canCompleteOnboarding,
  canNavigateToStep,
  intentToRolePackId,
  onboardingDaypart,
  starterGoalFallback,
  starterGoalKey,
  workspacePathParts,
  type OnboardingIntentId,
  type OnboardingSceneId,
} from "@/lib/onboarding";
import { useT } from "@/i18n";

type ApprovalMode = "strict" | "balanced" | "autopilot";
type TFn = ReturnType<typeof useT>;

export type OnboardingCompleteOpts = {
  enableRecommended: boolean;
  /** Soft seed after handoff — not shown as chat setup during launch */
  starterGoal: string;
  rolePackId: string | null;
  /** Explicit limited/demo mode when SuperGrok was skipped. */
  demoMode?: boolean;
};

const INTENT_ICONS: Record<string, typeof Sparkles> = {
  marketing: Megaphone,
  research: Search,
  ops: Wrench,
  "chief-of-staff": Briefcase,
  general: Target,
};

function onboardingSceneLabel(scene: OnboardingSceneId, t: TFn): string {
  const key: Record<OnboardingSceneId, string> = {
    welcome: "onboarding.stepWelcome",
    intent: "onboarding.intentLabel",
    workspace: "onboarding.stepWorkspace",
    policy: "onboarding.stepPolicy",
    account: "onboarding.stepAuth",
    ready: "onboarding.stepDone",
  };
  return t(key[scene]);
}

/**
 * Full-window first launch of the app.
 * This is NOT the main shell / chat area — it runs alone, then hands off.
 */
export function OnboardingWizard(props: {
  auth: (AuthState & { models?: string[] }) | null;
  root: string;
  onPickRoot: () => void;
  approvalMode: ApprovalMode;
  onApprovalMode: (mode: ApprovalMode) => void;
  rolePackId?: string | null;
  onRolePack?: (id: string | null) => void;
  onSignIn: () => void;
  onComplete: (opts: OnboardingCompleteOpts) => Promise<void>;
  starting?: boolean;
  /** Managed Grok runtime status — when missing, ready scene shows install step. */
  runtimeInstallStatus?: UpdateStatus | null;
  onRuntimeInstallCheck?: () => void;
  runtimeInstallPending?: boolean;
}) {
  const t = useT();
  const [sceneIndex, setSceneIndex] = useState(0);
  const [sceneKey, setSceneKey] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [pickedPulse, setPickedPulse] = useState(false);
  const [intent, setIntent] = useState<OnboardingIntentId | "general">(
    () => (props.rolePackId as OnboardingIntentId) ?? "general",
  );
  const prevRoot = useRef(props.root?.trim() ?? "");

  const scene: OnboardingSceneId = ONBOARDING_SCENES[sceneIndex] ?? "welcome";
  const signedIn = Boolean(props.auth?.signedIn);
  const hasWorkspaceRoot = Boolean(props.root?.trim());
  const gate = {
    hasWorkspaceRoot,
    hasApprovalMode: Boolean(props.approvalMode),
  };
  const canAdvance = canAdvanceFromScene(scene, gate);
  const canFinish = canCompleteOnboarding(gate);
  const busy = Boolean(props.starting || finishing || exiting);
  const pathParts = workspacePathParts(props.root);
  const daypart = onboardingDaypart(new Date().getHours());
  const daypartLabel = t(`onboarding.daypart.${daypart}`);
  const resolvedIntent: OnboardingIntentId =
    intent === "general" ? null : intent;
  const starterGoal = useMemo(() => {
    // Never seed a folder-specific goal when no folder was selected.
    if (!hasWorkspaceRoot) {
      const key = starterGoalKey(resolvedIntent);
      const translated = t(key);
      // If locale still says "this folder", fall back to non-folder wording.
      if (/this folder/i.test(translated) || translated === key) {
        return starterGoalFallback(resolvedIntent, { hasFolder: false });
      }
      return translated;
    }
    return t(starterGoalKey(resolvedIntent));
  }, [t, resolvedIntent, hasWorkspaceRoot]);
  const isFirst = sceneIndex === 0;
  const isLast = scene === "ready";

  useEffect(() => {
    props.onRolePack?.(intentToRolePackId(resolvedIntent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedIntent]);

  useEffect(() => {
    const prev = prevRoot.current;
    const next = props.root?.trim() ?? "";
    prevRoot.current = next;
    if (!next || prev === next) return;
    setPickedPulse(true);
    const tmr = window.setTimeout(() => setPickedPulse(false), 800);
    return () => window.clearTimeout(tmr);
  }, [props.root]);

  const goTo = (index: number) => {
    if (!canNavigateToStep(index, sceneIndex) || busy) return;
    setSceneIndex(index);
    setSceneKey((k) => k + 1);
  };

  const goNext = () => {
    if (!canAdvance || isLast) return;
    setSceneIndex((i) => Math.min(i + 1, ONBOARDING_SCENES.length - 1));
    setSceneKey((k) => k + 1);
  };

  const goBack = () => {
    if (isFirst) return;
    setSceneIndex((i) => Math.max(i - 1, 0));
    setSceneKey((k) => k + 1);
  };

  const finish = async () => {
    if (!canFinish || busy) return;
    setFinishing(true);
    setExiting(true);
    // Brief exit beat so handoff feels intentional
    await new Promise((r) => setTimeout(r, 420));
    try {
      await props.onComplete({
        enableRecommended: true,
        starterGoal,
        rolePackId: intentToRolePackId(resolvedIntent),
        // Skipping SuperGrok is an explicit demo/limited mode, not a broken session.
        demoMode: !signedIn,
      });
    } catch {
      setExiting(false);
      setFinishing(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement | null)?.isContentEditable
      ) {
        return;
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key !== "Enter" || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      if (isLast) void finish();
      else if (canAdvance) goNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, canAdvance, canFinish, busy, isLast]);

  return (
    <div
      className={cn(
        "first-launch fixed inset-0 z-[100] flex flex-col",
        exiting && "first-launch-exit",
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-launch-title"
      data-testid="first-launch"
    >
      <div className="first-launch-ambience" aria-hidden>
        <div className="first-launch-orb first-launch-orb-a" />
        <div className="first-launch-orb first-launch-orb-b" />
        <div className="first-launch-vignette" />
      </div>

      {/* macOS traffic-light drag region only — no app chrome */}
      <div className="titlebar-drag relative z-10 h-11 shrink-0" />

      <div className="titlebar-no-drag relative z-10 flex min-h-0 flex-1 flex-col">
        {/* Every scene is directly reachable; choices remain editable until launch. */}
        <div
          className="mx-auto w-full max-w-2xl px-6 pb-2 pt-1 sm:px-10"
          aria-label={t("onboarding.progressLabel")}
        >
          <div className="mb-2 flex items-center justify-between text-2xs text-muted-foreground">
            <span>{onboardingSceneLabel(scene, t)}</span>
            <span className="font-mono tabular-nums">
              {t("onboarding.stepOf", {
                current: sceneIndex + 1,
                total: ONBOARDING_SCENES.length,
              })}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {ONBOARDING_SCENES.map((id, i) => (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() => goTo(i)}
                className="group rounded-full py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
                aria-label={`${t("onboarding.stepOf", {
                  current: i + 1,
                  total: ONBOARDING_SCENES.length,
                })}: ${onboardingSceneLabel(id, t)}`}
                aria-current={i === sceneIndex ? "step" : undefined}
              >
                <span
                  className={cn(
                    "block h-1 rounded-full transition-[background-color,transform] duration-200 motion-reduce:transition-none",
                    i === sceneIndex
                      ? "scale-y-150 bg-primary"
                      : i < sceneIndex
                        ? "bg-primary/45 group-hover:bg-primary/70"
                        : "bg-white/[0.12] group-hover:bg-white/[0.24]",
                  )}
                />
              </button>
            ))}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto px-6 pb-10 pt-4 sm:px-10">
          <div
            key={sceneKey}
            className="first-launch-scene w-full max-w-xl"
          >
            {scene === "welcome" && (
              <SceneWelcome daypartLabel={daypartLabel} t={t} />
            )}
            {scene === "intent" && (
              <SceneIntent
                intent={intent}
                onIntent={setIntent}
                t={t}
              />
            )}
            {scene === "workspace" && (
              <SceneWorkspace
                root={props.root}
                pathParts={pathParts}
                hasRoot={hasWorkspaceRoot}
                pulse={pickedPulse}
                onPick={props.onPickRoot}
                t={t}
              />
            )}
            {scene === "policy" && (
              <SceneApproval
                mode={props.approvalMode}
                onMode={props.onApprovalMode}
                t={t}
              />
            )}
            {scene === "account" && (
              <SceneAccount
                signedIn={signedIn}
                name={
                  props.auth?.accountName ||
                  props.auth?.accountLabel ||
                  t("onboarding.authSignedInFallback")
                }
                onSignIn={props.onSignIn}
                t={t}
              />
            )}
            {scene === "ready" && (
              <SceneReady
                folderName={pathParts.name || props.root}
                hasRoot={hasWorkspaceRoot}
                signedIn={signedIn}
                intentLabel={intentLabel(intent, t)}
                approvalLabel={approvalModeLabel(props.approvalMode, t)}
                t={t}
                engineMissing={props.auth?.engineStatus === "missing"}
                runtimeInstallStatus={props.runtimeInstallStatus}
                onRuntimeInstallCheck={props.onRuntimeInstallCheck}
                runtimeInstallPending={props.runtimeInstallPending}
              />
            )}
          </div>
        </div>

        {/* Footer actions — midnight panel chrome */}
        <div className="relative z-10 flex shrink-0 items-center justify-between gap-3 border-t border-hairline bg-[hsl(var(--sidebar)/0.88)] px-6 py-4 backdrop-blur-md sm:px-10">
          <Button
            type="button"
            variant="ghost"
            disabled={isFirst || busy}
            onClick={goBack}
            className="text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            {t("onboarding.back")}
          </Button>

          <div className="flex items-center gap-2">
            {scene === "account" && !signedIn && (
              <Button type="button" variant="outline" onClick={goNext}>
                {t("onboarding.continueWithoutSignIn")}
              </Button>
            )}
            {scene === "workspace" && !hasWorkspaceRoot && (
              <Button type="button" variant="outline" onClick={goNext}>
                {t("onboarding.workspaceSkip")}
              </Button>
            )}
            {!isLast && (
              <Button
                type="button"
                size="lg"
                disabled={!canAdvance || busy}
                onClick={goNext}
                className="min-w-[8.5rem]"
              >
                {t("onboarding.next")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            {isLast && (
              <Button
                type="button"
                size="lg"
                disabled={!canFinish || busy}
                onClick={() => void finish()}
                className="min-w-[11rem] gap-2"
              >
                {busy ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("onboarding.enteringApp")}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" strokeWidth={1.75} />
                    {t("onboarding.enterApp")}
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SceneWelcome(props: {
  daypartLabel: string;
  t: TFn;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="first-launch-brand mb-8">
        <BrandMark className="h-16 w-16 sm:h-[4.5rem] sm:w-[4.5rem]" />
      </div>
      {/* Metadata-style eyebrow — ice scarce brand cue (landing parity) */}
      <p className="font-mono text-2xs font-medium uppercase tracking-[0.16em] text-primary/90">
        {props.daypartLabel}
      </p>
      <h1
        id="first-launch-title"
        className="mt-3 max-w-md text-balance text-4xl font-semibold leading-tight tracking-display text-foreground"
      >
        {props.t("onboarding.launchWelcomeTitle")}
      </h1>
      <p className="mt-4 max-w-sm text-md leading-relaxed text-muted-foreground">
        {props.t("onboarding.launchWelcomeBody")}
      </p>
    </div>
  );
}

function SceneIntent(props: {
  intent: OnboardingIntentId | "general";
  onIntent: (v: OnboardingIntentId | "general") => void;
  t: TFn;
}) {
  return (
    <div>
      <h1
        id="first-launch-title"
        className="text-balance text-3xl font-semibold tracking-tight"
      >
        {props.t("onboarding.launchIntentTitle")}
      </h1>
      <p className="mt-2 max-w-md text-base leading-relaxed text-muted-foreground">
        {props.t("onboarding.launchIntentBody")}
      </p>
      <div
        className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2"
        role="listbox"
        aria-label={props.t("onboarding.intentLabel")}
      >
        {ONBOARDING_INTENTS.map((item) => {
          const selected =
            item.id === "general"
              ? props.intent === "general" || props.intent === null
              : props.intent === item.id;
          const Icon = INTENT_ICONS[item.id] ?? Target;
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() =>
                props.onIntent(
                  item.id === "general"
                    ? "general"
                    : (item.id as OnboardingIntentId),
                )
              }
              className={cn(
                "flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-all",
                selected
                  ? "border-primary/45 bg-primary/[0.1] shadow-[0_0_0_1px_hsl(var(--primary)/0.12),0_0_28px_-14px_rgba(159,221,255,0.35)]"
                  : "border-hairline bg-white/[0.03] hover:border-hairline-strong hover:bg-white/[0.05]",
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                  selected
                    ? "border-primary/35 bg-primary/15 text-primary"
                    : "border-hairline bg-white/[0.04] text-muted-foreground",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <div className="text-base font-medium">
                  {props.t(item.labelKey)}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {props.t(item.hintKey)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SceneWorkspace(props: {
  root: string;
  pathParts: { name: string; parent: string };
  hasRoot: boolean;
  pulse: boolean;
  onPick: () => void;
  t: TFn;
}) {
  return (
    <div>
      <h1
        id="first-launch-title"
        className="text-balance text-3xl font-semibold tracking-tight"
      >
        {props.t("onboarding.launchWorkspaceTitle")}
      </h1>
      <p className="mt-2 max-w-md text-base leading-relaxed text-muted-foreground">
        {props.t("onboarding.launchWorkspaceBody")}
      </p>
      <button
        type="button"
        onClick={props.onPick}
        className={cn(
          "mt-8 w-full rounded-2xl border border-dashed px-5 py-8 text-left transition-all",
          props.hasRoot
            ? "border-success/40 bg-success/[0.08]"
            : "border-hairline-strong bg-white/[0.03] hover:border-primary/40 hover:bg-primary/[0.05]",
          props.pulse && "animate-send-burst",
        )}
      >
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
              props.hasRoot
                ? "border-success/40 bg-success/15 text-success"
                : "border-hairline bg-white/[0.04] text-muted-foreground",
            )}
          >
            {props.hasRoot ? (
              <Check className="h-5 w-5" strokeWidth={2.25} />
            ) : (
              <FolderOpen className="h-5 w-5" strokeWidth={1.75} />
            )}
          </div>
          <div className="min-w-0">
            {props.hasRoot ? (
              <>
                <div className="truncate text-lg font-semibold tracking-tight">
                  {props.pathParts.name || props.t("onboarding.workspaceCurrent")}
                </div>
                {props.pathParts.parent ? (
                  <div className="mt-0.5 truncate text-sm text-muted-foreground">
                    {props.pathParts.parent}
                  </div>
                ) : null}
                <div className="mt-2 text-xs font-medium text-success">
                  {props.t("onboarding.workspaceChange")}
                </div>
              </>
            ) : (
              <>
                <div className="text-lg font-medium">
                  {props.t("onboarding.workspacePick")}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {props.t("onboarding.launchWorkspaceHint")}
                </div>
              </>
            )}
          </div>
        </div>
      </button>
    </div>
  );
}

const APPROVAL_MODES: Array<{
  id: ApprovalMode;
  labelKey: string;
  descKey: string;
}> = [
  {
    id: "strict",
    labelKey: "onboarding.policyStrict",
    descKey: "onboarding.policyStrictDesc",
  },
  {
    id: "balanced",
    labelKey: "onboarding.policyBalanced",
    descKey: "onboarding.policyBalancedDesc",
  },
  {
    id: "autopilot",
    labelKey: "onboarding.policyAutopilot",
    descKey: "onboarding.policyAutopilotDesc",
  },
];

function SceneApproval(props: {
  mode: ApprovalMode;
  onMode: (mode: ApprovalMode) => void;
  t: TFn;
}) {
  const [autopilotAck, setAutopilotAck] = useState(false);
  const [pendingAutopilot, setPendingAutopilot] = useState(false);

  const selectMode = (mode: ApprovalMode) => {
    if (mode === "autopilot" && props.mode !== "autopilot" && !autopilotAck) {
      setPendingAutopilot(true);
      return;
    }
    setPendingAutopilot(false);
    props.onMode(mode);
  };

  return (
    <div>
      <h1
        id="first-launch-title"
        className="text-balance text-3xl font-semibold tracking-tight"
      >
        {props.t("onboarding.policyTitle")}
      </h1>
      <p className="mt-2 max-w-md text-base leading-relaxed text-muted-foreground">
        {props.t("onboarding.policyBody")}
      </p>
      {pendingAutopilot ? (
        <div
          className="mt-6 rounded-2xl border border-warning/40 bg-warning/10 p-4 text-left"
          role="alertdialog"
          aria-labelledby="autopilot-confirm-title"
          data-testid="autopilot-confirm"
        >
          <p
            id="autopilot-confirm-title"
            className="text-sm font-semibold text-warning"
          >
            {props.t("onboarding.policyAutopilot")}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {props.t("onboarding.policyAutopilotDesc")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              data-testid="autopilot-confirm-yes"
              onClick={() => {
                setAutopilotAck(true);
                setPendingAutopilot(false);
                props.onMode("autopilot");
              }}
            >
              {props.t("onboarding.policyAutopilot")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="autopilot-confirm-cancel"
              onClick={() => setPendingAutopilot(false)}
            >
              {props.t("common.cancel")}
            </Button>
          </div>
        </div>
      ) : null}
      <div
        className="mt-8 grid grid-cols-1 gap-2.5"
        role="radiogroup"
        aria-label={props.t("onboarding.policyTitle")}
      >
        {APPROVAL_MODES.map((item, index) => {
          const selected = props.mode === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={selected}
              // Roving tabindex + arrow-key navigation so the group is a single
              // tab stop and arrows move (and select) between options, per the
              // WAI-ARIA radiogroup pattern.
              tabIndex={selected ? 0 : -1}
              onClick={() => selectMode(item.id)}
              onKeyDown={(e) => {
                const dir =
                  e.key === "ArrowDown" || e.key === "ArrowRight"
                    ? 1
                    : e.key === "ArrowUp" || e.key === "ArrowLeft"
                      ? -1
                      : 0;
                if (dir === 0) return;
                e.preventDefault();
                const next =
                  (index + dir + APPROVAL_MODES.length) % APPROVAL_MODES.length;
                selectMode(APPROVAL_MODES[next]!.id);
                e.currentTarget.parentElement
                  ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                  ?.[next]?.focus();
              }}
              className={cn(
                "flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-left transition-all",
                selected
                  ? "border-primary/45 bg-primary/[0.1] shadow-[0_0_0_1px_hsl(var(--primary)/0.12),0_0_28px_-14px_rgba(159,221,255,0.35)]"
                  : "border-hairline bg-white/[0.03] hover:border-hairline-strong hover:bg-white/[0.05]",
              )}
            >
              <div
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                  selected
                    ? "border-primary/35 bg-primary/15 text-primary"
                    : "border-hairline bg-white/[0.04] text-muted-foreground",
                )}
              >
                <Shield className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-medium">
                  {props.t(item.labelKey)}
                  {item.id === "balanced" && (
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-primary/90">
                      {props.t("onboarding.recommended")}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {props.t(item.descKey)}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SceneAccount(props: {
  signedIn: boolean;
  name: string;
  onSignIn: () => void;
  t: TFn;
}) {
  return (
    <div>
      <h1
        id="first-launch-title"
        className="text-balance text-3xl font-semibold tracking-tight"
      >
        {props.t("onboarding.launchAccountTitle")}
      </h1>
      <p className="mt-2 max-w-md text-base leading-relaxed text-muted-foreground">
        {props.t("onboarding.launchAccountBody")}
      </p>
      <div className="mt-8 rounded-2xl border border-hairline bg-white/[0.03] p-5">
        {props.signedIn ? (
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-success/30 bg-success/15 text-success">
              <Check className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-md font-medium">
                {props.t("onboarding.authSignedIn", { name: props.name })}
              </div>
              <div className="text-sm text-muted-foreground">
                {props.t("onboarding.authConnectedHint")}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-md font-medium">
                {props.t("onboarding.authOptionalTitle")}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {props.t("onboarding.launchAccountSkip")}
              </div>
            </div>
            <Button
              type="button"
              size="lg"
              className="shrink-0 gap-2"
              onClick={props.onSignIn}
            >
              <LogIn className="h-4 w-4" strokeWidth={1.75} />
              {props.t("onboarding.authSignIn")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function SceneReady(props: {
  engineMissing?: boolean;
  runtimeInstallStatus?: UpdateStatus | null;
  onRuntimeInstallCheck?: () => void;
  runtimeInstallPending?: boolean;
  folderName: string;
  hasRoot: boolean;
  signedIn: boolean;
  intentLabel: string;
  approvalLabel: string;
  t: TFn;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/[0.12] text-primary shadow-[0_0_28px_-10px_rgba(159,221,255,0.45)]">
        <Sparkles className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <h1
        id="first-launch-title"
        className="text-balance text-3xl font-semibold tracking-display"
      >
        {props.t("onboarding.launchReadyTitle")}
      </h1>
      <p className="mt-3 max-w-sm text-md leading-relaxed text-muted-foreground">
        {props.t("onboarding.launchReadyBody")}
      </p>
      <ul className="mt-8 w-full max-w-sm space-y-2.5 text-left">
        <ReadyRow
          ok
          text={
            props.hasRoot
              ? props.t("onboarding.launchReadyFolder", {
                  name: props.folderName,
                })
              : props.t("onboarding.launchReadyFolderManaged")
          }
        />
        <ReadyRow
          ok
          text={props.t("onboarding.launchReadyIntent", {
            intent: props.intentLabel,
          })}
        />
        <ReadyRow
          ok
          text={props.t("onboarding.donePolicyOk", {
            mode: props.approvalLabel,
          })}
        />
        <ReadyRow
          ok={props.signedIn}
          warn={!props.signedIn}
          text={
            props.signedIn
              ? props.t("onboarding.doneAuthOk")
              : props.t("onboarding.doneAuthSkipped")
          }
        />
        <ReadyRow
          ok={!props.engineMissing}
          warn={props.engineMissing}
          text={
            props.engineMissing
              ? props.t("readiness.runtime.missing")
              : props.t("runtimeInstall.ready")
          }
        />
      </ul>
      {props.engineMissing ? (
        <div className="mt-6 w-full max-w-sm text-left">
          <RuntimeInstallStep
            status={props.runtimeInstallStatus}
            pending={props.runtimeInstallPending}
            onCheck={props.onRuntimeInstallCheck}
          />
        </div>
      ) : null}
      <p className="mt-6 max-w-xs text-xs text-muted-foreground">
        {props.t("onboarding.launchReadyDefaults")}
      </p>
    </div>
  );
}

function ReadyRow(props: { ok: boolean; warn?: boolean; text: string }) {
  return (
    <li className="flex items-center gap-2.5 rounded-xl border border-hairline bg-white/[0.03] px-3.5 py-2.5 text-sm">
      <Check
        className={cn(
          "h-4 w-4 shrink-0",
          /* Completed setup steps = success; skipped/needs-attention = approval amber */
          props.ok
            ? "text-success"
            : props.warn
              ? "text-warning"
              : "text-muted-foreground",
        )}
        strokeWidth={2.5}
        aria-hidden
      />
      <span className="text-foreground/90">{props.text}</span>
    </li>
  );
}

function intentLabel(
  intent: OnboardingIntentId | "general",
  t: TFn,
): string {
  if (intent === "general" || intent === null) {
    return t("onboarding.intent.general");
  }
  const row = ONBOARDING_INTENTS.find((i) => i.id === intent);
  return row ? t(row.labelKey) : t("onboarding.intent.general");
}

function approvalModeLabel(mode: ApprovalMode, t: TFn): string {
  const row = APPROVAL_MODES.find((m) => m.id === mode);
  return row ? t(row.labelKey) : t("onboarding.policyBalanced");
}
