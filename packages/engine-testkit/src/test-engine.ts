import path from "node:path";
import type {
  EngineAdapter,
  EngineRunOptions,
  NormalizedEngineEvent,
} from "@grokdesk/engine-grok";

/**
 * Deterministic engine for unit/integration tests only.
 * Never imported by production composition — use engine override injection.
 */
export class TestEngine implements EngineAdapter {
  readonly executesOwnTools = false;
  private cancelled = new Set<string>();

  async cancel(taskId: string): Promise<void> {
    this.cancelled.add(taskId);
  }

  async run(options: EngineRunOptions): Promise<void> {
    const { task, onEvent } = options;
    if (this.cancelled.has(task.id)) return;

    const emit = async (event: NormalizedEngineEvent): Promise<boolean> => {
      if (this.cancelled.has(task.id)) return false;
      const signal = await onEvent(event);
      if (signal === "abort") return false;
      if (this.cancelled.has(task.id)) return false;
      return true;
    };

    if (!(await emit({ type: "step", title: "Plan work", status: "start" }))) {
      return;
    }
    if (!(await emit({ type: "step", title: "Plan work", status: "end" }))) {
      return;
    }

    if (
      !(await emit({
        type: "message",
        role: "assistant",
        text: `Working on: ${task.goal}`,
      }))
    ) {
      return;
    }

    const root = task.policySnapshot.workspaceRoots[0];
    if (!root) {
      await emit({
        type: "error",
        message: "No workspace root configured",
      });
      return;
    }

    const outPath = path.join(root, "grokdesk-output.md");
    const toolId = "tool-1";
    const content = `# Result\n\n${task.goal}\n`;

    if (
      !(await emit({
        type: "tool_request",
        id: toolId,
        tool: "write_file",
        path: outPath,
        meta: { content },
      }))
    ) {
      return;
    }

    if (
      !(await emit({
        type: "tool_result",
        id: toolId,
        ok: true,
        output: `wrote ${outPath}`,
      }))
    ) {
      return;
    }

    if (
      !(await emit({
        type: "artifact",
        title: "Result",
        path: outPath,
        kind: "report",
      }))
    ) {
      return;
    }

    await emit({ type: "done", summary: "Completed fake run" });
  }
}
