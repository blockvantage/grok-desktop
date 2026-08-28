/**
 * jsdom: media studio duration/aspect/voice surface (Phase 3.2).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MediaStudioControls } from "./media-studio-controls";
import type { MediaStudioOptions } from "@grokdesk/shared";

vi.mock("@/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string>) => {
    if (key === "mediaStudio.durationSec") return `${params?.n ?? ""}s`;
    if (key === "mediaStudio.stillAttached") return `Still: ${params?.name ?? ""}`;
    const map: Record<string, string> = {
      "mediaStudio.videoLabel": "Video",
      "mediaStudio.imageLabel": "Image",
      "mediaStudio.duration": "Length",
      "mediaStudio.aspect": "Aspect",
      "mediaStudio.aspectAuto": "Auto",
      "mediaStudio.voiceLabel": "Voice",
      "mediaStudio.voiceNone": "No voice",
    };
    return map[key] ?? key;
  },
}));

vi.mock("@/components/ui/select", () => ({
  Select: (props: {
    value?: string;
    onValueChange?: (v: string) => void;
    children: unknown;
  }) => (
    <div data-select-value={props.value}>{props.children as never}</div>
  ),
  SelectTrigger: (props: {
    children: unknown;
    className?: string;
    "data-testid"?: string;
  }) => (
    <button type="button" data-testid={props["data-testid"]}>
      {props.children as never}
    </button>
  ),
  SelectValue: (props: { placeholder?: string }) => (
    <span>{props.placeholder}</span>
  ),
  SelectContent: (props: { children: unknown }) => (
    <div>{props.children as never}</div>
  ),
  SelectItem: (props: { value: string; children: unknown }) => (
    <div data-select-item={props.value}>{props.children as never}</div>
  ),
}));

const videoValue: MediaStudioOptions = {
  kind: "video",
  durationSec: 6,
  aspectRatio: "4:3",
  voice: "eve",
};

describe("MediaStudioControls", () => {
  it("shows duration, 4:3, and voices for video", () => {
    render(
      <MediaStudioControls
        kind="video"
        value={videoValue}
        onChange={() => {}}
        stillImageName="poster.png"
      />,
    );
    expect(screen.getByTestId("media-studio-controls").getAttribute("data-media-kind")).toBe(
      "video",
    );
    expect(screen.getByTestId("media-studio-duration")).toBeTruthy();
    expect(screen.getByTestId("media-studio-aspect")).toBeTruthy();
    expect(screen.getByTestId("media-studio-voice")).toBeTruthy();
    expect(screen.getByTestId("media-studio-still").textContent).toContain(
      "poster.png",
    );
    expect(document.querySelector('[data-select-item="4:3"]')).toBeTruthy();
    expect(document.querySelector('[data-select-item="3:4"]')).toBeTruthy();
    expect(document.querySelector('[data-select-item="15"]')).toBeTruthy();
    expect(document.querySelector('[data-select-item="eve"]')).toBeTruthy();
  });

  it("hides duration and voice for image", () => {
    render(
      <MediaStudioControls
        kind="image"
        value={{ kind: "image", aspectRatio: "3:4" }}
        onChange={() => {}}
      />,
    );
    expect(screen.getByTestId("media-studio-controls").getAttribute("data-media-kind")).toBe(
      "image",
    );
    expect(screen.queryByTestId("media-studio-duration")).toBeNull();
    expect(screen.queryByTestId("media-studio-voice")).toBeNull();
    expect(screen.getByTestId("media-studio-aspect")).toBeTruthy();
  });
});
