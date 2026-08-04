import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";

type ShortcutRow = { keys: string[]; labelKey: string };
type ShortcutGroup = { headingKey: string; rows: ShortcutRow[] };

/** Central reference for the shell's keyboard shortcuts (previously undiscoverable). */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    headingKey: "shortcuts.groupGeneral",
    rows: [
      { keys: ["⌘", "K"], labelKey: "shortcuts.palette" },
      { keys: ["⌘", "N"], labelKey: "shortcuts.newChat" },
      { keys: ["?"], labelKey: "shortcuts.help" },
      { keys: ["esc"], labelKey: "shortcuts.escape" },
    ],
  },
  {
    headingKey: "shortcuts.groupNav",
    rows: [{ keys: ["⌘", "1–6"], labelKey: "shortcuts.nav" }],
  },
  {
    headingKey: "shortcuts.groupChat",
    rows: [
      { keys: ["⌘", "."], labelKey: "shortcuts.stop" },
      { keys: ["⌘", "⇧", "I"], labelKey: "shortcuts.inbox" },
      { keys: ["⌘", "⇧", "C"], labelKey: "shortcuts.copy" },
      { keys: ["⌘", "⇧", "P"], labelKey: "shortcuts.pin" },
    ],
  },
  {
    headingKey: "shortcuts.groupComposer",
    rows: [
      { keys: ["/"], labelKey: "shortcuts.slash" },
      { keys: ["@"], labelKey: "shortcuts.mention" },
    ],
  },
];

export function ShortcutsHelp(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.headingKey} className="space-y-2">
              <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(group.headingKey)}
              </p>
              <ul className="space-y-1.5">
                {group.rows.map((row) => (
                  <li
                    key={row.labelKey}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="text-foreground/90">{t(row.labelKey)}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      {row.keys.map((k, i) => (
                        <kbd key={`${row.labelKey}-${i}`} className="kbd">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
