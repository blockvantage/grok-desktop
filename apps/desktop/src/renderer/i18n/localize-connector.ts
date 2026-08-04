import type { ConnectorPreset } from "@grokdesk/shared";
import type { TranslateFn } from "./catalog.js";

/** Overlay translated name/description/longDescription/setupNotes/capabilities onto a preset. */
export function localizeConnector(
  preset: ConnectorPreset,
  t: TranslateFn,
): ConnectorPreset {
  const id = preset.id;
  const nameKey = `connector.${id}.name`;
  const name = t(nameKey);
  const description = t(`connector.${id}.description`);
  const longDescription = t(`connector.${id}.longDescription`);
  const setupNotesRaw = t(`connector.${id}.setupNotes`);
  const caps = [0, 1, 2]
    .map((i) => t(`connector.${id}.cap${i}`))
    .filter((c) => c && !c.startsWith("connector."));

  return {
    ...preset,
    name: name.startsWith("connector.") ? preset.name : name,
    description: description.startsWith("connector.")
      ? preset.description
      : description,
    longDescription: longDescription.startsWith("connector.")
      ? preset.longDescription
      : longDescription,
    // Empty string is intentional (no notes). Only fall back when the key is missing.
    setupNotes: setupNotesRaw.startsWith("connector.")
      ? preset.setupNotes
      : setupNotesRaw,
    capabilities: caps.length ? caps : preset.capabilities,
  };
}

export function localizeConnectors(
  presets: ConnectorPreset[],
  t: TranslateFn,
): ConnectorPreset[] {
  return presets.map((p) => localizeConnector(p, t));
}

export function localizeCategoryLabel(
  id: string,
  t: TranslateFn,
): { label: string; description: string } {
  const label = t(`cat.${id}`);
  const description = t(`cat.${id}Desc`);
  return {
    label: label.startsWith("cat.") ? id : label,
    description: description.startsWith("cat.") ? "" : description,
  };
}
