/**
 * Best-effort chat title generation (Grok optional capability).
 * Isolated so Gateway does not embed generateGrokTitle call sites.
 *
 * When an EntitlementGuard is provided, refuses to call the model if the
 * lease does not allow grok_operation (silent skip — UI falls back to goal).
 */
import { generateGrokTitle } from "../engine-composition.js";
import type { EntitlementGuard } from "./entitlement-guard.js";
import { isEntitlementReadOnlyError } from "./entitlement-error.js";

export type TitleSetter = {
  get(taskId: string): { title: string | null } | null;
  setTitle(taskId: string, title: string): unknown;
};

/**
 * Name a new chat with a short model-generated title. Failures are silent —
 * UI falls back to a trimmed goal.
 */
export async function autoTitleTask(
  tasks: TitleSetter,
  taskId: string,
  goal: string,
  model: string,
  generate: typeof generateGrokTitle = generateGrokTitle,
  entitlementGuard?: EntitlementGuard | null,
): Promise<void> {
  try {
    if (entitlementGuard) {
      await entitlementGuard.assertCapability(
        "grok_operation",
        "title_generation",
      );
    }
    const title = await generate(goal, { model });
    if (!title) return;
    const cur = tasks.get(taskId);
    if (cur && !cur.title) tasks.setTitle(taskId, title);
  } catch (e) {
    // Titling is non-essential. Entitlement denials are also silent so
    // create-path remains usable in read-only mode (goal used as title).
    if (isEntitlementReadOnlyError(e)) return;
    // other generator errors swallowed
  }
}
