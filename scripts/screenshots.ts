// Captures the /dev/preview frames into artifacts/screens for design
// comparison. Requires `next dev` on port 3000.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.PREVIEW_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "artifacts", "screens");

const SHOTS: {
  name: string;
  frame: string;
  theme?: "dark";
  width: number;
  height: number;
}[] = [
  { name: "inbox-selected", frame: "inbox-selected", width: 1440, height: 900 },
  {
    name: "inbox-no-selection",
    frame: "inbox-no-selection",
    width: 1440,
    height: 900,
  },
  { name: "compose", frame: "compose", width: 1440, height: 900 },
  { name: "profile-open", frame: "profile", width: 1440, height: 900 },
  { name: "empty", frame: "empty", width: 1440, height: 900 },
  { name: "loading", frame: "loading", width: 1440, height: 900 },
  {
    name: "inbox-selected-dark",
    frame: "inbox-selected",
    theme: "dark",
    width: 1440,
    height: 900,
  },
  {
    name: "inbox-selected-1024",
    frame: "inbox-selected",
    width: 1024,
    height: 768,
  },
  {
    name: "inbox-no-selection-1024",
    frame: "inbox-no-selection",
    width: 1024,
    height: 768,
  },
  {
    name: "inbox-selected-390",
    frame: "inbox-selected",
    width: 390,
    height: 844,
  },
  {
    name: "inbox-no-selection-390",
    frame: "inbox-no-selection",
    width: 390,
    height: 844,
  },
];

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const s of SHOTS) {
    const page = await browser.newPage({
      viewport: { width: s.width, height: s.height },
      deviceScaleFactor: 1,
    });
    const url = `${BASE}/dev/preview?frame=${s.frame}${s.theme ? `&theme=${s.theme}` : ""}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(600);
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLIFrameElement>("iframe.body-frame")].every(frame => {
      const doc = frame.contentDocument;
      return !!doc?.getElementById("kite-fonts") && doc.fonts.status === "loaded" &&
        frame.getBoundingClientRect().height + 1 >= doc.body.scrollHeight;
    }));
    const file = path.join(OUT, `${s.name}.png`);
    await page.screenshot({ path: file, animations: "disabled" });
    console.log("captured", file);
    await page.close();
  }
  await browser.close();
}

void main();
