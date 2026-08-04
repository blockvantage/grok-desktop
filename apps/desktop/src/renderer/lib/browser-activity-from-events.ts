/**
 * Detect agent browser tool use from stream events (Phase 6 extract).
 * Used to auto-open the in-app browser only when the agent actually browses.
 */

export type BrowserToolEventLike = {
  id?: string;
  kind: string;
  payload?: {
    id?: unknown;
    tool?: unknown;
  } & Record<string, unknown> | null;
};

/**
 * True when any event is a browser_* tool_request (by tool name predicate).
 */
export function streamHasBrowserToolActivity(
  events: BrowserToolEventLike[],
  isBrowserTool: (tool: unknown) => boolean,
): boolean {
  return events.some(
    (e) => e.kind === "tool_request" && isBrowserTool(e.payload?.tool),
  );
}

function browserToolName(event: BrowserToolEventLike): string | null {
  const tool = event.payload?.tool;
  return typeof tool === "string" && tool.startsWith("browser_")
    ? tool
    : null;
}

function browserCallId(event: BrowserToolEventLike): string | null {
  const id = event.payload?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/**
 * A browser tool request and its receipt are one user-meaningful activity.
 * Keep the request (it carries the target) and suppress at most one matching
 * result. Independent calls remain independent even when they use the same tool.
 */
export function coalesceBrowserToolActivity<T extends BrowserToolEventLike>(
  events: T[],
): T[] {
  const output: T[] = [];
  const pendingById = new Map<string, number>();
  const pendingByTool = new Map<string, Set<number>>();
  const mergeReceipt = (requestIndex: number, receipt: T) => {
    const request = output[requestIndex]!;
    output[requestIndex] = {
      ...request,
      payload: {
        ...(request.payload ?? {}),
        ...(receipt.payload ?? {}),
        tool: request.payload?.tool ?? receipt.payload?.tool,
        id: request.payload?.id ?? receipt.payload?.id,
      },
    } as T;
    const requestId = browserCallId(request);
    if (requestId) pendingById.delete(requestId);
    const requestTool = browserToolName(request);
    if (requestTool) pendingByTool.get(requestTool)?.delete(requestIndex);
  };
  for (const event of events) {
    const tool = browserToolName(event);
    if (event.kind === "tool_request" && tool) {
      const index = output.push(event) - 1;
      const callId = browserCallId(event);
      if (callId) pendingById.set(callId, index);
      const pending = pendingByTool.get(tool) ?? new Set<number>();
      pending.add(index);
      pendingByTool.set(tool, pending);
      continue;
    }
    if (event.kind === "tool_result") {
      const callId = browserCallId(event);
      const exactIndex = callId ? pendingById.get(callId) : undefined;
      if (exactIndex !== undefined) {
        mergeReceipt(exactIndex, event);
        continue;
      }
      // Legacy receipts without identity may pair only when exactly one call
      // of the reported browser tool remains. Never guess across concurrency.
      if (!callId && tool) {
        const candidates = [...(pendingByTool.get(tool) ?? [])];
        if (candidates.length === 1) {
          mergeReceipt(candidates[0]!, event);
          continue;
        }
      }
    }
    output.push(event);
  }
  return output;
}
