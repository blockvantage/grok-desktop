import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useT } from "@/i18n";
import { SettingsInfoRow, SettingsSection } from "./settings-row";
import { LanguageTab } from "./language-tab";

export function PreferencesTab(props: {
  models: string[];
  defaultModel: string;
  onDefaultModel: (m: string) => void;
  bundledCount: number;
  /** SC-5: real default approval mode control. */
  approvalMode: "strict" | "balanced" | "autopilot";
  onApprovalMode: (m: "strict" | "balanced" | "autopilot") => void;
  /**
   * Opt-in AgentProvider engine path (default off).
   * Does not make AgentProvider the silent product default — still opt-in only.
   */
  preferProviderEngine?: boolean;
  onPreferProviderEngine?: (enabled: boolean) => void;
  /** T4: inherit personal Grok plugins/hooks (off by default). */
  inheritUserGrok?: boolean;
  onInheritUserGrok?: (enabled: boolean) => void;
  /** T5: trusted workspace folders for project tools. */
  trustedFolders?: string[];
  onUntrustFolder?: (path: string) => void;
}) {
  const t = useT();
  const [confirmInherit, setConfirmInherit] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4" data-testid="preferences-tab">
      {/* Language first — easy to find, same card density as other prefs */}
      <LanguageTab />

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.defaultModel")}
          </CardTitle>
          <CardDescription>
            {t("settings.defaultModelDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select
            value={props.defaultModel}
            onValueChange={props.onDefaultModel}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                  {m.includes("4.5") && !m.includes("mini")
                    ? ` ${t("settings.modelRecommended")}`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.workspaceBehavior")}
          </CardTitle>
          <CardDescription>
            {t("settings.workspaceBehaviorDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <SettingsSection title={t("settings.defaultApproval")}>
            <Select
              value={props.approvalMode}
              onValueChange={(v) =>
                props.onApprovalMode(v as typeof props.approvalMode)
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strict">
                  {t("home.approvalStrict")}
                </SelectItem>
                <SelectItem value="balanced">
                  {t("home.approvalBalanced")}
                </SelectItem>
                <SelectItem value="autopilot">
                  {t("home.approvalAutopilot")}
                </SelectItem>
              </SelectContent>
            </Select>
          </SettingsSection>
          {props.onPreferProviderEngine ? (
            <SettingsSection title={t("settings.providerEngine")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1 pr-2">
                  <p className="text-sm text-foreground/90">
                    {t("settings.providerEngineLabel")}
                  </p>
                  <p className="text-2xs leading-relaxed text-muted-foreground">
                    {t("settings.providerEngineDesc")}
                  </p>
                </div>
                <Switch
                  checked={Boolean(props.preferProviderEngine)}
                  onCheckedChange={props.onPreferProviderEngine}
                  aria-label={t("settings.providerEngineLabel")}
                />
              </div>
            </SettingsSection>
          ) : null}
          {props.onInheritUserGrok ? (
            <SettingsSection title={t("settings.inheritUserGrok")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1 pr-2">
                  <p className="text-sm text-foreground/90">
                    {t("settings.inheritUserGrok")}
                  </p>
                  <p className="text-2xs leading-relaxed text-muted-foreground">
                    {t("settings.inheritUserGrokDesc")}
                  </p>
                </div>
                <Switch
                  checked={Boolean(props.inheritUserGrok)}
                  onCheckedChange={(v) => {
                    if (v) setConfirmInherit(true);
                    else props.onInheritUserGrok?.(false);
                  }}
                  aria-label={t("settings.inheritUserGrok")}
                  data-testid="inherit-user-grok-switch"
                />
              </div>
            </SettingsSection>
          ) : null}
          <SettingsSection title={t("folderTrust.settingsTitle")}>
            <p className="mb-2 text-2xs leading-relaxed text-muted-foreground">
              {t("folderTrust.settingsDesc")}
            </p>
            {(props.trustedFolders?.length ?? 0) === 0 ? (
              <p
                className="text-xs text-muted-foreground"
                data-testid="trusted-folders-empty"
              >
                {t("folderTrust.empty")}
              </p>
            ) : (
              <ul className="space-y-1.5" data-testid="trusted-folders-list">
                {props.trustedFolders!.map((folder) => (
                  <li
                    key={folder}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/50 px-2 py-1.5 text-xs"
                  >
                    <span className="min-w-0 truncate font-mono" title={folder}>
                      {folder}
                    </span>
                    {props.onUntrustFolder ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => props.onUntrustFolder?.(folder)}
                        data-testid="trusted-folder-remove"
                      >
                        {t("folderTrust.remove")}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
          {/* SC-5: informational rows without control chrome */}
          <div className="space-y-0.5 border-t border-border/50 pt-3">
            <SettingsInfoRow
              label={t("settings.shellTools")}
              value={t("settings.policyGated")}
            />
            <SettingsInfoRow
              label={t("settings.tempChatFolders")}
              value={t("settings.enabled")}
            />
            <SettingsInfoRow
              label={t("settings.defaultSkills")}
              value={t("settings.bundledPaths", { count: props.bundledCount })}
            />
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={confirmInherit} onOpenChange={setConfirmInherit}>
        <AlertDialogContent data-testid="inherit-user-grok-risk-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.inheritUserGrokRiskTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.inheritUserGrokRiskBody")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("settings.inheritUserGrokCancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                props.onInheritUserGrok?.(true);
                setConfirmInherit(false);
              }}
            >
              {t("settings.inheritUserGrokConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* SC-5: empty Security card removed — privacy lives on Account */}
    </div>
  );
}
