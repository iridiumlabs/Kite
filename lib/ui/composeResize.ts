type Bounds = Pick<DOMRectReadOnly, "width" | "height" | "right" | "bottom">;

/** Invert the new layout back to the live, pre-toggle rectangle. */
export function composeResizeTransform(from: Bounds, to: Bounds): string | null {
  if ([from.width, from.height, to.width, to.height].some(size => !Number.isFinite(size) || size <= 0)) return null;
  if (from.width === to.width && from.height === to.height && from.right === to.right && from.bottom === to.bottom) return null;
  return `translate(${from.right - to.right}px, ${from.bottom - to.bottom}px) scale(${from.width / to.width}, ${from.height / to.height})`;
}

/** Only animate the transform, never the editor's layout on every frame. */
export function animateComposeResize(element: HTMLElement, from: Bounds, disabled: boolean): Animation | null {
  if (disabled || typeof element.animate !== "function") return null;
  const transform = composeResizeTransform(from, element.getBoundingClientRect());
  if (!transform) return null;
  const style = getComputedStyle(element);
  const duration = style.getPropertyValue("--motion-drawer").trim();
  return element.animate(
    [{ transform }, { transform: "none" }],
    {
      duration: duration.endsWith("ms") ? parseFloat(duration) : duration.endsWith("s") ? parseFloat(duration) * 1000 : 240,
      easing: style.getPropertyValue("--ease-drawer").trim() || "cubic-bezier(0.32, 0.72, 0, 1)",
      // No fill: the real expanded/restored layout is always the final state.
    },
  );
}
