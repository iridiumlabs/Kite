import { afterEach, expect, test, vi } from "vitest";
import { animateComposeResize, composeResizeTransform } from "../../lib/ui/composeResize";

const normal = { width: 640, height: 736, right: 1200, bottom: 800 };
const expanded = { width: 896, height: 736, right: 1200, bottom: 800 };

afterEach(() => vi.unstubAllGlobals());

test("expand inverts the new size while keeping the bottom-right anchor", () => {
  expect(composeResizeTransform(normal, expanded)).toBe("translate(0px, 0px) scale(0.7142857142857143, 1)");
});

test("restore follows the same path in reverse", () => {
  expect(composeResizeTransform(expanded, normal)).toBe("translate(0px, 0px) scale(1.4, 1)");
});

test("a rapid reversal can start at the live, partially expanded size", () => {
  expect(composeResizeTransform({ ...expanded, width: 800 }, normal)).toBe("translate(0px, 0px) scale(1.25, 1)");
});

test("a changed anchor and viewport-limited height are accounted for", () => {
  expect(composeResizeTransform(normal, { width: 800, height: 640, right: 1180, bottom: 780 })).toBe("translate(20px, 20px) scale(0.8, 1.15)");
});

test("unchanged or unmeasurable geometry does not animate", () => {
  expect(composeResizeTransform(normal, normal)).toBeNull();
  expect(composeResizeTransform({ ...normal, width: 0 }, expanded)).toBeNull();
  expect(composeResizeTransform(normal, { ...expanded, height: NaN })).toBeNull();
});

function fixture() {
  const animation = { cancel: vi.fn() } as unknown as Animation;
  const animate = vi.fn(() => animation);
  const element = { animate, getBoundingClientRect: vi.fn(() => expanded) } as unknown as HTMLElement;
  vi.stubGlobal("getComputedStyle", () => ({
    getPropertyValue: (name: string) => name === "--motion-drawer" ? "240ms" : "cubic-bezier(0.32, 0.72, 0, 1)",
  }));
  return { element, animate, animation };
}

test("the resize uses only a transform and the shared motion tokens, with no retained hidden state", () => {
  const { element, animate, animation } = fixture();
  expect(animateComposeResize(element, normal, false)).toBe(animation);
  expect(animate).toHaveBeenCalledWith(
    [{ transform: "translate(0px, 0px) scale(0.7142857142857143, 1)" }, { transform: "none" }],
    { duration: 240, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
  );
});

test("reduced motion, mobile or keyboard activation skips the resize animation", () => {
  const { element, animate } = fixture();
  expect(animateComposeResize(element, normal, true)).toBeNull();
  expect(animate).not.toHaveBeenCalled();
  expect(element.getBoundingClientRect).not.toHaveBeenCalled();
});

test("browsers without WAAPI simply keep the real layout", () => {
  const element = { getBoundingClientRect: vi.fn(() => expanded) } as unknown as HTMLElement;
  expect(animateComposeResize(element, normal, false)).toBeNull();
  expect(element.getBoundingClientRect).not.toHaveBeenCalled();
});
