import { useCallback, useEffect, useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { useT } from "@/i18n";
import { humanizeError } from "@/lib/errors";
import type {
  DesktopMachineSettings,
  DesktopPermissionStatus,
} from "@grokdesk/shared";
import { SettingsRow, SettingsSection } from "./settings-row";

type PermsPayload = {
  permissions: DesktopPermissionStatus | null;
  machine: DesktopMachineSettings | null;
};

export function PermissionsTab() {
  const t = useT();
  const [data, setData] = useState<PermsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = (await window.grokdesk?.desktop?.getPermissions()) as PermsPayload;
      setData(r ?? null);
      setError(null);
    } catch (e) {
      setError(humanizeError(e, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const machine = data?.machine;
  const perms = data?.permissions;

  async function setEnabled(enabled: boolean) {
    if (enabled) {
      setConfirmEnable(true);
      return;
    }
    await applyEnabled(false);
  }

  async function applyEnabled(enabled: boolean) {
    setBusy(true);
    try {
      await window.grokdesk?.desktop?.setMachine({ enabled });
      await refresh();
    } catch (e) {
      setError(humanizeError(e, t));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Spinner size="sm" />
        {t("common.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-6 p-1">
      <SettingsSection
        title={t("settings.permissions.title")}
        description={t("settings.permissions.help")}
      >
        <SettingsRow
          label={t("settings.permissions.master")}
          description={
            machine?.enabled
              ? t("settings.permissions.masterOn")
              : t("settings.permissions.masterOff")
          }
          control={
            <Switch
              checked={Boolean(machine?.enabled)}
              disabled={busy || !machine}
              onCheckedChange={(v) => void setEnabled(Boolean(v))}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title={t("settings.permissions.system")}
        action={
          <Button variant="ghost" size="sm" onClick={() => void refresh()}>
            {t("settings.permissions.refresh")}
          </Button>
        }
      >
        <div className="space-y-2 rounded-lg border border-border/60 p-3">
          <PermChip
            label={t("settings.permissions.capture")}
            ok={Boolean(perms?.captureGranted)}
            detail={perms?.captureDetail ?? "—"}
            actionLabel={t("settings.permissions.openCapture")}
            statusGranted={t("settings.permissions.statusGranted")}
            statusMissing={t("settings.permissions.statusMissing")}
            onAction={() => void window.grokdesk?.desktop?.openCaptureSettings()}
          />
          <PermChip
            label={t("settings.permissions.input")}
            ok={Boolean(perms?.inputGranted)}
            detail={perms?.inputDetail ?? "—"}
            actionLabel={t("settings.permissions.openInput")}
            statusGranted={t("settings.permissions.statusGranted")}
            statusMissing={t("settings.permissions.statusMissing")}
            onAction={() => void window.grokdesk?.desktop?.openInputSettings()}
          />
        </div>
      </SettingsSection>

      <p className="text-xs text-muted-foreground">
        {t("settings.permissions.safety")}
      </p>

      {error ? (
        <p className="text-xs text-destructive-text">{error}</p>
      ) : null}

      <AlertDialog open={confirmEnable} onOpenChange={setConfirmEnable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings.permissions.master")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.permissions.enableConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmEnable(false);
                void applyEnabled(true);
              }}
            >
              {t("common.enable")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PermChip(props: {
  label: string;
  ok: boolean;
  detail: string;
  actionLabel: string;
  statusGranted: string;
  statusMissing: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-2 last:border-0">
      <div>
        <div className="text-sm">{props.label}</div>
        <div className="text-xs text-muted-foreground">
          {props.ok ? props.statusGranted : props.statusMissing}
          {props.detail && props.detail !== "—"
            ? ` · ${props.detail}`
            : ""}
        </div>
      </div>
      {!props.ok && (
        <Button size="sm" variant="outline" onClick={props.onAction}>
          {props.actionLabel}
        </Button>
      )}
    </div>
  );
}
