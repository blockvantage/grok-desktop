/**
 * Task 16: sticky conversation composer shell.
 * Children supply the actual form controls so App/workspace keep single
 * sources of truth for drafts and busy flags.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function ConversationComposer(props: {
  children: ReactNode;
  browserOpen?: boolean;
  dragOver?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-[5] border-t border-white/[0.05] bg-background/80 py-2.5 backdrop-blur sm:py-3",
        props.browserOpen ? "px-3" : "px-6",
        props.className,
      )}
      data-testid="workspace-sticky-composer"
      data-conversation-composer
      data-drag-over={props.dragOver ? "true" : undefined}
    >
      {props.children}
    </div>
  );
}
