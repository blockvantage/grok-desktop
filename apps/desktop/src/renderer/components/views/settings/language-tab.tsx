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
import { useI18n, useT, type LocalePreference } from "@/i18n";
import { SettingsSection } from "./settings-row";

/**
 * Language preferences — same card density as Workspace behavior / Default model.
 */
export function LanguageTab() {
  const t = useT();
  const { locale, preference, setLocale, locales } = useI18n();

  return (
    <Card className="border-border/70" data-testid="language-tab">
      <CardHeader>
        <CardTitle className="text-base">{t("settings.languageTitle")}</CardTitle>
        <CardDescription>{t("settings.languageDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <SettingsSection title={t("settings.languageTitle")}>
          <Select
            value={preference}
            onValueChange={(v) => setLocale(v as LocalePreference)}
          >
            <SelectTrigger data-testid="language-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system" data-testid="language-option-system">
                {t("settings.languageSystem")}
                {preference === "system"
                  ? ` · ${locales.find((l) => l.code === locale)?.nativeName ?? locale}`
                  : ""}
              </SelectItem>
              {locales.map((l) => (
                <SelectItem
                  key={l.code}
                  value={l.code}
                  data-testid={`language-option-${l.code}`}
                >
                  {`${l.nativeName} · ${l.englishName}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsSection>
        <p className="text-2xs text-muted-foreground">
          {t("app.name")} · {locale.toUpperCase()}
        </p>
      </CardContent>
    </Card>
  );
}
