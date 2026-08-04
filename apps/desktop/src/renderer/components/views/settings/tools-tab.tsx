import { useState } from "react";
import {
  Box,
  ChevronRight,
  Cloud,
  Code2,
  Database,
  FileText,
  Globe,
  HardDrive,
  Mail,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
  Star,
  Wrench,
} from "lucide-react";
import { pickNextConnector } from "@/lib/connector-next";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { SettingsInfoRow } from "./settings-row";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CONNECTOR_CATEGORIES,
  type ConnectorCategory,
  type ConnectorPreset as SharedConnectorPreset,
} from "@grokdesk/shared";
import { useT } from "@/i18n";
import { localizeCategoryLabel } from "@/i18n/localize-connector";
import type { McpRow } from "./types";
import { cn } from "@/lib/utils";

type ConnectorPreset = SharedConnectorPreset;

function connectorIcon(category: string) {
  const c = category.toLowerCase();
  if (c.includes("file") || c.includes("local")) return HardDrive;
  if (c.includes("web") || c.includes("browser") || c.includes("search"))
    return Globe;
  if (c.includes("data") || c.includes("db") || c.includes("sql"))
    return Database;
  if (c.includes("mail") || c.includes("email")) return Mail;
  if (c.includes("chat") || c.includes("message") || c.includes("slack"))
    return MessageSquare;
  if (c.includes("cloud") || c.includes("storage")) return Cloud;
  if (c.includes("code") || c.includes("dev") || c.includes("git"))
    return Code2;
  if (c.includes("doc") || c.includes("note")) return FileText;
  if (c.includes("tool") || c.includes("util")) return Wrench;
  return Box;
}

