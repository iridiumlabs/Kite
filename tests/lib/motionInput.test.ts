import { expect, test, vi } from "vitest";
import { observeMotionInput } from "../../lib/ui/motionInput";

// EventTarget fixture only. No DOM renderer or browser automation.
function fixture(previous?: string) {
  const attributes = new Map<string, string>();
  if (previous) attributes.set("data-motion-input", previous);
  const target = new EventTarget();
  const root = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  const windowFixture = Object.assign(target, {
    document: { documentElement: root },
  }) as unknown as Window;
  const change = vi.fn();
  const cleanup = observeMotionInput(windowFixture, change);
  const dispatch = (type: string, properties: Record<string, unknown>) => {
    const event = new Event(type);
    Object.assign(event, properties);
    target.dispatchEvent(event);
  };
  const input = () => root.getAttribute("data-motion-input");
  return { dispatch, input, change, cleanup };
}

test("starts instant and updates CSS modality before notifying React", () => {
  const f = fixture();
  expect(f.input()).toBe("keyboard");
  f.change.mockImplementation(() => expect(f.input()).toBe("pointer"));
  f.dispatch("pointerdown", { isPrimary: true, button: 0 });
  expect(f.change).toHaveBeenCalledWith("pointer");
  f.cleanup();
});

test("primary mouse, touch and pen presses enable motion only once", () => {
  const f = fixture();
  for (const pointerType of ["mouse", "touch", "pen"]) {
    f.dispatch("pointerdown", { pointerType, isPrimary: true, button: 0 });
  }
  expect(f.input()).toBe("pointer");
  expect(f.change).toHaveBeenCalledTimes(1);
  f.cleanup();
});

test("secondary buttons and additional fingers do not change modality", () => {
  const f = fixture();
  f.dispatch("pointerdown", { isPrimary: true, button: 2 });
  f.dispatch("pointerdown", { isPrimary: false, button: 0 });
  expect(f.input()).toBe("keyboard");
  expect(f.change).not.toHaveBeenCalled();
  f.cleanup();
});

test.each(["Escape", "Enter", " ", "c", "r", "k", "Tab"])("%s makes subsequent interactions instant", key => {
  const f = fixture();
  f.dispatch("pointerdown", { isPrimary: true, button: 0 });
  f.dispatch("keydown", { key });
  expect(f.input()).toBe("keyboard");
  expect(f.change).toHaveBeenLastCalledWith("keyboard");
  f.cleanup();
});

test("modifier-only keys do not interrupt pointer motion, but shortcuts do", () => {
  const f = fixture();
  f.dispatch("pointerdown", { isPrimary: true, button: 0 });
  for (const key of ["Shift", "Control", "Alt", "Meta"]) f.dispatch("keydown", { key });
  expect(f.input()).toBe("pointer");
  f.dispatch("keydown", { key: ",", metaKey: true });
  expect(f.input()).toBe("keyboard");
  f.cleanup();
});

test.each([undefined, "pointer"])("cleanup restores the previous attribute (%s) and removes listeners", previous => {
  const f = fixture(previous);
  f.dispatch("pointerdown", { isPrimary: true, button: 0 });
  f.cleanup();
  expect(f.input()).toBe(previous ?? null);
  f.change.mockClear();
  f.dispatch("keydown", { key: "Escape" });
  f.dispatch("pointerdown", { isPrimary: true, button: 0 });
  expect(f.change).not.toHaveBeenCalled();
  expect(f.input()).toBe(previous ?? null);
});
