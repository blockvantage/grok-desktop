import { flushSync } from "react-dom";
import { prefersReducedMotion } from "./motion-system";

type ViewTransitionLike = {
  finished?: Promise<void>;
};

type DocumentWithVT = Document & {
  startViewTransition?: (
    callback: () => void | Promise<void>,
  ) => ViewTransitionLike;
};

/** True while a native view transition is in flight (prevents stacked ghosts). */
let viewTransitionBusy = false;

/**
 * Run a React state update inside a native View Transition so the DOM before/after
 * cross-fades (and named elements morph). Falls back to a plain synchronous update
 * when the API is unavailable, the user prefers reduced motion, or a transition is
 * already running (always applies `update` — never drops state).
 *
 * `flushSync` forces React to commit the DOM change synchronously inside the
 * transition callback, which is what the View Transitions API captures against.
 */
export function withViewTransition(update: () => void): void {
  const doc = document as DocumentWithVT;
  if (
    viewTransitionBusy ||
    typeof doc.startViewTransition !== "function" ||
    prefersReducedMotion()
  ) {
    update();
    return;
  }
  viewTransitionBusy = true;
  let applied = false;
  try {
    const transition = doc.startViewTransition(() => {
      flushSync(update);
      applied = true;
    });
    const finished = transition?.finished;
    if (finished && typeof finished.then === "function") {
      void finished.finally(() => {
        viewTransitionBusy = false;
      });
    } else {
      viewTransitionBusy = false;
    }
  } catch {
    viewTransitionBusy = false;
    // Only re-apply if the transition callback never ran (never drop state,
    // never double-apply when the callback already committed).
    if (!applied) update();
  }
}

/** Test helper — reset busy flag between unit tests. */
export function __resetViewTransitionBusyForTests(): void {
  viewTransitionBusy = false;
}
