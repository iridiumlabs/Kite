import { expect, test } from "vitest";
import { adaptDarkMessage, darkMessageBackground, darkMessageForeground, messageFrameDoc } from "../../lib/ui/messageFrame";

test("message frame is full-width and centres fixed-width templates", () => {
  const doc = messageFrameDoc('<table width="600"><tr><td>Hello</td></tr></table>', false, false);
  expect(doc).toContain("width: 100%");
  expect(doc).toContain("margin-inline: auto !important");
  expect(doc).toContain("max-width: 100% !important");
  expect(doc).not.toContain("padding:8px");
});

test("frame keeps the existing script and remote-image restrictions in both themes", () => {
  for (const dark of [false, true]) {
    const blocked = messageFrameDoc("<p>Hello</p>", dark, false);
    expect(blocked).toContain("default-src 'none'");
    expect(blocked).toContain("img-src data:");
    expect(blocked).not.toContain("allow-scripts");
    expect(blocked).not.toContain("<script");
    expect(messageFrameDoc("<p>Hello</p>", dark, true)).toContain("img-src https: data:");
  }
  expect(messageFrameDoc("<p>Hello</p>", true, false)).toContain("background:#1c1c1e");
});

test("neutral light surfaces and dark text adapt without changing brand colours", () => {
  expect(darkMessageBackground("rgb(255, 255, 255)")).toBe("rgb(28, 28, 30)");
  expect(darkMessageBackground("rgb(218, 218, 220)")).toBe("rgb(35, 35, 37)");
  expect(darkMessageBackground("rgb(28, 28, 30)")).toBeUndefined();
  expect(darkMessageBackground("rgba(255, 255, 255, 0)")).toBeUndefined();
  expect(darkMessageBackground("rgb(111, 44, 255)")).toBeUndefined();
  expect(darkMessageForeground("rgb(0, 0, 0)")).toBe("rgba(245, 245, 247, 1)");
  expect(darkMessageForeground("rgb(110, 110, 115)")).toBe("rgba(195, 195, 197, 1)");
  expect(darkMessageForeground("rgb(255, 255, 255)")).toBeUndefined();
  expect(darkMessageForeground("rgb(111, 44, 255)")).toBeUndefined();
});

test("adaptation handles inherited text, preserves branded and photographic panels, and reads before writing", () => {
  type Node = {
    parentElement: Node | null;
    original: { backgroundColor: string; backgroundImage: string; color: string };
    applied: Record<string, string>;
    style: { setProperty: (name: string, value: string, priority: string) => void };
  };
  let writes = 0;
  const node = (parent: Node | null, background: string, color = "rgb(0, 0, 0)", image = "none"): Node => {
    const applied: Record<string, string> = {};
    return {
      parentElement: parent, original: { backgroundColor: background, backgroundImage: image, color }, applied,
      style: { setProperty: (name, value, priority) => {
        writes++;
        expect(priority).toBe("important");
        applied[name] = value;
      } },
    };
  };
  const body = node(null, "rgb(28, 28, 30)");
  const white = node(body, "rgb(255, 255, 255)");
  const text = node(white, "rgba(0, 0, 0, 0)");
  const brand = node(body, "rgb(111, 44, 255)", "rgb(255, 255, 255)");
  const brandText = node(brand, "rgba(0, 0, 0, 0)", "rgb(255, 255, 255)");
  const lightBrand = node(body, "rgb(255, 230, 100)");
  const lightBrandText = node(lightBrand, "rgba(0, 0, 0, 0)");
  const photo = node(body, "rgb(255, 255, 255)", "rgb(0, 0, 0)", 'url("https://example.com/photo.jpg")');
  const elements = [white, text, brand, brandText, lightBrand, lightBrandText, photo];
  const doc = {
    documentElement: { dataset: {} },
    body: { ...body, querySelectorAll: () => elements },
    defaultView: { getComputedStyle: (element: Node) => {
      expect(writes).toBe(0);
      return element.original;
    } },
  } as unknown as Document;
  adaptDarkMessage(doc);
  const firstWrites = writes;
  adaptDarkMessage(doc);
  expect(writes).toBe(firstWrites);
  expect(white.applied).toMatchObject({ "background-color": "rgb(28, 28, 30)", color: "rgba(245, 245, 247, 1)" });
  expect(text.applied.color).toBe("rgba(245, 245, 247, 1)");
  expect(brand.applied).toEqual({});
  expect(brandText.applied).toEqual({});
  expect(lightBrand.applied).toEqual({});
  expect(lightBrandText.applied).toEqual({});
  expect(photo.applied).toEqual({});
});
