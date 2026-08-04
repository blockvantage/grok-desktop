import { cn } from "@/lib/utils";

/**
 * Grok Desk app icon from the renderer public dir (copied next to index.html).
 *
 * IMPORTANT: do not use root-absolute paths like "/grok-desk-icon.png".
 * Packaged Electron loads the UI via file://, so absolute URLs resolve to
 * the filesystem root and the image 404s. BASE_URL is "./" under electron-vite.
 */
export function BrandMark({ className }: { className?: string }) {
  const src = `${import.meta.env.BASE_URL}grok-desk-icon.png`;
  return (
    <img
      src={src}
      alt="Grok Desk"
      draggable={false}
      className={cn(
        // Soft inset highlight + scarce ice outer glow (brand mark on midnight chrome)
        "select-none rounded-xl object-cover shadow-[0_1px_0_0_rgba(255,255,255,0.16)_inset,0_8px_20px_-10px_rgba(0,0,0,0.7),0_0_28px_-10px_rgba(159,221,255,0.35)] ring-1 ring-primary/20",
        className,
      )}
    />
  );
}
