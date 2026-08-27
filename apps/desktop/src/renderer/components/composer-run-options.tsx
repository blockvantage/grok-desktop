/**
 * Shared run-options popover: model, effort, plan-first, approval.
 * Used on Home and the in-conversation follow-up composer (Phase 2.1).
 */
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useT } from "@/i18n";
import { approvalLabel, effortLabel } from "@/lib/labels";
import type { ApprovalMode, EffortLevel } from "@grokdesk/shared";

export function ComposerRunOptions(props: {
  model: string;
  models: string[];
  onModel: (v: string) => void;
  effort: EffortLevel;
  onEffort: (v: EffortLevel) => void;
  approvalMode: ApprovalMode;
  onApprovalMode: (v: ApprovalMode) => void;
  planFirst?: boolean;
  onPlanFirst?: (v: boolean) => void;
  compact?: boolean;
}) {
  const t = useT();
  const models = props.models.length ? props.models : [props.model];
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-8 shrink-0 gap-1.5 rounded-full px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
              aria-label={t("home.runOptions")}
              data-testid="composer-run-options"
            >
              <Settings2 className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[9rem] truncate font-medium text-foreground/90">
                {props.model}
              </span>
              {!props.compact ? (
                <>
                  <span className="hidden text-muted-foreground sm:inline">
                    ·
                  </span>
                  <span className="hidden sm:inline">
                    {effortLabel(props.effort)}
                  </span>
                </>
              ) : null}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t("home.runOptions")}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="start"
        side="top"
        className="w-72 space-y-3 border-white/10 p-3"
      >
        <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {t("home.runOptions")}
        </p>
        <div className="space-y-1.5">
          <label className="text-2xs text-muted-foreground">
            {t("home.model")}
          </label>
          <Select value={props.model} onValueChange={props.onModel}>
            <SelectTrigger className="h-9 w-full rounded-lg border-white/[0.08] bg-white/[0.03] text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <label className="text-2xs text-muted-foreground">
            {t("home.effort")}
          </label>
          <Select
            value={props.effort === "max" ? "heavy" : props.effort}
            onValueChange={(v) => props.onEffort(v as EffortLevel)}
          >
            <SelectTrigger className="h-9 w-full rounded-lg border-white/[0.08] bg-white/[0.03] text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fast">{effortLabel("fast")}</SelectItem>
              <SelectItem value="normal">{effortLabel("normal")}</SelectItem>
              <SelectItem value="heavy">{effortLabel("heavy")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {props.onPlanFirst ? (
          <div className="space-y-1.5">
            <label className="text-2xs text-muted-foreground">
              {t("home.planFirst")}
            </label>
            <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 text-xs">
              <input
                type="checkbox"
                className="rounded border-white/20"
                checked={Boolean(props.planFirst)}
                onChange={(e) => props.onPlanFirst?.(e.target.checked)}
                data-plan-first-toggle
              />
              <span className="text-foreground/90">
                {t("home.planFirstToggle")}
              </span>
            </label>
          </div>
        ) : null}
        <div className="space-y-1.5">
          <label className="text-2xs text-muted-foreground">
            {t("home.approval")}
          </label>
          <Select
            value={props.approvalMode}
            onValueChange={(v) => props.onApprovalMode(v as ApprovalMode)}
          >
            <SelectTrigger className="h-9 w-full rounded-lg border-white/[0.08] bg-white/[0.03] text-xs shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="balanced">
                {approvalLabel("balanced") || t("home.approvalBalanced")}
              </SelectItem>
              <SelectItem value="strict">
                {approvalLabel("strict") || t("home.approvalStrict")}
              </SelectItem>
              <SelectItem value="autopilot">
                {approvalLabel("autopilot") || t("home.approvalAutopilot")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </PopoverContent>
    </Popover>
  );
}
