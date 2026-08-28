import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { humanizeError } from "@/lib/errors";
import { pickDirectory, rpc } from "@/lib/api";
import {
  filterConnectorPresets,
  hasConfiguredCredentials,
  listPresetEnvPlaceholders,
  type AuthState,
  type ConnectorCategory,
  type ConnectorPreset as SharedConnectorPreset,
  GROKDESK_VERSION,
  type UsageSnapshot,
} from "@grokdesk/shared";
import { useT } from "@/i18n";
import { localizeConnectors } from "@/i18n/localize-connector";
import { AccountTab } from "./settings/account-tab";
import { PreferencesTab } from "./settings/preferences-tab";
import { ToolsTab } from "./settings/tools-tab";

import { RuntimeUpdatesTab } from "./settings/runtime-updates-tab";
import { PermissionsTab } from "./settings/permissions-tab";
import { RemoteTab } from "./settings/remote-tab";
import type { McpRow } from "./settings/types";
import { GROKDESK_REMOTE_UI_ENABLED } from "@grokdesk/shared";

type ConnectorPreset = SharedConnectorPreset;

export type { SettingsTabId } from "@/lib/settings-tab";
export { resolveSettingsTab } from "@/lib/settings-tab";
import {
  resolveSettingsTab,
  type SettingsTabId,
} from "@/lib/settings-tab";

