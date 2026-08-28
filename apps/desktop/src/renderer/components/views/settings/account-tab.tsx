import { useEffect, useState } from "react";
import { ExternalLink, LogIn, LogOut, RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { engineStatusLabel } from "@/lib/labels";
import type { AuthState, UsageSnapshot } from "@grokdesk/shared";
import { useT } from "@/i18n";
import { UsageMeter } from "@/components/usage-meter";
import { getUsage, openBilling, openAccountPrivacy } from "@/lib/api";

export function AccountTab(props: {
  auth: (AuthState & { models?: string[] }) | null;
  online: boolean;
  initials: string;
  onSignIn: () => void;
  onSignOut: () => void;
  onRefreshAuth: () => void;
  /** Re-enter first-run setup without silently resetting approval mode. */
  onRunSetupAgain?: () => void;
  onShowTour?: () => void;
  onShowWhatsNew?: () => void;
  /** Shared usage snapshot from AccountController when available. */
  usageSnapshot?: UsageSnapshot | null;
  onUsageChange?: (snap: UsageSnapshot | null) => void;
}) {
  const t = useT();
  const [usage, setUsage] = useState<UsageSnapshot | null>(
    props.usageSnapshot ?? null,
  );
  const [usageLoading, setUsageLoading] = useState(false);

  const loadUsage = async (force = false) => {
    if (!props.auth?.signedIn) {
      setUsage(null);
      props.onUsageChange?.(null);
      return;
    }
    setUsageLoading(true);
    try {
      const snap = await getUsage(force);
      setUsage(snap);
      props.onUsageChange?.(snap);
    } catch {
      setUsage(null);
    } finally {
      setUsageLoading(false);
    }
  };

  useEffect(() => {
    if (props.usageSnapshot !== undefined) {
      setUsage(props.usageSnapshot);
      return;
    }
    void loadUsage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.auth?.signedIn, props.usageSnapshot]);

  return (
    <Card className="border-border/70 overflow-hidden">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14">
              <AvatarFallback className="bg-primary/15 text-lg text-primary">
                {props.initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="text-base font-semibold">
                {props.auth?.accountLabel ?? t("settings.notSignedIn")}
              </div>
              <div className="text-sm text-muted-foreground">
                {t("settings.superGrok")}
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs">
                <span
                  className={
                    props.online
                      ? "dot-status h-1.5 w-1.5 bg-success text-success"
                      : props.auth?.signedIn
                        ? "dot-status h-1.5 w-1.5 bg-warning text-warning"
                        : "dot-status h-1.5 w-1.5 bg-muted-foreground/50 text-muted-foreground/50"
                  }
                />
                <span
                  className={
                    props.online
                      ? "text-success"
                      : props.auth?.signedIn
                        ? "text-warning"
                        : "text-muted-foreground"
                  }
                >
                  {props.online
                    ? t("settings.connected")
                    : props.auth?.signedIn
                      ? engineStatusLabel(props.auth.engineStatus)
                      : engineStatusLabel(
                          props.auth?.engineStatus ?? "signed_out",
                        )}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:items-end">
            {props.auth?.signedIn ? (
              <Button
                variant="outline"
                size="sm"
                className="text-destructive-text hover:text-destructive-text"
                onClick={props.onSignOut}
              >
                <LogOut className="h-3.5 w-3.5" />
                {t("settings.signOut")}
              </Button>
            ) : (
              <Button size="sm" onClick={props.onSignIn} data-testid="account-sign-in">
                <LogIn className="h-3.5 w-3.5" />
                {t("settings.signInSuperGrok")}
              </Button>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {props.onRunSetupAgain ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={props.onRunSetupAgain}
                >
                  {t("settings.runSetupAgain")}
                </Button>
              ) : null}
              {props.onShowTour ? (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="account-show-tour"
                  onClick={props.onShowTour}
                >
                  {t("settings.showTour")}
                </Button>
              ) : null}
              {props.onShowWhatsNew ? (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="account-whats-new"
                  onClick={props.onShowWhatsNew}
                >
                  {t("settings.whatsNew")}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={props.onRefreshAuth}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t("settings.refreshStatus")}
              </Button>
            </div>
          </div>
        </div>

        {props.auth?.signedIn && (
          <UsageMeter
            usage={usage}
            loading={usageLoading}
            onRefresh={() => void loadUsage(true)}
            onManage={() => void openBilling()}
          />
        )}

        {/* Compact privacy links only — long explanations live in Privacy/About. */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/50 pt-4">
          <Shield className="h-3.5 w-3.5 text-muted-foreground" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => void openAccountPrivacy()}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("settings.privacyOpenAccount")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 text-xs"
            onClick={() => void openBilling()}
          >
            {t("settings.usageManageBilling")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
