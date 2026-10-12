// Browser-only branding smoke test; requires Next dev, no mailbox/backend needed.
// npx tsx scripts/live-branding.ts
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.KITE_UI_URL ?? "http://localhost:3000";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/dev/preview?frame=inbox-selected`, { waitUntil: "domcontentloaded" });
  await page.getByText("Re: Kite beta onboarding feedback", { exact: true }).first().waitFor();
  assert.equal(await page.title(), "Kite");
  assert.equal(await page.locator('meta[name="application-name"]').getAttribute("content"), "Kite");
  assert.equal(await page.locator('meta[name="description"]').getAttribute("content"), "Kite — a personal email client");
  const icons = await page.locator('link[rel="icon"],link[rel="apple-touch-icon"]').evaluateAll(
    nodes => nodes.map(node => ({
      href: (node as HTMLLinkElement).href,
      rel: (node as HTMLLinkElement).rel,
    })),
  );
  for (const name of ["favicon.ico", "icon.svg", "apple-icon.png"]) {
    const icon = icons.find(item => new URL(item.href).pathname === `/${name}`);
    assert.ok(icon, `Missing head link for ${name}`);
    const response = await page.request.get(icon.href);
    assert.equal(response.status(), 200);
    assert.ok((await response.body()).length > 100);
  }
  await page.getByText("arham@kitemail.app", { exact: true }).waitFor();
  await page.goto(`${base}/dev/preview?frame=inbox-selected&theme=dark`);
  assert.equal(await page.title(), "Kite");
  await page.waitForFunction(() => document.documentElement.classList.contains("dark"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/dev/preview?frame=compose`);
  await page.getByText("Thursday walkthrough: import flow fixes", { exact: true }).first().waitFor();
  assert.equal(await page.title(), "Kite");
  assert.equal(await page.locator(".ProseMirror").count(), 1);
  const unauthenticated = await page.request.post(`${base}/api/mcp`, { data: {} });
  assert.equal(unauthenticated.status(), 401);
  assert.deepEqual(errors, []);
  console.log("Kite metadata, favicon links/assets, fixtures, dark/mobile previews and MCP auth passed.");
} finally {
  await browser.close();
}
