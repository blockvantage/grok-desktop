/**
 * Pure / presentational helpers extracted from task-stream (Task 16).
 */

export type StreamActivity = {
  label: string;
  detail?: string;
  generic: boolean;
};

type ToolActionLike = {
  kind: "toolAction";
  tool: string;
  detail: string;
  status: string;
};

type RenderItemLike =
  | ToolActionLike
  | { kind: string; [key: string]: unknown };

/** Describe what Grok is doing right now, from the newest stream item. */
export function workingActivity(
  item: RenderItemLike | undefined,
  translate: (key: string) => string,
  allItems?: RenderItemLike[],
): StreamActivity {
  // Prefer any running tool in the full fold, not only the tail item.
  if (allItems) {
    for (let i = allItems.length - 1; i >= 0; i--) {
      const it = allItems[i];
      if (it?.kind === "toolAction" && (it as ToolActionLike).status === "running") {
        const action = it as ToolActionLike;
        return {
          label: humanizeTool(action.tool, translate),
          detail: action.detail || undefined,
          generic: false,
        };
      }
    }
  }
  if (
    item?.kind === "toolAction" &&
    (item as ToolActionLike).status === "running"
  ) {
    const action = item as ToolActionLike;
    return {
      label: humanizeTool(action.tool, translate),
      detail: action.detail || undefined,
      generic: false,
    };
  }
  return { label: "", generic: true };
}

/** Turn a raw tool name into a present-progressive action ("Reading"). */
export function humanizeTool(
  tool: string,
  translate: (key: string) => string,
): string {
  const name = tool.toLowerCase();
  if (name.startsWith("browser_")) {
    if (name.includes("open")) return translate("activity.openingPage");
    if (name.includes("click")) return translate("activity.clicking");
    if (name.includes("type")) return translate("activity.typing");
    if (name.includes("scroll")) return translate("activity.scrolling");
    if (name.includes("screenshot"))
      return translate("activity.capturingScreenshot");
    if (name.includes("read")) return translate("activity.readingPage");
    return translate("activity.browsing");
  }
  if (name.includes("read") || name.includes("open") || name.includes("cat"))
    return translate("activity.reading");
  if (
    name.includes("write") ||
    name.includes("edit") ||
    name.includes("create")
  )
    return translate("activity.writing");
  if (name.includes("delete") || name.includes("remove"))
    return translate("activity.cleaningUp");
  if (name.includes("search") || name.includes("grep") || name.includes("find"))
    return translate("activity.searching");
  if (
    name.includes("web") ||
    name.includes("fetch") ||
    name.includes("http") ||
    name.includes("browse") ||
    name.includes("url")
  )
    return translate("activity.browsingWeb");
  if (
    name.includes("shell") ||
    name.includes("command") ||
    name.includes("bash") ||
    name.includes("terminal") ||
    name.includes("exec") ||
    name.includes("run")
  )
    return translate("activity.runningCommand");
  return tool.charAt(0).toUpperCase() + tool.slice(1);
}

export type ToolIconKind =
  | "globe"
  | "file"
  | "trash"
  | "terminal"
  | "wrench";

/** Map tool name to a coarse icon kind (caller maps to Lucide). */
export function toolIconKind(tool: string): ToolIconKind {
  const t = tool.toLowerCase();
  if (t.startsWith("browser_") || t.includes("browse")) return "globe";
  if (t.includes("delete") || t.includes("unlink") || t.includes("rm_"))
    return "trash";
  if (t.includes("read") || t.includes("write") || t.includes("file"))
    return "file";
  if (t.includes("shell") || t.includes("command") || t.includes("terminal"))
    return "terminal";
  if (t.includes("network") || t.includes("fetch") || t.includes("http"))
    return "globe";
  return "wrench";
}
