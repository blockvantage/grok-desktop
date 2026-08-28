import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useT } from "@/i18n";
import {
  isApplePlatform,
  modifierKeyGlyph,
  shiftKeyGlyph,
} from "@/lib/platform-modifier";

type ShortcutRow = { keys: string[]; labelKey: string };
type ShortcutGroup = { headingKey: string; rows: ShortcutRow[] };

/** Central reference for the shell's keyboard shortcuts (previously undiscoverable). */
export function shortcutGroups(
  mod = modifierKeyGlyph(),
  shift = shiftKeyGlyph(),
): ShortcutGroup[] {
  return [
    {
      headingKey: "shortcuts.groupGeneral",
      rows: [
        { keys: [mod, "K"], labelKey: "shortcuts.palette" },
        { keys: [mod, "N"], labelKey: "shortcuts.newChat" },
        { keys: ["?"], labelKey: "shortcuts.help" },
        { keys: ["esc"], labelKey: "shortcuts.escape" },
      ],
    },
    {
      headingKey: "shortcuts.groupNav",
      rows: [{ keys: [mod, "1–6"], labelKey: "shortcuts.nav" }],
    },
    {
      headingKey: "shortcuts.groupChat",
      rows: [
        { keys: [mod, "."], labelKey: "shortcuts.stop" },
        { keys: ["esc"], labelKey: "shortcuts.stopEsc" },
        { keys: [mod, shift, "I"], labelKey: "shortcuts.inbox" },
        { keys: [mod, shift, "C"], labelKey: "shortcuts.copy" },
        { keys: [mod, shift, "P"], labelKey: "shortcuts.pin" },
      ],
    },
    {
      headingKey: "shortcuts.groupComposer",
      rows: [
        { keys: ["/"], labelKey: "shortcuts.slash" },
        { keys: ["@"], labelKey: "shortcuts.mention" },
        { keys: [mod, "Enter"], labelKey: "shortcuts.queueSendNow" },
      ],
    },
  ];
}

/** Mac-default snapshot for structure tests that grep the module. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = shortcutGroups("⌘", "⇧");

export function ShortcutsHelp(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const apple = isApplePlatform();
  const groups = shortcutGroups(modifierKeyGlyph(apple), shiftKeyGlyph(apple));
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.subtitle")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5 sm:grid-cols-2">
          {groups.map((group) => (
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
