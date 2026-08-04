import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { RolePack } from "@grokdesk/shared";
import { useT } from "@/i18n";

/**
 * Compact role pack control for the compose toolbar.
 * Intentionally not a card grid — that cluttered the home composer.
 */
export function RolePackPicker(props: {
  packs: RolePack[];
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
  /** "toolbar" = compact select; "cards" reserved for onboarding-like surfaces */
  variant?: "toolbar" | "cards";
}) {
  const t = useT();
  const variant = props.variant ?? "toolbar";

  if (variant === "cards") {
    // Kept for rare full-page surfaces; home uses toolbar.
    const items: Array<{ id: string | null; name: string; description: string }> =
      [
        {
          id: null,
          name: t("rolePack.none"),
          description: t("rolePack.noneDesc"),
        },
        ...props.packs.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
        })),
      ];
    return (
      <div
        className={cn("flex flex-wrap gap-2", props.className)}
        role="listbox"
        aria-label={t("rolePack.label")}
      >
        {items.map((item) => {
          const selected = props.value === item.id;
          return (
            <button
              key={item.id ?? "none"}
              type="button"
              role="option"
              aria-selected={selected}
              onClick={() => props.onChange(item.id)}
              className={cn(
                "max-w-[11rem] rounded-xl border px-3 py-2 text-left transition-colors",
                selected
                  ? "border-primary/50 bg-primary/10"
                  : "border-border/60 bg-card/40 hover:border-border",
              )}
            >
              <div className="text-sm font-medium leading-tight">
                {item.name}
              </div>
              <div className="mt-0.5 line-clamp-2 text-2xs text-muted-foreground">
                {item.description}
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <Select
      value={props.value ?? "general"}
      onValueChange={(v) => props.onChange(v === "general" ? null : v)}
    >
      <SelectTrigger
        className={cn(
          "h-8 w-auto min-w-[7.5rem] max-w-[11rem] gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-white/[0.04] hover:text-foreground focus:ring-0",
          props.className,
        )}
        aria-label={t("rolePack.label")}
      >
        <SelectValue placeholder={t("rolePack.none")} />
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[12rem]">
        <SelectItem value="general" className="text-sm">
          {t("rolePack.none")}
        </SelectItem>
        {props.packs.map((p) => (
          <SelectItem key={p.id} value={p.id} className="text-sm">
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
