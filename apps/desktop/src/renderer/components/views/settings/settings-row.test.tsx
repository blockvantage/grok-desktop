import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsRow } from "./settings-row";
import { Switch } from "@/components/ui/switch";

describe("SettingsRow", () => {
  it("names a Switch control after the row label", () => {
    const html = renderToStaticMarkup(
      <SettingsRow
        label="Master toggle"
        control={<Switch checked={false} onCheckedChange={() => {}} />}
      />,
    );

    // Match whole tags, then assert attributes independently — attribute
    // order across React/Radix is not a contract worth pinning down, so the
    // label-div match must not assume `id` comes first either.
    const labelTags = html.match(/<div\b[^>]*>Master toggle<\/div>/g) ?? [];
    expect(labelTags).toHaveLength(1);
    const labelId = labelTags[0]?.match(/\sid="([^"]*)"/)?.[1];
    expect(labelId).toBeTruthy();

    const switchTags = html.match(/<button[^>]*\srole="switch"[^>]*>/g) ?? [];
    expect(switchTags).toHaveLength(1);
    const labelledBy = switchTags[0]?.match(/aria-labelledby="([^"]*)"/)?.[1];
    expect(labelledBy).toBe(labelId);
  });

  it("does not clobber a control's own aria-label", () => {
    const html = renderToStaticMarkup(
      <SettingsRow
        label="Master toggle"
        control={
          <Switch
            checked={false}
            onCheckedChange={() => {}}
            aria-label="Custom name"
          />
        }
      />,
    );

    const switchTags = html.match(/<button[^>]*\srole="switch"[^>]*>/g) ?? [];
    expect(switchTags).toHaveLength(1);
    expect(switchTags[0]).toContain('aria-label="Custom name"');
    expect(switchTags[0]).not.toContain("aria-labelledby");
  });

  it("respects a control's own aria-labelledby", () => {
    const html = renderToStaticMarkup(
      <SettingsRow
        label="Master toggle"
        control={
          <Switch
            checked={false}
            onCheckedChange={() => {}}
            aria-labelledby="external-id"
          />
        }
      />,
    );

    const switchTags = html.match(/<button[^>]*\srole="switch"[^>]*>/g) ?? [];
    expect(switchTags).toHaveLength(1);
    expect(switchTags[0]).toContain('aria-labelledby="external-id"');
  });
});
