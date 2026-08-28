import { describe, expect, it } from "vitest";
import {
  applySlashCommand,
  armedEffortTransition,
  armedSlashCommand,
  composerKeyAction,
  expandSlashGoal,
  extractSlashQuery,
  filterSlashCommands,
  isSlashMenuVisible,
  slashDismissKey,
  SLASH_COMMANDS,
  weaveSlashArgs,
} from "./composer-input";

describe("composerKeyAction", () => {
  it("sends on plain Enter by default", () => {
    expect(composerKeyAction({ key: "Enter", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false })).toEqual({
      type: "send",
    });
  });

  it("newlines on Shift+Enter", () => {
    expect(
      composerKeyAction({
        key: "Enter",
        shiftKey: true,
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
    ).toEqual({ type: "newline" });
  });

  it("always sends on Cmd/Ctrl+Enter", () => {
    expect(
      composerKeyAction({
        key: "Enter",
        shiftKey: false,
        metaKey: true,
        ctrlKey: false,
        altKey: false,
      }),
    ).toEqual({ type: "send" });
    expect(
      composerKeyAction(
        {
          key: "Enter",
          shiftKey: false,
          metaKey: false,
          ctrlKey: true,
          altKey: false,
        },
        { allowPlainEnterSend: false },
      ),
    ).toEqual({ type: "send" });
  });

  it("can disable plain Enter send", () => {
    expect(
      composerKeyAction(
        {
          key: "Enter",
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
        },
        { allowPlainEnterSend: false },
      ),
    ).toEqual({ type: "ignore" });
  });

  it("ignores Enter while IME is composing", () => {
    expect(
      composerKeyAction(
        {
          key: "Enter",
          shiftKey: false,
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          isComposing: true,
        },
      ),
    ).toEqual({ type: "ignore" });
    // Cmd/Ctrl+Enter also ignored mid-composition.
    expect(
      composerKeyAction(
        {
          key: "Enter",
          shiftKey: false,
          metaKey: true,
          ctrlKey: false,
          altKey: false,
          isComposing: true,
        },
      ),
    ).toEqual({ type: "ignore" });
  });
});

describe("slash commands", () => {
  it("extracts /token at line start", () => {
    expect(extractSlashQuery("/br", 3)).toEqual({
      token: "br",
      args: "",
      start: 0,
      end: 3,
      committed: false,
    });
    expect(extractSlashQuery("hello /br", 9)).toBeNull();
    expect(extractSlashQuery("/folder", 7)?.token).toBe("folder");
  });

  it("captures args after an exact command token", () => {
    const text = "/research quantum computing";
    const q = extractSlashQuery(text, text.length);
    expect(q).toEqual({
      token: "research",
      args: "quantum computing",
      start: 0,
      end: text.length,
      committed: true,
    });
    // Trailing space marks the query committed (menu closes; args mode).
    expect(extractSlashQuery("/research ", 10)).toEqual({
      token: "research",
      args: "",
      start: 0,
      end: 10,
      committed: true,
    });
  });

  it("marks a bare /token (no space) as not committed", () => {
    expect(extractSlashQuery("/research", 9)?.committed).toBe(false);
    expect(extractSlashQuery("/res", 4)?.committed).toBe(false);
  });

  it("does not commit an action command on a trailing space (menu stays open)", () => {
    // `/folder ` must keep the picker open so Enter fires the action, not send
    // the literal "/folder" as a goal. Only fill commands take args → commit.
    const q = extractSlashQuery("/folder ", 8);
    expect(q?.token).toBe("folder");
    expect(q?.committed).toBe(false);
    expect(isSlashMenuVisible(q, null)).toBe(true);
    // Fill commands still commit on the trailing space.
    expect(extractSlashQuery("/research ", 10)?.committed).toBe(true);
  });

  it("closes when a non-matching token has a space", () => {
    expect(extractSlashQuery("/x foo", 6)).toBeNull();
    expect(extractSlashQuery("/resear quantum", 15)).toBeNull();
  });

  it("never treats file paths like /Users/... as slash commands", () => {
    expect(extractSlashQuery("/Users/me/project", 17)).toBeNull();
    expect(extractSlashQuery("/Users/me", 9)).toBeNull();
    // Mid-line path is still ignored.
    expect(extractSlashQuery("see /Users/me", 13)).toBeNull();
  });

  it("filters by prefix", () => {
    const hits = filterSlashCommands("fol");
    expect(hits.map((h) => h.token)).toEqual(["folder"]);
    expect(filterSlashCommands("").length).toBe(SLASH_COMMANDS.length);
  });

  it("includes coworker slash actions", () => {
    expect(SLASH_COMMANDS.some((c) => c.id === "recipe")).toBe(true);
    expect(SLASH_COMMANDS.some((c) => c.id === "briefing")).toBe(true);
    expect(SLASH_COMMANDS.some((c) => c.id === "export")).toBe(true);
    expect(filterSlashCommands("rec").some((c) => c.token === "recipe")).toBe(
      true,
    );
  });

  it("capability-gates image/video templates via CommandRegistry", () => {
    const noMedia = filterSlashCommands("", SLASH_COMMANDS, {
      capabilities: { image: false, video: false },
    });
    expect(noMedia.some((c) => c.token === "image")).toBe(false);
    expect(noMedia.some((c) => c.token === "video")).toBe(false);
    expect(noMedia.some((c) => c.token === "brief")).toBe(true);

    const withImg = filterSlashCommands("", SLASH_COMMANDS, {
      capabilities: { image: true, video: false },
    });
    expect(withImg.some((c) => c.token === "image")).toBe(true);
    expect(withImg.some((c) => c.token === "video")).toBe(false);

    // Templates are labeled
    expect(SLASH_COMMANDS.find((c) => c.id === "brief")?.isTemplate).toBe(true);
    expect(SLASH_COMMANDS.find((c) => c.id === "image")?.isTemplate).toBe(true);
  });

  it("completes the slash token on menu selection (no template paste)", () => {
    const r = applySlashCommand("/br", { start: 0, end: 3 }, "/brief ");
    expect(r.text).toBe("/brief ");
    expect(r.cursor).toBe("/brief ".length);
  });

  it("weaves args into fill templates (send-time expansion)", () => {
    const template = "Research this topic thoroughly.";
    expect(weaveSlashArgs(template, "", "Topic: x")).toBe(template);
    expect(weaveSlashArgs(template, "  ", "Topic: x")).toBe(template);
    expect(weaveSlashArgs(template, "grok pricing", "Topic: grok pricing")).toBe(
      "Research this topic thoroughly.\n\nTopic: grok pricing",
    );
  });

  it("token-completes over a partial token range", () => {
    const text = "/resear";
    const q = extractSlashQuery(text, text.length)!;
    const r = applySlashCommand(text, q, "/research ");
    expect(r.text).toBe("/research ");
    expect(r.cursor).toBe("/research ".length);
  });

  it("/research configures heavy effort", () => {
    const research = SLASH_COMMANDS.find((c) => c.id === "research");
    expect(research?.effort).toBe("heavy");
  });

  it("includes summarize / undo / remember / watch / deep-research", () => {
    expect(SLASH_COMMANDS.some((c) => c.token === "compact" && c.action === "compact")).toBe(
      true,
    );
    expect(SLASH_COMMANDS.some((c) => c.token === "rewind" && c.action === "rewind")).toBe(
      true,
    );
    expect(SLASH_COMMANDS.some((c) => c.token === "remember")).toBe(true);
    expect(SLASH_COMMANDS.find((c) => c.id === "monitor")?.token).toBe("watch");
    expect(SLASH_COMMANDS.find((c) => c.id === "loop")?.token).toBe("loop");
    expect(SLASH_COMMANDS.find((c) => c.id === "deep-research")?.effort).toBe(
      "heavy",
    );
    expect(filterSlashCommands("deep").some((c) => c.token === "deep-research")).toBe(
      true,
    );
  });

  it("/video is a fill command with the expected shape", () => {
    const video = SLASH_COMMANDS.find((c) => c.id === "video");
    expect(video).toEqual({
      id: "video",
      token: "video",
      labelKey: "slash.video",
      descKey: "slash.videoDesc",
      kind: "fill",
      isTemplate: true,
      goalKey: "slash.videoGoal",
      registryId: "core.video",
    });
  });

  it("captures args after /video once the command exists", () => {
    const text = "/video product launch";
    const q = extractSlashQuery(text, text.length);
    expect(q).toEqual({
      token: "video",
      args: "product launch",
      start: 0,
      end: text.length,
      committed: true,
    });
  });
});

describe("slash menu dismiss state", () => {
  it("keys dismiss on start + token", () => {
    expect(slashDismissKey({ start: 0, token: "res" })).toBe("0:res");
  });

  it("hides menu until the token changes", () => {
    const q = { token: "res", args: "", start: 0, end: 4, committed: false };
    expect(isSlashMenuVisible(q, null)).toBe(true);
    expect(isSlashMenuVisible(q, "0:res")).toBe(false);
    // Typing another character changes the token → re-open.
    expect(
      isSlashMenuVisible(
        { token: "rese", args: "", start: 0, end: 5, committed: false },
        "0:res",
      ),
    ).toBe(true);
    // Mentions block the slash menu.
    expect(isSlashMenuVisible(q, null, true)).toBe(false);
    expect(isSlashMenuVisible(null, null)).toBe(false);
  });

  it("closes the picker once a command is committed (args mode)", () => {
    // Regression: after selecting a command the text becomes "/research " and
    // the menu must CLOSE so Enter sends instead of re-selecting the command.
    const committed = {
      token: "research",
      args: "",
      start: 0,
      end: 10,
      committed: true,
    };
    expect(isSlashMenuVisible(committed, null)).toBe(false);
    const withArgs = { ...committed, args: "quantum" };
    expect(isSlashMenuVisible(withArgs, null)).toBe(false);
  });
});

describe("armedEffortTransition", () => {
  it("escalates once and remembers the prior effort", () => {
    const r = armedEffortTransition(
      { saved: null, applied: null },
      "normal",
      "heavy",
    );
    expect(r.set).toBe("heavy");
    expect(r.state).toEqual({ saved: "normal", applied: "heavy" });
  });

  it("restores on disarm only when untouched", () => {
    const armed = { saved: "normal", applied: "heavy" } as const;
    expect(armedEffortTransition(armed, "heavy", null).set).toBe("normal");
    expect(armedEffortTransition(armed, "max", null).set).toBeUndefined(); // user changed it
  });

  it("is a no-op while armed state is unchanged", () => {
    const r = armedEffortTransition(
      { saved: "normal", applied: "heavy" },
      "heavy",
      "heavy",
    );
    expect(r.set).toBeUndefined();
  });
});

describe("armedSlashCommand / expandSlashGoal", () => {
  const tr = (k: string, p?: Record<string, string>) =>
    k === "slash.argsTopic" ? `Topic: ${p?.args}` : `[${k}]`;

  it("arms on a leading fill token", () => {
    expect(armedSlashCommand("/research grok pricing")?.command.id).toBe(
      "research",
    );
    expect(armedSlashCommand("/research grok pricing")?.args).toBe(
      "grok pricing",
    );
  });

  it("does not arm on action tokens, paths, unknown tokens, or mid-text", () => {
    expect(armedSlashCommand("/folder")).toBeNull();
    expect(armedSlashCommand("/Users/maceo/notes")).toBeNull();
    expect(armedSlashCommand("/nope hi")).toBeNull();
    expect(armedSlashCommand("see /research")).toBeNull();
  });

  it("expands template + weaves args at send time", () => {
    const r = expandSlashGoal("/research grok pricing", tr);
    expect(r.goal).toBe("[slash.researchGoal]\n\nTopic: grok pricing");
    expect(r.command?.id).toBe("research");
    expect(r.source).toBe("/research grok pricing");
  });

  it("expands a bare token to the template alone", () => {
    expect(expandSlashGoal("/brief", tr).goal).toBe("[slash.briefGoal]");
  });

  it("passes non-command text through unchanged", () => {
    const r = expandSlashGoal("plain question", tr);
    expect(r.goal).toBe("plain question");
    expect(r.command).toBeNull();
  });

  it("captures multiline args", () => {
    const r = expandSlashGoal("/brief launch plan\nfor Q3", tr);
    expect(r.goal).toContain("Topic: launch plan\nfor Q3");
  });
});
