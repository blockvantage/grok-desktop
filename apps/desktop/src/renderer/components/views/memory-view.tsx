import { useState } from "react";
import {
  Check,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MemoryItem } from "@grokdesk/shared";
import type { MemorySuggestion } from "@/lib/memory-suggestions";
import { useT } from "@/i18n";

const KIND_VALUES = [
  "brand",
  "standing",
  "project",
  "preference",
  "now",
  "profile",
] as const;

const KIND_LABEL_KEYS: Record<(typeof KIND_VALUES)[number], string> = {
  brand: "memory.kindBrand",
  standing: "memory.kindStanding",
  project: "memory.kindProject",
  preference: "memory.kindPreference",
  now: "memory.kindNow",
  profile: "memory.kindProfile",
};

export function MemoryView(props: {
  memories: MemoryItem[];
  /** Phase 3 review queue — never auto-committed. */
  suggestions?: MemorySuggestion[];
  onSave: (input: {
    kind: string;
    title: string;
    content: string;
  }) => Promise<void>;
  onDelete: (id: string) => void;
  onApproveSuggestion?: (
    id: string,
    patch?: { title?: string; content?: string },
  ) => void | Promise<void>;
  onEditSuggestion?: (
    id: string,
    patch: { title?: string; content?: string },
  ) => void;
  onDismissSuggestion?: (id: string) => void;
}) {
  const t = useT();
  const [kindFilter, setKindFilter] = useState("all");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [kind, setKind] = useState("brand");
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const suggestions = props.suggestions ?? [];

  // Text search is applied upstream via topbar + filterMemoriesBySearch.
  const filtered = props.memories.filter((m) => {
    if (kindFilter !== "all" && m.kind !== kindFilter) return false;
    return true;
  });

  return (
    <div className="flex min-h-0 flex-1">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-3xl space-y-5 px-8 py-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{t("memory.title")}</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("memory.subtitle")}
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => setShowForm(true)}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5" />
              {t("memory.add")}
            </Button>
          </div>

          {/* Phase 3: reviewable takeaway suggestions (approve / edit / dismiss) */}
          <section
            className="space-y-3"
            data-testid="memory-suggestions"
            aria-label={t("memory.suggestionsTitle")}
          >
            <div>
              <h2 className="text-sm font-semibold tracking-tight">
                {t("memory.suggestionsTitle")}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("memory.suggestionsDesc")}
              </p>
            </div>
            {suggestions.length === 0 ? (
              <p
                className="rounded-lg border border-dashed border-white/[0.08] px-3 py-3 text-xs text-muted-foreground"
                data-testid="memory-suggestions-empty"
              >
                {t("memory.suggestionsEmpty")}
              </p>
            ) : (
              <div className="space-y-2">
                {suggestions.map((s) => {
                  const isEditing = editingId === s.id;
                  return (
                    <Card
                      key={s.id}
                      className="border-primary/25 bg-primary/[0.04] shadow-none"
                      data-testid={`memory-suggestion-${s.id}`}
                    >
                      <CardContent className="space-y-3 p-4">
                        {isEditing ? (
                          <>
                            <Input
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              aria-label={t("memory.titleField")}
                            />
                            <Textarea
                              value={editContent}
                              onChange={(e) => setEditContent(e.target.value)}
                              rows={4}
                              aria-label={t("memory.content")}
                            />
                            <div className="flex flex-wrap justify-end gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setEditingId(null)}
                              >
                                {t("memory.suggestionCancelEdit")}
                              </Button>
                              <Button
                                size="sm"
                                className="gap-1.5"
                                disabled={
                                  !editTitle.trim() || !editContent.trim()
                                }
                                onClick={() => {
                                  setEditingId(null);
                                  setApprovingId(s.id);
                                  void Promise.resolve(
                                    props.onApproveSuggestion?.(s.id, {
                                      title: editTitle.trim(),
                                      content: editContent.trim(),
                                    }),
                                  ).finally(() => setApprovingId(null));
                                }}
                              >
                                <Check className="h-3.5 w-3.5" />
                                {t("memory.suggestionSaveEdit")}
                              </Button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-medium">
                                  {s.title}
                                </div>
                                <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                                  {s.content}
                                </p>
                                {s.sensitiveHint ? (
                                  <p className="mt-2 text-2xs text-warning">
                                    {t("memory.suggestionSensitive")}
                                  </p>
                                ) : null}
                              </div>
                              <Badge
                                variant="secondary"
                                className="font-normal capitalize"
                              >
                                {s.kind}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                size="sm"
                                className="gap-1.5"
                                disabled={approvingId === s.id}
                                onClick={() => {
                                  setApprovingId(s.id);
                                  void Promise.resolve(
                                    props.onApproveSuggestion?.(s.id),
                                  ).finally(() => setApprovingId(null));
                                }}
                                data-testid={`memory-suggestion-approve-${s.id}`}
                              >
                                {approvingId === s.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Check className="h-3.5 w-3.5" />
                                )}
                                {t("memory.suggestionApprove")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                                onClick={() => {
                                  setEditingId(s.id);
                                  setEditTitle(s.title);
                                  setEditContent(s.content);
                                }}
                                data-testid={`memory-suggestion-edit-${s.id}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {t("memory.suggestionEdit")}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="gap-1.5"
                                onClick={() =>
                                  props.onDismissSuggestion?.(s.id)
                                }
                                data-testid={`memory-suggestion-dismiss-${s.id}`}
                              >
                                <X className="h-3.5 w-3.5" />
                                {t("memory.suggestionDismiss")}
                              </Button>
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </section>

{showForm && (
            <Card className="border-border/70 surface-raised">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t("memory.addNew")}</CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t("memory.addDesc")}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
                  <div className="space-y-1.5">
                    <Label>{t("memory.kind")}</Label>
                    <Select value={kind} onValueChange={setKind}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KIND_VALUES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(KIND_LABEL_KEYS[value])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>{t("memory.titleField")}</Label>
                    <Input
                      placeholder={t("memory.titlePlaceholder")}
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("memory.content")}</Label>
                  <Textarea
                    placeholder={t("memory.contentPlaceholder")}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={4}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowForm(false)}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="sm"
                    disabled={saving || !title.trim() || !content.trim()}
                    onClick={() => {
                      setSaving(true);
                      void props
                        .onSave({
                          kind,
                          title: title.trim(),
                          content: content.trim(),
                        })
                        .then(() => {
                          setTitle("");
                          setContent("");
                        })
                        .finally(() => setSaving(false));
                    }}
                  >
                    {saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t("memory.save")
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {/* Search is owned by the shell topbar (view-search-policy); list is pre-filtered. */}
            <div className="flex flex-wrap gap-1">
              <Chip
                active={kindFilter === "all"}
                onClick={() => setKindFilter("all")}
              >
                {t("memory.kindAll")}
              </Chip>
              {KIND_VALUES.slice(0, 5).map((value) => (
                <Chip
                  key={value}
                  active={kindFilter === value}
                  onClick={() => setKindFilter(value)}
                >
                  {t(KIND_LABEL_KEYS[value])}
                </Chip>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {filtered.length === 0 ? (
              <EmptyState
                icon={<Star className="h-5 w-5" strokeWidth={1.75} />}
                title={
                  props.memories.length === 0
                    ? t("memory.emptyTitle")
                    : t("memory.emptyList")
                }
                description={
                  props.memories.length === 0
                    ? suggestions.length > 0
                      ? t("memory.emptyWithSuggestions")
                      : t("memory.emptyDesc")
                    : undefined
                }
                actionLabel={
                  props.memories.length === 0 && suggestions.length === 0
                    ? t("memory.emptyAction")
                    : undefined
                }
                onAction={
                  props.memories.length === 0 && suggestions.length === 0
                    ? () => setShowForm(true)
                    : undefined
                }
                className="py-10"
              />
            ) : (
              filtered.map((m) => (
                <Card key={m.id} className="border-border/70 shadow-none">
                  <CardContent className="flex items-start gap-3 p-4">
                    <Star className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{m.title}</span>
                        <Badge variant="secondary" className="font-normal capitalize">
                          {m.kind}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {m.content}
                      </p>
                      <p className="mt-2 text-2xs text-muted-foreground">
                        {t("memory.updated", {
                          when: relativeTime(m.updatedAt),
                        })}
                      </p>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label={t("memory.rowMenu")}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              className="text-destructive-text"
                            >
                              {t("memory.delete")}
                            </DropdownMenuItem>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                {t("memory.deleteTitle")}
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                {t("memory.deleteBody")}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>
                                {t("memory.keep")}
                              </AlertDialogCancel>
                              <AlertDialogAction
                                variant="destructive"
                                onClick={() => props.onDelete(m.id)}
                              >
                                {t("memory.delete")}
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      </ScrollArea>

      <aside className="hidden w-[280px] shrink-0 flex-col gap-3 overflow-y-auto border-l border-border/70 bg-muted/10 p-4 xl:flex">
        <Card className="border-border/70 shadow-none">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">{t("memory.health")}</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="text-3xl font-semibold tabular-nums">
              {props.memories.length}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("memory.healthHint")}
            </p>
            <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {t("memory.brandCount", {
                  n: props.memories.filter((m) => m.kind === "brand").length,
                })}
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {t("memory.standingCount", {
                  n: props.memories.filter((m) => m.kind === "standing").length,
                })}
              </li>
              <li className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {t("memory.projectCount", {
                  n: props.memories.filter((m) => m.kind === "project").length,
                })}
              </li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-none">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">{t("memory.activity")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 pb-4 text-xs text-muted-foreground">
            {props.memories.slice(0, 5).map((m) => (
              <div key={m.id}>
                {t("memory.activityLine", {
                  title: m.title,
                  when: relativeTime(m.updatedAt),
                })}
              </div>
            ))}
            {props.memories.length === 0 && <p>{t("memory.noActivity")}</p>}
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-full border px-2.5 text-2xs font-medium transition-colors",
        active
          ? "border-border bg-secondary text-foreground"
          : "border-border/60 text-muted-foreground hover:bg-muted/40",
      )}
    >
      {children}
    </button>
  );
}
