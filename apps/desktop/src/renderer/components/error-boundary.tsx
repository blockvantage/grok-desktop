import React from "react";

/**
 * Last-resort crash screen. Intentionally self-contained: no i18n/toast/tooltip
 * hooks or external icon deps, so it still renders even when a provider or the
 * icon layer is what failed. Kept as a separate presentational component so it
 * can be unit-tested with renderToStaticMarkup (error boundaries don't fire
 * under server rendering).
 */
export function ErrorFallback(props: {
  error: Error | null;
  onReload: () => void;
}) {
  const message = props.error?.message?.trim() || "An unexpected error occurred.";
  return (
    <div
      role="alert"
      className="flex h-screen w-screen items-center justify-center bg-background p-8 text-foreground"
    >
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.03] p-6 text-center">
        <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-lg font-semibold text-destructive-text">
          <span aria-hidden>!</span>
        </div>
        <h1 className="text-base font-semibold">Something went wrong</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Grok Desk hit an unexpected error and couldn’t render this view. Your
          work is saved — reloading usually fixes it.
        </p>
        <pre className="mt-4 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-3 text-left text-2xs text-muted-foreground">
          {message}
        </pre>
        <button
          type="button"
          onClick={props.onReload}
          className="mt-4 inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reload Grok Desk
        </button>
      </div>
    </div>
  );
}

type ErrorBoundaryState = { error: Error | null };

/**
 * Top-level React error boundary. Without one, an uncaught render exception
 * anywhere in the tree unmounts the whole app and leaves a blank window; this
 * degrades to a recoverable crash screen instead.
 */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Forwarded to the main-process log for diagnostics.
    console.error(
      "[grokdesk] Uncaught render error:",
      error,
      info.componentStack,
    );
  }

  private handleReload = (): void => {
    if (typeof window !== "undefined") window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.error) {
      return (
        <ErrorFallback error={this.state.error} onReload={this.handleReload} />
      );
    }
    return this.props.children;
  }
}
