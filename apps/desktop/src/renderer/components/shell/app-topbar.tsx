import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconTooltipButton } from "@/components/ui/icon-tooltip";
import { Search as SearchIcon } from "lucide-react";
import { useT } from "@/i18n";

/**
 * SH-5 / SH-11: search + palette only.
 * Account lives in the sidebar footer; no status dropdown / settings icon here.
 */
export function AppTopbar(props: {
  searchPlaceholder?: string;
  search: string;
  /** When false, hide the search field (palette control remains). Default true. */
  showSearch?: boolean;
  onSearch: (v: string) => void;
  signedIn: boolean;
  engineStatus?: string | null;
  accountLabel?: string | null;
  accountName?: string | null;
  onNewTask: () => void;
  onOpenSettings: () => void;
  onOpenPalette: () => void;
  onSignIn: () => void;
}) {
  const t = useT();
  const showSearch = props.showSearch !== false;

  return (
    <header className="titlebar-drag relative flex h-14 shrink-0 items-center gap-3 border-b border-hairline-quiet bg-background/60 px-4 backdrop-blur-xl">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />

      {showSearch ? (
      <div className="titlebar-no-drag relative min-w-0 flex-1 max-w-md">
        <SearchIcon
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          strokeWidth={1.75}
        />
        <Input
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder={props.searchPlaceholder ?? t("topbar.searchPlaceholder")}
          className="h-9 border-white/[0.06] bg-white/[0.03] pl-9 pr-3 text-sm shadow-none"
          data-testid="topbar-search"
        />
      </div>
      ) : (
        <div className="titlebar-no-drag min-w-0 flex-1" />
      )}

      <div className="titlebar-no-drag ml-auto flex items-center gap-1.5">
        <IconTooltipButton
          label={t("topbar.commandPalette")}
          shortcut="⌘K"
          variant="outline"
          onClick={props.onOpenPalette}
          className="h-9 gap-1.5 border-white/[0.07] bg-white/[0.025] px-2.5 text-muted-foreground/90 hover:text-foreground"
        >
          <span className="flex items-center gap-1 font-mono text-2xs tracking-tight">
            <kbd className="kbd">⌘</kbd>
            <kbd className="kbd">K</kbd>
          </span>
        </IconTooltipButton>
      </div>
    </header>
  );
}