export function SettingsView(props: {
  auth: (AuthState & { models?: string[] }) | null;
  models: string[];
  defaultModel: string;
  onDefaultModel: (m: string) => void;
  approvalMode: "strict" | "balanced" | "autopilot";
  onApprovalMode: (m: "strict" | "balanced" | "autopilot") => void;
  mcpServers: McpRow[];
  skillsPaths: string[];
  effectiveSkillsPaths?: string[];
  onSignIn: () => void;
  onSignOut: () => void;
  onRefreshAuth: () => void;
  onSettingsChange: (next: {
    mcpServers?: McpRow[];
    skillsPaths?: string[];
    preferProviderEngine?: boolean;
    inheritUserGrok?: boolean;
    trustedFolders?: string[];
    requireSandboxForAutopilot?: boolean;
  }) => Promise<void>;
  onMcpServersChange?: (mcpServers: McpRow[]) => void;
  /** Opt-in AgentProvider engine path (default false). */
  preferProviderEngine?: boolean;
  /** T4: inherit personal Grok plugins (default false). */
  inheritUserGrok?: boolean;
  /** T5: trusted workspace folders. */
  trustedFolders?: string[];
  requireSandboxForAutopilot?: boolean;
  onUntrustFolder?: (path: string) => void;
  /** Deep-link into a settings tab (e.g. Tools from home checklist). */
  initialTab?: SettingsTabId;
  onRunSetupAgain?: () => void;
  onShowTour?: () => void;
  onShowWhatsNew?: () => void;
  /** Shared SuperGrok usage snapshot (Home/Sidebar/Settings single source). */
  usageSnapshot?: UsageSnapshot | null;
  onUsageChange?: (snap: UsageSnapshot | null) => void;
}) {
  const t = useT();
  const { toast } = useToast();
  const [tab, setTab] = useState(() =>
    resolveSettingsTab(props.initialTab ?? "account"),
  );
  useEffect(() => {
    if (props.initialTab) setTab(resolveSettingsTab(props.initialTab));
  }, [props.initialTab]);
  // SC-7: empty defaults — user fills the Add custom dialog.
  const [mcpId, setMcpId] = useState("");
  const [mcpCmd, setMcpCmd] = useState("");
  const [mcpArgs, setMcpArgs] = useState("");
  const [skillPath, setSkillPath] = useState("");
  const [presets, setPresets] = useState<ConnectorPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(true);
  const [presetsError, setPresetsError] = useState<string | null>(null);
  const [connectorQuery, setConnectorQuery] = useState("");
  const [connectorCategory, setConnectorCategory] = useState<
    ConnectorCategory | "all" | "recommended"
  >("recommended");
  const [hideAuthRequired, setHideAuthRequired] = useState(false);
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  /** Draft credentials keyed by preset id; never rehydrated from stored secrets. */
  const [credDrafts, setCredDrafts] = useState<
    Record<string, Record<string, string>>
  >({});
  /** Preset ids currently showing the re-edit form after configured. */
  const [credEditing, setCredEditing] = useState<Record<string, boolean>>({});

  const initials = (props.auth?.accountLabel ?? "G")
    .replace(/[^a-zA-Z]/g, "")
    .slice(0, 1)
    .toUpperCase();

  const online = Boolean(
    props.auth?.signedIn && props.auth.engineStatus === "ready",
  );

  const loadPresets = useCallback(async () => {
    setPresetsLoading(true);
    setPresetsError(null);
    try {
      // Timeout so a hung gateway never leaves Tools on "Loading presets…" forever.
      const list = await Promise.race([
        rpc<ConnectorPreset[]>("connectors.listPresets", {}),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("presets_timeout")),
            5_000,
          ),
        ),
      ]);
      setPresets(Array.isArray(list) ? list : []);
      if (!Array.isArray(list) || list.length === 0) {
        setPresetsError(t("settings.presetsEmpty"));
      }
    } catch (e) {
      setPresets([]);
      const msg = e instanceof Error ? e.message : String(e);
      setPresetsError(
        msg === "presets_timeout"
          ? t("settings.presetsTimeout")
          : t("settings.presetsError") + (msg ? ` (${msg})` : ""),
      );
    } finally {
      setPresetsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  // One retry when opening Tools if gallery is still empty (not on every
  // load finish — that would loop when the gateway hangs/errors).
  useEffect(() => {
    if (tab !== "tools") return;
    if (presetsLoading || presets.length > 0) return;
    void loadPresets();
    // Only re-run when the active tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [tab]);

  // SC-2: one feedback channel for all Tools actions — toast only.
  function showConnectorError(message: string) {
    toast({ description: message, variant: "destructive" });
  }

  function showConnectorOk(message: string) {
    toast({ description: message, variant: "success" });
  }

  async function addMcp() {
    const id = mcpId.trim();
    if (!id || !mcpCmd.trim()) return;
    const args = mcpArgs.trim().split(/\s+/).filter(Boolean);
    try {
      await props.onSettingsChange({
        mcpServers: [
          ...props.mcpServers.filter((m) => m.id !== id),
          { id, command: mcpCmd.trim(), args, enabled: true },
        ],
        skillsPaths: props.skillsPaths,
      });
      showConnectorOk(t("settings.savedApplied"));
    } catch (e) {
      showConnectorError(
        humanizeError(e, t),
      );
    }
  }

  function getPresetPlaceholders(presetId: string): string[] {
    const preset = presets.find((p) => p.id === presetId);
    return preset ? listPresetEnvPlaceholders(preset) : [];
  }

  function draftFor(presetId: string): Record<string, string> {
    return credDrafts[presetId] ?? {};
  }

  function setDraftField(presetId: string, name: string, value: string) {
    setCredDrafts((prev) => ({
      ...prev,
      [presetId]: { ...(prev[presetId] ?? {}), [name]: value },
    }));
  }

  function clearDraft(presetId: string) {
    setCredDrafts((prev) => {
      const next = { ...prev };
      delete next[presetId];
      return next;
    });
    setCredEditing((prev) => {
      const next = { ...prev };
      delete next[presetId];
      return next;
    });
  }

  async function enablePreset(presetId: string, env?: Record<string, string>) {
    const placeholders = getPresetPlaceholders(presetId);
    const draft = env ?? draftFor(presetId);
    if (placeholders.length > 0) {
      const missing = placeholders.filter((n) => !draft[n]?.trim());
      if (missing.length > 0) {
        showConnectorError(t("settings.credentialsRequired"));
        return;
      }
    }
    const credentialEnv =
      placeholders.length > 0
        ? Object.fromEntries(
            placeholders.map((n) => [n, draft[n]!.trim()]),
          )
        : undefined;
    try {
      const next = await rpc<{
        mcpServers: McpRow[];
        missingEnv?: string[];
        engineReloaded?: boolean;
      }>("connectors.enable", {
        presetId,
        ...(credentialEnv ? { env: credentialEnv } : {}),
      });
      props.onMcpServersChange?.(next.mcpServers);
      // Drop draft secrets from memory; never rehydrate password fields.
      clearDraft(presetId);
      const miss = next.missingEnv ?? [];
      if (miss.length) {
        showConnectorOk(
          `${t("settings.needsCredentials")}: ${miss.join(", ")}`,
        );
      } else {
        showConnectorOk(t("settings.savedApplied"));
      }
    } catch (e) {
      showConnectorError(
        humanizeError(e, t),
      );
    }
  }

  async function disablePreset(presetId: string) {
    try {
      const next = await rpc<{ mcpServers: McpRow[] }>("connectors.disable", {
        presetId,
      });
      props.onMcpServersChange?.(next.mcpServers);
      showConnectorOk(t("settings.savedApplied"));
    } catch (e) {
      showConnectorError(
        humanizeError(e, t),
      );
    }
  }

  async function enableRecommended() {
    try {
      const next = await rpc<{ mcpServers: McpRow[] }>(
        "connectors.enableRecommended",
        {},
      );
      props.onMcpServersChange?.(next.mcpServers);
      setConnectorCategory("recommended");
      showConnectorOk(t("settings.savedApplied"));
    } catch (e) {
      showConnectorError(
        humanizeError(e, t),
      );
    }
  }

  const enabledServerIds = useMemo(
    () =>
      props.mcpServers.filter((m) => m.enabled).map((m) => m.id),
    [props.mcpServers],
  );

  const localizedPresets = useMemo(
    () => localizeConnectors(presets, t),
    [presets, t],
  );

  const filteredPresets = useMemo(
    () =>
      filterConnectorPresets(localizedPresets, {
        query: connectorQuery,
        category: connectorCategory,
        enabledOnly,
        enabledServerIds,
        hideAuthRequired,
      }),
    [
      localizedPresets,
      connectorQuery,
      connectorCategory,
      enabledOnly,
      enabledServerIds,
      hideAuthRequired,
    ],
  );

  const selectedPreset =
    filteredPresets.find((p) => p.id === selectedPresetId) ??
    filteredPresets[0] ??
    null;

  const bundledCount = props.effectiveSkillsPaths?.length
    ? props.effectiveSkillsPaths.length
    : 1;

  return (
    <ScrollArea className="flex-1">
      <div className="mx-auto w-full max-w-[1400px] space-y-6 px-6 py-6 animate-fade-in lg:px-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("settings.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("settings.subtitle")}
          </p>
        </div>

        <Tabs
          value={tab}
          onValueChange={(v) => setTab(resolveSettingsTab(v))}
        >
          <TabsList className="mb-4 h-auto flex-wrap gap-1">
            <TabsTrigger value="account">{t("settings.tabAccount")}</TabsTrigger>
            <TabsTrigger value="preferences">
              {t("settings.tabPreferences")}
            </TabsTrigger>
            {/* Desktop control lives here — keep early so it is not clipped off-screen */}
            <TabsTrigger value="permissions">
              {t("settings.tabPermissions")}
            </TabsTrigger>
            <TabsTrigger value="tools">{t("settings.tabTools")}</TabsTrigger>
            <TabsTrigger value="advanced">
              {t("settings.tabAdvanced")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="account" className="space-y-4">
            <AccountTab
              auth={props.auth}
              online={online}
              initials={initials}
              onSignIn={props.onSignIn}
              onSignOut={props.onSignOut}
              onRefreshAuth={props.onRefreshAuth}
              onRunSetupAgain={props.onRunSetupAgain}
              onShowTour={props.onShowTour}
              onShowWhatsNew={props.onShowWhatsNew}
              usageSnapshot={props.usageSnapshot}
              onUsageChange={props.onUsageChange}
            />
          </TabsContent>

          <TabsContent value="preferences" className="space-y-4">
            <PreferencesTab
              models={props.models}
              defaultModel={props.defaultModel}
              onDefaultModel={props.onDefaultModel}
              bundledCount={bundledCount}
              approvalMode={props.approvalMode}
              onApprovalMode={props.onApprovalMode}
              requireSandboxForAutopilot={props.requireSandboxForAutopilot}
              onRequireSandboxForAutopilot={(enabled) => {
                void props
                  .onSettingsChange({ requireSandboxForAutopilot: enabled })
                  .catch((e: unknown) =>
                    showConnectorError(humanizeError(e, t)),
                  );
              }}
              preferProviderEngine={props.preferProviderEngine}
              onPreferProviderEngine={(enabled) => {
                // App onSettingsChange toasts success; only surface errors here.
                void props
                  .onSettingsChange({ preferProviderEngine: enabled })
                  .catch((e: unknown) =>
                    showConnectorError(
                      humanizeError(e, t),
                    ),
                  );
              }}
              inheritUserGrok={props.inheritUserGrok}
              onInheritUserGrok={(enabled) => {
                void props
                  .onSettingsChange({ inheritUserGrok: enabled })
                  .catch((e: unknown) =>
                    showConnectorError(humanizeError(e, t)),
                  );
              }}
              trustedFolders={props.trustedFolders}
              onUntrustFolder={props.onUntrustFolder}
            />
          </TabsContent>

          <TabsContent value="permissions" className="space-y-4">
            <PermissionsTab />
          </TabsContent>

          <TabsContent value="tools" className="space-y-4">
            <ToolsTab
              mcpServers={props.mcpServers}
              skillsPaths={props.skillsPaths}
              effectiveSkillsPaths={props.effectiveSkillsPaths}
              bundledCount={bundledCount}
              presets={presets}
              presetsLoading={presetsLoading}
              presetsError={presetsError}
              connectorQuery={connectorQuery}
              onConnectorQueryChange={setConnectorQuery}
              connectorCategory={connectorCategory}
              onConnectorCategoryChange={setConnectorCategory}
              hideAuthRequired={hideAuthRequired}
              onHideAuthRequiredChange={setHideAuthRequired}
              enabledOnly={enabledOnly}
              onEnabledOnlyChange={setEnabledOnly}
              filteredPresets={filteredPresets}
              selectedPreset={selectedPreset}
              onSelectPreset={setSelectedPresetId}
              onLoadPresets={() => void loadPresets()}
              onEnablePreset={(id) => void enablePreset(id)}
              onDisablePreset={(id) => void disablePreset(id)}
              onEnableRecommended={() => void enableRecommended()}
              credDrafts={credDrafts}
              credEditing={credEditing}
              onCredFieldChange={setDraftField}
              onStartCredEdit={(id) =>
                setCredEditing((prev) => ({ ...prev, [id]: true }))
              }
              onCancelCredEdit={(id) => clearDraft(id)}
              hasConfiguredCredentials={(row, names) =>
                hasConfiguredCredentials(row, names)
              }
              listPlaceholders={listPresetEnvPlaceholders}
              onClearFilters={() => {
                setConnectorQuery("");
                setConnectorCategory("all");
                setHideAuthRequired(false);
                setEnabledOnly(false);
              }}
              mcpId={mcpId}
              onMcpIdChange={setMcpId}
              mcpCmd={mcpCmd}
              onMcpCmdChange={setMcpCmd}
              mcpArgs={mcpArgs}
              onMcpArgsChange={setMcpArgs}
              onAddMcp={() => void addMcp()}
              skillPath={skillPath}
              onSkillPathChange={setSkillPath}
              onBrowseSkill={() =>
                void pickDirectory().then((p) => {
                  if (p) setSkillPath(p);
                })
              }
              onAddSkill={() => {
                const p = skillPath.trim();
                if (!p || props.skillsPaths.includes(p)) return;
                void props
                  .onSettingsChange({
                    mcpServers: props.mcpServers,
                    skillsPaths: [...props.skillsPaths, p],
                  })
                  .then(() => {
                    setSkillPath("");
                    showConnectorOk(t("settings.savedApplied"));
                  })
                  .catch((e: unknown) =>
                    showConnectorError(
                      humanizeError(e, t),
                    ),
                  );
              }}
              onRemoveSkill={(path) =>
                void props
                  .onSettingsChange({
                    mcpServers: props.mcpServers,
                    skillsPaths: props.skillsPaths.filter((x) => x !== path),
                  })
                  .then(() => showConnectorOk(t("settings.savedApplied")))
                  .catch((e: unknown) =>
                    showConnectorError(
                      humanizeError(e, t),
                    ),
                  )
              }
              onToggleMcpEnabled={(id) =>
                void props
                  .onSettingsChange({
                    mcpServers: props.mcpServers.map((x) =>
                      x.id === id ? { ...x, enabled: !x.enabled } : x,
                    ),
                    skillsPaths: props.skillsPaths,
                  })
                  .then(() => showConnectorOk(t("settings.savedApplied")))
                  .catch((e: unknown) =>
                    showConnectorError(
                      humanizeError(e, t),
                    ),
                  )
              }
              showConnectorOk={showConnectorOk}
              showConnectorError={showConnectorError}
            />
          </TabsContent>

          <TabsContent value="advanced" className="space-y-6">
            <RuntimeUpdatesTab />
            {GROKDESK_REMOTE_UI_ENABLED ? <RemoteTab /> : null}
          </TabsContent>
        </Tabs>
      </div>
    </ScrollArea>
  );
}
