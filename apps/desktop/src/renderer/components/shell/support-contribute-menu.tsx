/**
 * Always-visible open-source contribute control (sidebar footer).
 * Opens external support / feature-request / GitHub links — never a paywall.
 */

import { Heart, Lightbulb, Star } from "lucide-react";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import {
  listContributeActions,
  openContributeUrl,
  type ContributeUrls,
  CONTRIBUTE_URLS,
} from "@/lib/contribute";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type SupportContributeMenuProps = {
  collapsed?: boolean;
  /** Inject URLs in tests; production uses CONTRIBUTE_URLS. */
  urls?: ContributeUrls;
  className?: string;
};

export function SupportContributeMenu(props: SupportContributeMenuProps) {
  const t = useT();
  const collapsed = Boolean(props.collapsed);
  const actions = listContributeActions(props.urls ?? CONTRIBUTE_URLS);
  if (actions.length === 0) return null;

  const label = t("contribute.support");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={collapsed ? "icon" : "default"}
          title={collapsed ? label : undefined}
          className={cn(
            "h-auto w-full gap-2 rounded-xl text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
            collapsed ? "justify-center px-0 py-2" : "justify-start px-2.5 py-2",
            props.className,
          )}
          aria-label={t("contribute.supportAria")}
          data-testid="sidebar-contribute"
        >
          <Heart
            className="h-4 w-4 shrink-0 text-primary/90"
            strokeWidth={1.75}
            aria-hidden
          />
          {!collapsed && (
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
              {label}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side={collapsed ? "right" : "top"}
        className="w-64 border-white/10"
        data-testid="sidebar-contribute-menu"
      >
        <DropdownMenuLabel className="space-y-0.5">
          <div className="text-sm font-medium text-foreground">
            {t("contribute.menuTitle")}
          </div>
          <div className="text-2xs font-normal leading-snug text-muted-foreground">
            {t("contribute.menuSubtitle")}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-white/[0.06]" />
        {actions.map((action) => {
          if (action.id === "featureRequest") {
            return (
              <DropdownMenuItem
                key={action.id}
                data-testid="contribute-feature-request"
                onClick={() => openContributeUrl(action.url)}
              >
                <Lightbulb className="h-4 w-4" strokeWidth={1.75} />
                <span className="flex min-w-0 flex-col">
                  <span>{t("contribute.featureRequest")}</span>
                  <span className="text-2xs font-normal text-muted-foreground">
                    {t("contribute.featureRequestHint")}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          }
          if (action.id === "support") {
            return (
              <DropdownMenuItem
                key={action.id}
                data-testid="contribute-support"
                onClick={() => openContributeUrl(action.url)}
              >
                <Heart className="h-4 w-4 text-primary" strokeWidth={1.75} />
                <span className="flex min-w-0 flex-col">
                  <span>{t("contribute.payWhatYouWant")}</span>
                  <span className="text-2xs font-normal text-muted-foreground">
                    {t("contribute.payWhatYouWantHint")}
                  </span>
                </span>
              </DropdownMenuItem>
            );
          }
          return (
            <DropdownMenuItem
              key={action.id}
              data-testid="contribute-github"
              onClick={() => openContributeUrl(action.url)}
            >
              <Star className="h-4 w-4" strokeWidth={1.75} />
              <span className="flex min-w-0 flex-col">
                <span>{t("contribute.starGithub")}</span>
                <span className="text-2xs font-normal text-muted-foreground">
                  {t("contribute.starGithubHint")}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
