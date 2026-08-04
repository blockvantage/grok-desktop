import { CalendarClock, FolderOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/empty-state";
import { getCronPresets, describeCron } from "@/lib/labels";
import { shortPath } from "@/lib/format";
import { cn } from "@/lib/utils";
import { seedScheduleFormGoal } from "@/lib/imagine-schedule-nav";
import type { ScheduleRule } from "@grokdesk/shared";
import { useT } from "@/i18n";
import { useEffect, useMemo, useState } from "react";

export function ScheduledView(props: {
  schedules: ScheduleRule[];
  root: string;
  models: string[];
  onPickRoot: () => void;
  onCreate: (input: {
    name: string;
    goal: string;
    cron: string;
    model: string;
  }) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onError: (msg: string) => void;
  /**
   * Phase 3 / workspace handoff: expanded goal draft from Schedule intent
   * or "Run on a schedule". Seeds the create form; does not auto-submit.
   */
  initialGoal?: string | null;
  /** Called once after a non-empty initialGoal is applied to the form. */
  onInitialGoalConsumed?: () => void;
}) {
  const t = useT();
  const cronPresets = useMemo(() => getCronPresets(), [t]);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState(() =>
    seedScheduleFormGoal(props.initialGoal),
  );
  const [cron, setCron] = useState(() => getCronPresets()[0]!.cron);
  const [model, setModel] = useState(props.models[0] ?? "grok-4.5");

  // Apply draft when parent navigates here with a schedule intent / handoff.
  useEffect(() => {
    const seeded = seedScheduleFormGoal(props.initialGoal);
    if (!seeded) return;
    setGoal(seeded);
    props.onInitialGoalConsumed?.();
    // Only re-seed when the draft string identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [props.initialGoal]);

  // Simple week heatmap dots from schedule count (honest: distribution by cron day field)
  const heat = buildHeat(props.schedules);

  return (
    <div className="flex min-h-0 flex-1">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-6 px-8 py-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("scheduled.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("scheduled.subtitle")}
            </p>
          </div>

          <Card className="border-border/70 surface-raised">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {t("scheduled.createTitle")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("scheduled.createDesc")}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>{t("scheduled.name")}</Label>
                  <Input
                    placeholder={t("scheduled.name")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{t("scheduled.goal")}</Label>
                  <Input
                    placeholder={t("scheduled.goalPlaceholder")}
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    data-testid="scheduled-goal-input"
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label>{t("scheduled.cadence")}</Label>
                  <Select value={cron} onValueChange={setCron}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {cronPresets.map((p) => (
                        <SelectItem key={p.cron} value={p.cron}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("scheduled.workspaceFolder")}</Label>
                  <Button
                    variant="outline"
                    className="h-9 w-full justify-start font-normal"
                    onClick={props.onPickRoot}
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {props.root ? shortPath(props.root) : t("scheduled.pickFolder")}
                  </Button>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("home.model")}</Label>
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {props.models.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button
                    className="w-full"
                    disabled={!name.trim() || !goal.trim()}
                    onClick={() => {
                      if (!props.root) {
                        props.onError(
                          t("scheduled.chooseFolderFirst"),
                        );
                        return;
                      }
                      props.onCreate({
                        name: name.trim(),
                        goal: goal.trim(),
                        cron,
                        model,
                      });
                      setName("");
                      setGoal("");
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    {t("scheduled.createSchedule")}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="mr-1 self-center text-2xs text-muted-foreground">
                  {t("scheduled.smartPresets")}
                </span>
                {cronPresets.map((p) => (
                  <Button
                    key={p.cron}
                    size="sm"
                    variant={cron === p.cron ? "default" : "outline"}
                    className="h-7 rounded-full text-xs"
                    onClick={() => setCron(p.cron)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {t("scheduled.overview")}
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                {t("scheduled.overviewDesc")}
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <div className="grid grid-cols-[40px_repeat(24,minmax(0,1fr))] gap-1 text-2xs text-muted-foreground">
                  <div />
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="text-center">
                      {h % 4 === 0 ? `${h}` : ""}
                    </div>
                  ))}
                  {(
                    [
                      "scheduled.dayMon",
                      "scheduled.dayTue",
                      "scheduled.dayWed",
                      "scheduled.dayThu",
                      "scheduled.dayFri",
                      "scheduled.daySat",
                      "scheduled.daySun",
                    ] as const
                  ).map((dayKey, di) => (
                    <div key={dayKey} className="contents">
                      <div className="py-0.5">{t(dayKey)}</div>
                      {Array.from({ length: 24 }, (_, h) => {
                        const v = heat[di]?.[h] ?? 0;
                        return (
                          <div
                            key={`${dayKey}-${h}`}
                            className={cn(
                              "h-3 rounded-sm transition-colors duration-150 ease-premium",
                              v === 0 && "bg-muted/40",
                              v === 1 && "bg-primary/30",
                              v === 2 && "bg-primary/55",
                              v >= 3 && "bg-primary/80",
                            )}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/70">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-base">
                {t("scheduled.activeSchedules")}
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {props.schedules.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {props.schedules.length === 0 ? (
                <EmptyState
                  icon={
                    <CalendarClock className="h-5 w-5" strokeWidth={1.75} />
                  }
                  title={t("scheduled.emptyTitle")}
                  description={t("scheduled.emptyDesc")}
                  className="py-8"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("scheduled.colSchedule")}</TableHead>
                      <TableHead>{t("scheduled.colCadence")}</TableHead>
                      <TableHead>{t("scheduled.colWorkspace")}</TableHead>
                      <TableHead>{t("scheduled.colStatus")}</TableHead>
                      <TableHead className="w-[52px]">
                        <span className="sr-only">{t("scheduled.delete")}</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {props.schedules.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="font-medium">{s.name}</div>
                          <div className="line-clamp-1 text-xs text-muted-foreground">
                            {s.goalTemplate}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {describeCron(s.cron)}
                        </TableCell>
                        <TableCell className="max-w-[140px] truncate font-mono text-xs text-muted-foreground">
                          {s.workspaceRoots[0]
                            ? shortPath(s.workspaceRoots[0])
                            : t("scheduled.noFolder")}
                        </TableCell>
                        <TableCell>
                          <Switch
                            checked={s.enabled}
                            onCheckedChange={(en) => props.onToggle(s.id, en)}
                            aria-label={t("scheduled.toggleFor", {
                              name: s.name,
                            })}
                          />
                        </TableCell>
                        {/* SC-15: no row menu — the Switch and this destructive
                            confirm are the only two row actions. */}
                        <TableCell className="w-[52px] text-right">
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                aria-label={t("scheduled.delete")}
                                data-schedule-delete={s.id}
                              >
                                <Trash2
                                  className="h-4 w-4"
                                  strokeWidth={1.75}
                                />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  {t("scheduled.deleteConfirmTitle", {
                                    name: s.name,
                                  })}
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("scheduled.deleteConfirmBody")}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>
                                  {t("common.cancel")}
                                </AlertDialogCancel>
                                <AlertDialogAction
                                  variant="destructive"
                                  onClick={() => props.onDelete(s.id)}
                                >
                                  {t("scheduled.deleteConfirm")}
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>

      <aside className="hidden w-[280px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/70 bg-muted/10 p-4 xl:flex">
        <Card className="border-border/70 shadow-none">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">
              {t("scheduled.upcomingRuns")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-4">
            {props.schedules.filter((s) => s.enabled).length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("scheduled.upcomingEmpty")}
              </p>
            ) : (
              props.schedules
                .filter((s) => s.enabled)
                .slice(0, 5)
                .map((s) => (
                  <div key={s.id} className="text-xs">
                    <div className="font-medium text-foreground/90">
                      {s.name}
                    </div>
                    <div className="text-muted-foreground">
                      {describeCron(s.cron)}
                    </div>
                  </div>
                ))
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-none">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="h-3.5 w-3.5" />
              {t("scheduled.automationHealth")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-muted-foreground">
            <div className="text-2xl font-semibold text-foreground">
              {t("scheduled.activeCount", {
                n: props.schedules.filter((s) => s.enabled).length,
              })}
            </div>
            <p className="mt-1">
              {t("scheduled.healthSummary", {
                total: props.schedules.length,
                paused: props.schedules.filter((s) => !s.enabled).length,
              })}
            </p>
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function buildHeat(schedules: ScheduleRule[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const s of schedules) {
    if (!s.enabled) continue;
    const parts = s.cron.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const hour = parts[1] === "*" ? null : Number(parts[1]);
    const dow = parts[4];
    const days: number[] = [];
    if (dow === "*") days.push(0, 1, 2, 3, 4, 5, 6);
    else if (dow === "1-5") days.push(0, 1, 2, 3, 4);
    else {
      for (const d of dow.split(",")) {
        const n = Number(d);
        if (!Number.isNaN(n)) days.push((n + 6) % 7); // cron 0=Sun -> Mon-first
      }
    }
    for (const di of days) {
      if (hour == null || Number.isNaN(hour)) {
        for (let h = 0; h < 24; h++) grid[di]![h]! += 1;
      } else if (hour >= 0 && hour < 24) {
        grid[di]![hour]! += 1;
      }
    }
  }
  return grid;
}
