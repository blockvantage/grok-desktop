import { useT } from "@/i18n";
import {
  MEDIA_ASPECT_RATIOS,
  MEDIA_DURATION_DEFAULT,
  MEDIA_DURATION_MAX,
  MEDIA_DURATION_MIN,
  MEDIA_PRESET_VOICES,
  type MediaStudioKind,
  type MediaStudioOptions,
} from "@grokdesk/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function MediaStudioControls(props: {
  kind: MediaStudioKind;
  value: MediaStudioOptions;
  onChange: (next: MediaStudioOptions) => void;
  stillImageName?: string | null;
}) {
  const t = useT();
  const { kind, value, onChange } = props;
  const duration = value.durationSec ?? MEDIA_DURATION_DEFAULT;
  const aspect = value.aspectRatio ?? "";
  const voice = value.voice ?? "";

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-2"
      data-testid="media-studio-controls"
      data-media-kind={kind}
    >
      <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
        {t(kind === "video" ? "mediaStudio.videoLabel" : "mediaStudio.imageLabel")}
      </span>
      {kind === "video" ? (
        <Select
          value={String(duration)}
          onValueChange={(v) =>
            onChange({ ...value, kind, durationSec: Number(v) })
          }
        >
          <SelectTrigger
            className="h-7 w-[7.5rem] text-2xs"
            data-testid="media-studio-duration"
          >
            <SelectValue placeholder={t("mediaStudio.duration")} />
          </SelectTrigger>
          <SelectContent>
            {Array.from(
              { length: MEDIA_DURATION_MAX - MEDIA_DURATION_MIN + 1 },
              (_, i) => MEDIA_DURATION_MIN + i,
            ).map((sec) => (
              <SelectItem key={sec} value={String(sec)}>
                {t("mediaStudio.durationSec", { n: String(sec) })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Select
        value={aspect || "default"}
        onValueChange={(v) =>
          onChange({
            ...value,
            kind,
            aspectRatio: v === "default" ? null : v,
          })
        }
      >
        <SelectTrigger
          className="h-7 w-[7.5rem] text-2xs"
          data-testid="media-studio-aspect"
        >
          <SelectValue placeholder={t("mediaStudio.aspect")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">{t("mediaStudio.aspectAuto")}</SelectItem>
          {MEDIA_ASPECT_RATIOS.map((ratio) => (
            <SelectItem key={ratio} value={ratio}>
              {ratio}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {kind === "video" ? (
        <Select
          value={voice || "none"}
          onValueChange={(v) =>
            onChange({
              ...value,
              kind,
              voice: v === "none" ? null : v,
            })
          }
        >
          <SelectTrigger
            className="h-7 w-[8rem] text-2xs"
            data-testid="media-studio-voice"
          >
            <SelectValue placeholder={t("mediaStudio.voiceLabel")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("mediaStudio.voiceNone")}</SelectItem>
            {MEDIA_PRESET_VOICES.map((id) => (
              <SelectItem key={id} value={id}>
                {t(`mediaStudio.voices.${id}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      {kind === "video" && props.stillImageName ? (
        <span
          className="max-w-[10rem] truncate text-2xs text-muted-foreground"
          data-testid="media-studio-still"
          title={props.stillImageName}
        >
          {t("mediaStudio.stillAttached", { name: props.stillImageName })}
        </span>
      ) : null}
    </div>
  );
}
