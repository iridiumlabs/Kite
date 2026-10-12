// Local-only profile controls test. Dev identity changes stay in this browser.
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { chromium } from "playwright";
import { api } from "../convex/_generated/api";

const BASE = process.env.POST_UI_URL ?? "http://localhost:3000";
const BACKEND = process.env.POST_CONVEX_URL ?? "http://127.0.0.1:3210";

async function main() {
  for (const url of [BASE, BACKEND]) assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "This test is local-only");
  const response = await fetch(`${BASE}/api/dev-auth/token`);
  assert.ok(response.ok, "Start the local dev-auth harness first");
  const { token } = await response.json() as { token: string };
  const client = new ConvexHttpClient(BACKEND);
  client.setAuth(token);
  const original = await client.query(api.settings.get, {});
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`${BASE}/mail/primary`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Dev user/ }).first().waitFor();
    await page.keyboard.press("Control+,");
    await page.getByLabel("First name", { exact: true }).fill("Profile");
    await page.getByLabel("Last name", { exact: true }).fill("Regression");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    // Settings makes background controls inert; inspect the sidebar without interacting.
    const profile = page.getByRole("button", { name: /Profile Regression/, includeHidden: true }).first();
    await profile.waitFor();
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 2;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#FF9F0A";
      context.fillRect(0, 0, 2, 2);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.getByLabel("Profile photo", { exact: true }).setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await page.getByRole("button", { name: "Remove photo", exact: true }).waitFor();
    await page.locator("[data-profile-photo] img").waitFor();
    await page.waitForFunction(() => {
      const img = document.querySelector<HTMLImageElement>("[data-profile-photo] img");
      return img?.complete && img.naturalWidth === 256;
    });
    assert.equal(await profile.locator("img").getAttribute("src"), await page.locator("[data-profile-photo] img").getAttribute("src"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await profile.waitFor();
    await profile.locator("img").waitFor();
    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: "Remove photo", exact: true }).waitFor();
    assert.equal(await page.getByLabel("First name", { exact: true }).inputValue(), "Profile");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: "artifacts/e2e/profile-settings-desktop.png", animations: "disabled" });
    console.log("PASS profile name/avatar update sidebar immediately and survive reload");

    await page.getByLabel("Profile photo", { exact: true }).setInputFiles({ name: "unsafe.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
    await page.getByText("Choose a PNG, JPEG or WebP image.", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-profile-photo] img").count(), 1);
    await page.getByRole("button", { name: "Remove photo", exact: true }).click();
    await page.getByRole("button", { name: "Upload photo", exact: true }).waitFor();
    assert.equal(await profile.locator("img").count(), 0);
    console.log("PASS rejected avatar upload preserves photo; removal restores initials");

    assert.equal(await page.locator("select").count(), 0);
    const dropdown = page.getByRole("combobox", { name: "Default account", exact: true });
    await dropdown.click();
    await page.getByRole("option", { name: "First account", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Close settings", exact: true }).waitFor();
    await page.getByRole("option", { name: "First account", exact: true }).waitFor({ state: "hidden" });
    await dropdown.focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("option", { name: "First account", exact: true }).click();
    await page.getByRole("option", { name: "First account", exact: true }).waitFor({ state: "hidden" });
    console.log("PASS styled dropdown, selection and Escape leave Settings open");

    const toggle = page.getByRole("switch", { name: "Automatically load remote images", exact: true });
    const box = await toggle.boundingBox();
    assert.ok(box && box.width === 36 && box.height === 22, "Switch must have a real, bounded track");
    await toggle.click();
    for (let i = 0; i < 100; i++) {
      if ((await client.query(api.settings.get, {})).loadRemoteImages !== original.loadRemoteImages) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.notEqual((await client.query(api.settings.get, {})).loadRemoteImages, original.loadRemoteImages);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('[role="dialog"]').evaluate(el => el.scrollWidth <= el.clientWidth), true);
    assert.equal(await page.getByLabel("First name", { exact: true }).evaluate(el => el.getBoundingClientRect().right <= innerWidth), true);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: "artifacts/e2e/profile-settings-390.png", animations: "disabled" });
    console.log("PASS aligned privacy switch and phone Settings layout");
    assert.deepEqual(errors, [], "Unexpected browser errors");
    console.log("All profile/settings checks passed");
  } finally {
    await browser.close();
    await client.mutation(api.settings.update, {
      loadRemoteImages: original.loadRemoteImages,
      defaultAccountId: ("defaultAccountId" in original ? original.defaultAccountId : undefined) ?? null,
    });
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
