/**
 * jsdom + Testing Library: slash menu selection (Phase 2.7).
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlashCommandMenu } from "./slash-command-menu";
import type { SlashCommand } from "@/lib/composer-input";

vi.mock("@/i18n", () => ({
  useT: () => (key: string) => key,
}));

const brief: SlashCommand = {
  id: "brief",
  token: "brief",
  labelKey: "slash.brief",
  descKey: "slash.briefDesc",
  kind: "fill",
  isTemplate: true,
  goalKey: "slash.briefGoal",
};

describe("SlashCommandMenu interactions", () => {
  it("selects the hovered command on click", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onHover = vi.fn();
    render(
      <SlashCommandMenu
        items={[brief]}
        activeIndex={0}
        onHover={onHover}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("button", { name: /brief/i }));
    expect(onSelect).toHaveBeenCalledWith(brief);
  });
});
