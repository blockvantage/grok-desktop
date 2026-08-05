import { cn } from "@/lib/utils";
import { useT } from "@/i18n";

/**
 * Shown while a chat's history is being fetched — never flash "No replies yet".
 * Mirrors the transcript layout so loading feels calm and spatially honest.
 */
export function ConversationLoading({
  className,
}: {
  className?: string;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "conversation-loading-skeleton mx-auto w-full max-w-3xl px-5 py-10 sm:px-8 sm:py-14",
        "animate-fade-in",
        className,
      )}
      data-conversation-loading
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={t("workspace.loadingConversation")}
    >
      <div className="mb-7 flex items-center gap-3" aria-hidden>
        <div className="h-8 w-8 rounded-lg border border-white/[0.06] bg-white/[0.05]" />
        <div className="space-y-2">
          <div className="h-2.5 w-28 rounded-full bg-white/[0.09]" />
          <div className="h-2 w-16 rounded-full bg-white/[0.05]" />
        </div>
      </div>
      <div className="space-y-7" aria-hidden>
        <div className="ml-auto w-[68%] rounded-2xl rounded-br-md border border-white/[0.05] bg-white/[0.035] p-4">
          <div className="h-2.5 w-[84%] rounded-full bg-white/[0.08]" />
          <div className="mt-2.5 h-2.5 w-[58%] rounded-full bg-white/[0.055]" />
        </div>
        <div className="w-[82%] space-y-3">
          <div className="h-2.5 w-[92%] rounded-full bg-white/[0.085]" />
          <div className="h-2.5 w-[76%] rounded-full bg-white/[0.065]" />
          <div className="h-2.5 w-[48%] rounded-full bg-white/[0.045]" />
        </div>
      </div>
      <div className="mt-10 flex items-baseline justify-between gap-4 border-t border-white/[0.06] pt-3">
        <p className="text-sm font-medium tracking-tight text-foreground/85">
          {t("workspace.loadingConversation")}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("workspace.loadingConversationHint")}
        </p>
      </div>
    </div>
  );
}
