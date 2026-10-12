export type MotionInput = "keyboard" | "pointer";

/** Capture before React handlers so portals and shortcut-opened surfaces agree. */
export function observeMotionInput(
  target: Window,
  onChange: (input: MotionInput) => void,
): () => void {
  const root = target.document.documentElement;
  const previous = root.getAttribute("data-motion-input");
  let input: MotionInput = "keyboard";
  root.setAttribute("data-motion-input", input);

  const update = (next: MotionInput) => {
    if (input === next) return;
    input = next;
    root.setAttribute("data-motion-input", next);
    onChange(next);
  };
  const keydown = (event: KeyboardEvent) => {
    // A modifier alone should not interrupt a pointer interaction.
    if (["Shift", "Control", "Alt", "Meta"].includes(event.key)) return;
    update("keyboard");
  };
  const pointerdown = (event: PointerEvent) => {
    if (event.isPrimary && event.button === 0) update("pointer");
  };
  const options = { capture: true };
  target.addEventListener("keydown", keydown, options);
  target.addEventListener("pointerdown", pointerdown, options);
  return () => {
    target.removeEventListener("keydown", keydown, options);
    target.removeEventListener("pointerdown", pointerdown, options);
    if (previous === null) root.removeAttribute("data-motion-input");
    else root.setAttribute("data-motion-input", previous);
  };
}