export function ToolsTab(props: {
  mcpServers: McpRow[];
  skillsPaths: string[];
  effectiveSkillsPaths?: string[];
  bundledCount: number;
  presets: ConnectorPreset[];
  presetsLoading: boolean;
  presetsError: string | null;
  connectorQuery: string;
  onConnectorQueryChange: (v: string) => void;
  connectorCategory: ConnectorCategory | "all" | "recommended";
  onConnectorCategoryChange: (
    v: ConnectorCategory | "all" | "recommended",
  ) => void;
  hideAuthRequired: boolean;
  onHideAuthRequiredChange: (v: boolean) => void;
  enabledOnly: boolean;
  onEnabledOnlyChange: (v: boolean) => void;
  filteredPresets: ConnectorPreset[];
  selectedPreset: ConnectorPreset | null;
  onSelectPreset: (id: string) => void;
  onLoadPresets: () => void;
  onEnablePreset: (presetId: string) => void;
  onDisablePreset: (presetId: string) => void;
  onEnableRecommended: () => void;
  credDrafts: Record<string, Record<string, string>>;
  credEditing: Record<string, boolean>;
  onCredFieldChange: (presetId: string, name: string, value: string) => void;
  onStartCredEdit: (presetId: string) => void;
  onCancelCredEdit: (presetId: string) => void;
  hasConfiguredCredentials: (
    row: McpRow | undefined,
    names: string[],
  ) => boolean;
  listPlaceholders: (preset: ConnectorPreset) => string[];
  onClearFilters: () => void;
  mcpId: string;
  onMcpIdChange: (v: string) => void;
  mcpCmd: string;
  onMcpCmdChange: (v: string) => void;
  mcpArgs: string;
  onMcpArgsChange: (v: string) => void;
  onAddMcp: () => void;
  skillPath: string;
  onSkillPathChange: (v: string) => void;
  onBrowseSkill: () => void;
  onAddSkill: () => void;
  onRemoveSkill: (path: string) => void;
  onToggleMcpEnabled: (id: string) => void;
  showConnectorOk: (message: string) => void;
  showConnectorError: (message: string) => void;
}) {
  const t = useT();
  const selectedPreset = props.selectedPreset;
  const [surface, setSurface] = useState<"gallery" | "installed">("gallery");
  const [detailOpen, setDetailOpen] = useState(false);
  const [addCustomOpen, setAddCustomOpen] = useState(false);

  const openDetail = (id: string) => {
    props.onSelectPreset(id);
    setDetailOpen(true);
  };

  const enabledFor = (p: ConnectorPreset) =>
    props.mcpServers.some((m) => m.id === p.serverId && m.enabled);

  return (
    <div className="space-y-6">
      {/* Health strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.activeMcp")}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {props.mcpServers.filter((m) => m.enabled).length}
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.gallery")}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {props.filteredPresets.length}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              / {props.presets.length}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 px-4 py-3">
          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("settings.bundledSkillsStat", { n: props.bundledCount })}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {props.bundledCount}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/20 p-0.5">
          <button
            type="button"
            onClick={() => setSurface("gallery")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              surface === "gallery"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("settings.gallery")}
          </button>
          <button
            type="button"
            onClick={() => setSurface("installed")}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              surface === "installed"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("settings.installed")}
          </button>
        </div>
        {surface === "gallery" && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void props.onEnableRecommended()}
          >
            <Star className="h-3.5 w-3.5" />
            {t("settings.enableRecommended")}
          </Button>
        )}
      </div>

      <div className="space-y-4">
        {/* Gallery: full-width list + detail modal */}
        <div className={cn(surface !== "gallery" && "hidden")}>
          <div className="space-y-3 rounded-xl border border-border/70 bg-card/30 p-4 sm:p-5">
            <div>
              <h3 className="flex items-center gap-2 text-md font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />
                {t("settings.connectors")}
              </h3>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {t("settings.connectorsDesc")}
              </p>
            </div>

            {(() => {
              const next = pickNextConnector({
                catalog: props.presets.map((p) => ({
                  id: p.id,
                  name: p.name,
                  category: p.category,
                  recommended: p.recommended,
                  needsCredentials: Boolean(
                    (p as { requiredEnv?: string[] }).requiredEnv?.length,
                  ),
                  description: p.description,
                })),
                enabledIds: props.mcpServers
                  .filter((s) => s.enabled)
                  .map((s) => s.id),
              });
              if (!next) return null;
              return (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/[0.06] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground">
                      {t("home.discoveryTitle")}: {next.name}
                    </div>
                    <div className="text-2xs text-muted-foreground">
                      {next.reason}
                      {next.needsCredentials
                        ? " · API key required"
                        : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={() => props.onSelectPreset(next.presetId)}
                  >
                    {next.name}
                  </Button>
                </div>
              );
            })()}

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9"
                placeholder={t("settings.searchConnectors")}
                value={props.connectorQuery}
                onChange={(e) => props.onConnectorQueryChange(e.target.value)}
              />
            </div>

            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {CONNECTOR_CATEGORIES.map((c) => {
                const active = props.connectorCategory === c.id;
                const loc = localizeCategoryLabel(c.id, t);
                return (
                  <button
                    key={c.id}
                    type="button"
                    title={loc.description || c.description}
                    onClick={() => props.onConnectorCategoryChange(c.id)}
                    className={cn(
                      "shrink-0 rounded-full border px-2.5 py-1 text-2xs transition-colors",
                      active
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-border/70 text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    {loc.label}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
              <label className="flex items-center gap-2">
                <Switch
                  checked={props.hideAuthRequired}
                  onCheckedChange={props.onHideAuthRequiredChange}
                  aria-label={t("settings.hideAuth")}
                />
                {t("settings.hideAuth")}
              </label>
              <label className="flex items-center gap-2">
                <Switch
                  checked={props.enabledOnly}
                  onCheckedChange={props.onEnabledOnlyChange}
                  aria-label={t("settings.enabledOnly")}
                />
                {t("settings.enabledOnly")}
              </label>
            </div>

            {props.presetsLoading ? (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/60 py-12">
                <Spinner size="md" />
                <p className="text-sm text-muted-foreground">
                  {t("settings.loadingPresets")}
                </p>
              </div>
            ) : props.presetsError && props.presets.length === 0 ? (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-destructive/30 bg-destructive/5 py-10 px-4 text-center">
                <p className="max-w-md text-sm text-destructive-text">
                  {props.presetsError}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void props.onLoadPresets()}
                >
                  {t("settings.retry")}
                </Button>
              </div>
            ) : props.filteredPresets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
                {t("settings.noConnectorsMatch")}{" "}
                <button
                  type="button"
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={props.onClearFilters}
                >
                  {t("settings.clearFilters")}
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
                {props.filteredPresets.map((p) => {
                  const enabled = enabledFor(p);
                  const Icon = connectorIcon(p.category);
                  const cat = localizeCategoryLabel(p.category, t);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => openDetail(p.id)}
                        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/25 text-muted-foreground">
                          <Icon className="h-5 w-5" strokeWidth={1.75} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-medium text-foreground">
                              {p.name}
                            </span>
                            {enabled && (
                              <Badge className="bg-success/15 text-2xs font-normal text-success">
                                {t("settings.on")}
                              </Badge>
                            )}
                            {p.recommended && (
                              <Badge className="bg-warning/15 text-2xs font-normal text-warning">
                                {t("settings.recommended")}
                              </Badge>
                            )}
                            {p.requiresAuth && !enabled && (
                              <Badge
                                variant="outline"
                                className="text-2xs font-normal"
                              >
                                {t("settings.apiKey")}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
                            {p.description}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 text-2xs capitalize text-muted-foreground/90">
                              {cat.label}
                            </span>
                            {p.runtime && (
                              <span className="rounded-md bg-white/[0.04] px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                                {p.runtime}
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Detail modal */}
          <Dialog
            open={detailOpen && Boolean(selectedPreset)}
            onOpenChange={(open) => {
              setDetailOpen(open);
              if (!open) props.onCancelCredEdit(selectedPreset?.id ?? "");
            }}
          >
            <DialogContent className="max-h-[min(90vh,720px)] max-w-lg gap-0 overflow-hidden p-0">
              {selectedPreset && (
                <>
                  <DialogHeader className="space-y-2 border-b border-border/60 px-6 py-5 text-left">
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/30 text-muted-foreground">
                        {(() => {
                          const Icon = connectorIcon(selectedPreset.category);
                          return (
                            <Icon className="h-5 w-5" strokeWidth={1.75} />
                          );
                        })()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <DialogTitle className="text-lg leading-tight">
                          {selectedPreset.name}
                        </DialogTitle>
                        <DialogDescription className="mt-1">
                          {selectedPreset.category}
                          {selectedPreset.requiresAuth
                            ? ` · ${t("settings.needsCredentials")}`
                            : ` · ${t("settings.noAuth")}`}
                          {selectedPreset.runtime
                            ? ` · ${selectedPreset.runtime}`
                            : ""}
                        </DialogDescription>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {enabledFor(selectedPreset) && (
                            <Badge className="bg-success/15 text-success">
                              {t("settings.on")}
                            </Badge>
                          )}
                          {selectedPreset.recommended && (
                            <Badge className="bg-warning/15 text-warning">
                              {t("settings.recommended")}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </DialogHeader>

                  <div className="max-h-[min(50vh,420px)] space-y-4 overflow-y-auto px-6 py-4">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {selectedPreset.longDescription ||
                        selectedPreset.description}
                    </p>
                    {selectedPreset.capabilities?.length > 0 && (
                      <div>
                        <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                          {t("settings.whatYouGet")}
                        </div>
                        <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-foreground/90">
                          {selectedPreset.capabilities.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {selectedPreset.setupNotes && (
                      <div className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                        {selectedPreset.setupNotes}
                      </div>
                    )}
                    {(() => {
                      const placeholders =
                        props.listPlaceholders(selectedPreset);
                      if (placeholders.length === 0) return null;
                      const row = props.mcpServers.find(
                        (m) => m.id === selectedPreset.serverId,
                      );
                      const configured = props.hasConfiguredCredentials(
                        row,
                        placeholders,
                      );
                      const editing =
                        props.credEditing[selectedPreset.id] === true ||
                        !configured;
                      if (configured && !editing) {
                        return (
                          <div className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
                            <span className="text-xs font-medium text-success">
                              {t("settings.credentialsConfigured")}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-2xs"
                              onClick={() =>
                                props.onStartCredEdit(selectedPreset.id)
                              }
                            >
                              {t("settings.editCredentials")}
                            </Button>
                          </div>
                        );
                      }
                      const draft = props.credDrafts[selectedPreset.id] ?? {};
                      return (
                        <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/15 px-3 py-3">
                          <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                            {t("settings.credentialFields")}
                          </div>
                          {placeholders.map((name) => (
                            <div key={name} className="space-y-1">
                              <Label className="font-mono text-2xs">
                                {t("settings.credentialVarLabel", { name })}
                              </Label>
                              <Input
                                type="password"
                                autoComplete="off"
                                placeholder={t(
                                  "settings.credentialPlaceholder",
                                )}
                                value={draft[name] ?? ""}
                                onChange={(e) =>
                                  props.onCredFieldChange(
                                    selectedPreset.id,
                                    name,
                                    e.target.value,
                                  )
                                }
                                className="h-9 font-mono text-xs"
                              />
                            </div>
                          ))}
                          {configured && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-2xs"
                              onClick={() =>
                                props.onCancelCredEdit(selectedPreset.id)
                              }
                            >
                              {t("nav.cancel")}
                            </Button>
                          )}
                        </div>
                      );
                    })()}
                  </div>

                  <DialogFooter className="border-t border-border/60 px-6 py-4 sm:justify-between">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setDetailOpen(false)}
                    >
                      {t("nav.cancel")}
                    </Button>
                    <Button
                      type="button"
                      variant={
                        enabledFor(selectedPreset) ? "outline" : "default"
                      }
                      onClick={() => {
                        const on = enabledFor(selectedPreset);
                        const placeholders =
                          props.listPlaceholders(selectedPreset);
                        const row = props.mcpServers.find(
                          (m) => m.id === selectedPreset.serverId,
                        );
                        const configured = props.hasConfiguredCredentials(
                          row,
                          placeholders,
                        );
                        const editing =
                          props.credEditing[selectedPreset.id] === true;
                        if (on && configured && !editing) {
                          void props.onDisablePreset(selectedPreset.id);
                          return;
                        }
                        void props.onEnablePreset(selectedPreset.id);
                      }}
                    >
                      {(() => {
                        const on = enabledFor(selectedPreset);
                        const placeholders =
                          props.listPlaceholders(selectedPreset);
                        const row = props.mcpServers.find(
                          (m) => m.id === selectedPreset.serverId,
                        );
                        const configured = props.hasConfiguredCredentials(
                          row,
                          placeholders,
                        );
                        const editing =
                          props.credEditing[selectedPreset.id] === true;
                        if (on && configured && editing) {
                          return t("settings.saveCredentials");
                        }
                        if (on && configured) {
                          return t("settings.disableConnector");
                        }
                        if (on && placeholders.length > 0) {
                          return t("settings.saveCredentials");
                        }
                        return on
                          ? t("settings.disableConnector")
                          : t("settings.enableConnector");
                      })()}
                    </Button>
                  </DialogFooter>
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>

        <Card
          className={cn(
            "border-border/70",
            surface !== "installed" && "hidden",
          )}
        >
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">
                {t("settings.activeMcp")}
              </CardTitle>
              <CardDescription>
                {t("settings.activeMcpDesc")}
              </CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                props.onMcpIdChange("");
                props.onMcpCmdChange("");
                props.onMcpArgsChange("");
                setAddCustomOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" />
              {t("settings.addCustom")}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {props.mcpServers.length === 0 ? (
              <EmptyState
                icon={<Wrench className="h-5 w-5" />}
                title={t("settings.noMcpYet")}
                description={t("settings.noMcpYetDesc")}
                actionLabel={t("settings.addCustom")}
                onAction={() => {
                  props.onMcpIdChange("");
                  props.onMcpCmdChange("");
                  props.onMcpArgsChange("");
                  setAddCustomOpen(true);
                }}
                className="py-8 sm:py-10"
              />
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("settings.name")}</TableHead>
                      <TableHead>{t("settings.command")}</TableHead>
                      <TableHead>{t("settings.status")}</TableHead>
                      <TableHead>{t("settings.on")}</TableHead>
                      <TableHead className="w-[1%]">{t("settings.credentialFields")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {props.mcpServers.map((m) => {
                      const preset = props.presets.find(
                        (p) => p.serverId === m.id,
                      );
                      const placeholders = preset
                        ? props.listPlaceholders(preset)
                        : m.env
                          ? Object.keys(m.env)
                          : [];
                      const configured =
                        placeholders.length > 0 &&
                        props.hasConfiguredCredentials(m, placeholders);
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium">{m.id}</TableCell>
                          <TableCell className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">
                            {m.command} {m.args.join(" ")}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={
                                m.enabled
                                  ? "bg-success/15 text-success"
                                  : ""
                              }
                            >
                              {m.enabled
                                ? t("settings.enabled")
                                : t("common.off")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Switch
                              checked={m.enabled}
                              onCheckedChange={() =>
                                props.onToggleMcpEnabled(m.id)
                              }
                              aria-label={t("settings.mcpToggleFor", {
                                name: m.id,
                              })}
                            />
                          </TableCell>
                          <TableCell>
                            {placeholders.length > 0 && preset ? (
                              <div className="flex flex-col items-start gap-1">
                                {configured && (
                                  <span className="text-2xs text-success">
                                    {t("settings.credentialsConfigured")}
                                  </span>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-2xs"
                                  onClick={() => {
                                    props.onSelectPreset(preset.id);
                                    props.onStartCredEdit(preset.id);
                                  }}
                                >
                                  {configured
                                    ? t("settings.editCredentials")
                                    : t("settings.credentialFields")}
                                </Button>
                              </div>
                            ) : (
                              <span className="text-2xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* SC-7: Add custom MCP in a dialog with empty defaults */}
        <Dialog open={addCustomOpen} onOpenChange={setAddCustomOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("settings.addCustom")}</DialogTitle>
              <DialogDescription>
                {t("settings.addCustomDesc")}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="space-y-1.5">
                <Label>{t("settings.id")}</Label>
                <Input
                  value={props.mcpId}
                  onChange={(e) => props.onMcpIdChange(e.target.value)}
                  placeholder={t("settings.idPlaceholder")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.command")}</Label>
                <Input
                  value={props.mcpCmd}
                  onChange={(e) => props.onMcpCmdChange(e.target.value)}
                  placeholder="npx"
                  className="font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("settings.args")}</Label>
                <Input
                  value={props.mcpArgs}
                  onChange={(e) => props.onMcpArgsChange(e.target.value)}
                  placeholder="-y package-name"
                  className="font-mono"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setAddCustomOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                disabled={!props.mcpId.trim() || !props.mcpCmd.trim()}
                onClick={() => {
                  void props.onAddMcp();
                  setAddCustomOpen(false);
                }}
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Card
          className={cn(
            "border-border/70",
            surface !== "installed" && "hidden",
          )}
        >
          <CardHeader>
            <CardTitle className="text-base">
              {t("settings.skillsFolders")}
            </CardTitle>
            <CardDescription>{t("settings.skillsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
              {t("settings.bundledOn")}
              {props.effectiveSkillsPaths?.[0]
                ? ` (${props.effectiveSkillsPaths[0]})`
                : ""}
              .
            </div>
            {props.skillsPaths.length === 0 ? (
              <EmptyState
                icon={<Sparkles className="h-5 w-5" />}
                title={t("settings.noExtraSkills")}
                className="py-6 sm:py-8"
              />
            ) : (
              <ul className="space-y-2">
                {props.skillsPaths.map((p) => (
                  <li
                    key={p}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="truncate font-mono text-xs">{p}</span>
                    <Badge
                      variant="secondary"
                      className="bg-success/15 text-success"
                    >
                      {t("settings.configured")}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => props.onRemoveSkill(p)}
                    >
                      {t("common.remove")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Input
                placeholder={t("settings.skillPathPlaceholder")}
                value={props.skillPath}
                onChange={(e) => props.onSkillPathChange(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void props.onBrowseSkill()}
              >
                {t("settings.browse")}
              </Button>
              <Button size="sm" onClick={() => props.onAddSkill()}>
                {t("settings.add")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card
          className={cn(
            "border-border/70",
            surface !== "installed" && "hidden",
          )}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {t("settings.localPerms")}
            </CardTitle>
            <CardDescription>{t("settings.localPermsDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-0.5">
            <SettingsInfoRow
              label={t("settings.filesystem")}
              value={t("settings.policyGated")}
            />
            <SettingsInfoRow
              label={t("settings.network")}
              value={t("settings.policyGated")}
            />
            <SettingsInfoRow
              label={t("settings.shell")}
              value={t("settings.askFirst")}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
