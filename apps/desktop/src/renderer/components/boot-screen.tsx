import { BrandMark } from "@/components/brand-mark";
import { useT } from "@/i18n";
import { bootProgress, type BootStage } from "@/lib/boot-progress";

const LABEL_KEY: Record<BootStage, string> = {
  starting: "workspace.bootStarting",
  loading_workspace: "workspace.bootLoadingWorkspace",
  restoring_session: "workspace.bootRestoringSession",
  ready: "workspace.bootReady",
};

export function BootScreen({ stage }: { stage: BootStage }) {
  const t = useT();
  const progress = bootProgress(stage);

  return (
    <div
      className="first-launch flex h-full w-full flex-col items-center justify-center"
      data-testid="boot-screen"
      data-boot-stage={stage}
      role="status"
      aria-live="polite"
      aria-busy={stage !== "ready"}
    >
      <div className="first-launch-ambience" aria-hidden>
        <div className="first-launch-orb first-launch-orb-a" />
        <div className="first-launch-orb first-launch-orb-b" />
      </div>
      <div className="relative z-10 flex w-64 flex-col items-center">
        <div className="first-launch-brand boot-mark-arrive">
          <BrandMark className="h-14 w-14" />
        </div>
        <p className="mt-6 text-sm font-medium tracking-tight text-foreground/90">
          {t(LABEL_KEY[stage])}
        </p>
        <div
          className="mt-4 h-1 w-full overflow-hidden rounded-full bg-white/[0.08]"
          role="progressbar"
          aria-label={t("workspace.bootProgress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <div
            className="boot-progress-fill h-full rounded-full bg-primary"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="mt-2 font-mono text-2xs tabular-nums text-muted-foreground">
          {progress}%
        </span>
      </div>
    </div>
  );
}
