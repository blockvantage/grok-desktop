/**
 * Client rect of the caret in a single-line input (canvas text metrics).
 */
export function getInputCaretClientRect(
  input: HTMLInputElement,
  position: number,
): DOMRect {
  const style = window.getComputedStyle(input);
  const r = input.getBoundingClientRect();
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  let textWidth = 0;
  if (ctx) {
    ctx.font = style.font || `${style.fontSize} ${style.fontFamily}`;
    const safePos = Math.max(0, Math.min(position, input.value.length));
    textWidth = ctx.measureText(input.value.slice(0, safePos)).width;
  }
  const left = r.left + borderLeft + padLeft + textWidth - input.scrollLeft;
  return new DOMRect(left, r.top, 1, r.height);
}

/**
 * Approximate client rect of the caret in a textarea (mirror-div technique).
 * Used to anchor autocomplete menus near the typing position.
 */
export function getTextareaCaretClientRect(
  textarea: HTMLTextAreaElement,
  position: number,
): DOMRect {
  const style = window.getComputedStyle(textarea);
  const div = document.createElement("div");
  const span = document.createElement("span");

  const props = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "fontSizeAdjust",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
    "whiteSpace",
    "wordWrap",
    "wordBreak",
  ] as const;

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";
  div.style.top = "0";
  div.style.left = "-9999px";

  for (const prop of props) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (div.style as any)[prop] = style.getPropertyValue(
      prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
    );
  }
  // Prefer direct copies that matter for layout fidelity
  div.style.boxSizing = style.boxSizing;
  div.style.width = `${textarea.clientWidth}px`;
  div.style.height = "auto";
  div.style.overflow = "hidden";
  div.style.font = style.font;
  div.style.fontSize = style.fontSize;
  div.style.fontFamily = style.fontFamily;
  div.style.fontWeight = style.fontWeight;
  div.style.lineHeight = style.lineHeight;
  div.style.letterSpacing = style.letterSpacing;
  div.style.padding = style.padding;
  div.style.border = style.border;
  div.style.textAlign = style.textAlign;
  div.style.whiteSpace = "pre-wrap";
  div.style.wordWrap = "break-word";

  const value = textarea.value;
  const safePos = Math.max(0, Math.min(position, value.length));
  div.textContent = value.slice(0, safePos);
  span.textContent = value.slice(safePos) || ".";
  div.appendChild(span);
  document.body.appendChild(div);

  const taRect = textarea.getBoundingClientRect();
  const spanRect = span.getBoundingClientRect();
  const divRect = div.getBoundingClientRect();

  // Offset within the mirror, then map to textarea client coords (+ scroll).
  const offsetTop = spanRect.top - divRect.top - textarea.scrollTop;
  const offsetLeft = spanRect.left - divRect.left - textarea.scrollLeft;

  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderLeft = parseFloat(style.borderLeftWidth) || 0;

  const top = taRect.top + borderTop + offsetTop;
  const left = taRect.left + borderLeft + offsetLeft;
  const height = spanRect.height || parseFloat(style.lineHeight) || 16;

  document.body.removeChild(div);

  return new DOMRect(left, top, 1, height);
}

export type MentionMenuPlacement = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
};

/**
 * Place a fixed menu near a caret rect, flipping and clamping to the viewport.
 */
export type CaretBox = {
  top: number;
  left: number;
  bottom: number;
  height: number;
};

export function placeMentionMenu(opts: {
  caret: CaretBox;
  menuWidth?: number;
  menuHeight?: number;
  gap?: number;
  padding?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}): MentionMenuPlacement {
  const gap = opts.gap ?? 6;
  const pad = opts.padding ?? 8;
  const vw = opts.viewportWidth ?? (typeof window !== "undefined" ? window.innerWidth : 800);
  const vh =
    opts.viewportHeight ?? (typeof window !== "undefined" ? window.innerHeight : 600);
  const width = Math.min(opts.menuWidth ?? 320, vw - pad * 2);
  const estimatedH = opts.menuHeight ?? 192;

  const spaceAbove = opts.caret.top - pad;
  const spaceBelow = vh - opts.caret.bottom - pad;

  let placement: "above" | "below" = "above";
  if (spaceAbove < estimatedH && spaceBelow > spaceAbove) {
    placement = "below";
  }

  let maxHeight = Math.min(
    estimatedH,
    placement === "above" ? Math.max(96, spaceAbove - gap) : Math.max(96, spaceBelow - gap),
  );

  let top =
    placement === "above"
      ? opts.caret.top - gap - maxHeight
      : opts.caret.bottom + gap;

  // If still off-screen, clamp.
  if (top < pad) {
    top = pad;
    maxHeight = Math.min(maxHeight, vh - pad * 2);
  }
  if (top + maxHeight > vh - pad) {
    maxHeight = Math.max(96, vh - pad - top);
  }

  let left = opts.caret.left;
  if (left + width > vw - pad) left = vw - pad - width;
  if (left < pad) left = pad;

  return { top, left, width, maxHeight, placement };
}
