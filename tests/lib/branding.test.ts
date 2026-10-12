// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { API_KEY_PREFIX as backendPrefix } from "../../convex/lib/apiKeyFormat";
import { API_KEY_PREFIX as httpPrefix } from "../../lib/mcp/http";
import { DEV_PROFILE_EVENT, DEV_PROFILE_KEY } from "../../lib/ui/profile";

const asset = (name: string) => readFileSync(new URL(`../../app/${name}`, import.meta.url));

test("Kite API keys and browser profile namespaces are consistent", () => {
  expect(backendPrefix).toBe("kite_sk_");
  expect(httpPrefix).toBe(backendPrefix);
  expect(DEV_PROFILE_KEY).toBe("kite.dev-profile");
  expect(DEV_PROFILE_EVENT).toBe("kite:dev-profile");
});

test("the favicon contains valid native-resolution PNGs for small browser tabs", () => {
  const ico = asset("favicon.ico");
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(3);
  let expectedOffset = 54;
  [16, 32, 48].forEach((size, i) => {
    const entry = 6 + i * 16;
    expect(ico[entry]).toBe(size);
    expect(ico[entry + 1]).toBe(size);
    const length = ico.readUInt32LE(entry + 8);
    const offset = ico.readUInt32LE(entry + 12);
    expect(offset).toBe(expectedOffset);
    const png = ico.subarray(offset, offset + length);
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    expectedOffset += length;
  });
  expect(expectedOffset).toBe(ico.length);
});

test("the SVG source and Apple home-screen icon are available", () => {
  const svg = asset("icon.svg").toString();
  expect(svg).toContain("<title>Kite</title>");
  expect(svg).toContain('viewBox="0 0 64 64"');
  expect(svg).toContain("#007AFF");
  expect(svg).not.toMatch(/<(?:rect|image)\b/);
  const png = asset("apple-icon.png");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  expect(png.readUInt32BE(16)).toBe(180);
  expect(png.readUInt32BE(20)).toBe(180);
});
