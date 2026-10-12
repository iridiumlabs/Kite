// Local-only UI regression. Never sends mail; discards only its own test draft.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.KITE_UI_URL ?? "http://localhost:3000";

async function main() {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(BASE).hostname), "This test is local-only");
  assert.ok((await fetch(`${BASE}/api/dev-auth/token`)).ok, "Start the dev-auth harness first");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let opened = false;
  const composer = page.locator('[role="dialog"]').filter({ has: page.locator(".ProseMirror") });
  try {
    await page.goto(`${BASE}/mail/primary`, { waitUntil: "domcontentloaded" });
    const compose = page.getByRole("button", { name: "Compose", exact: true });
    await compose.click();
    opened = true;
    const subject = `Compose controls regression ${Date.now()}`;
    await composer.getByPlaceholder("Subject", { exact: true }).fill(subject);
    await composer.locator(".ProseMirror").fill("Keep this unsaved body intact.");
    for (let i = 0; i < 3; i++) await compose.click();
    assert.equal(await composer.count(), 1, "Repeated Compose clicks must not stack windows");
    assert.equal(await composer.getByPlaceholder("Subject", { exact: true }).inputValue(), subject);
    assert.equal(await composer.locator(".ProseMirror").innerText(), "Keep this unsaved body intact.");
    console.log("PASS repeated Compose clicks preserve one editor and its text");

    await composer.getByRole("button", { name: "Minimize", exact: true }).click();
    await compose.click();
    await composer.waitFor();
    assert.equal(await composer.count(), 1);
    assert.equal(await composer.locator(".ProseMirror").innerText(), "Keep this unsaved body intact.");
    console.log("PASS Compose restores a minimized editor without losing text");

    for (const field of [composer.getByPlaceholder("Subject", { exact: true }), composer.locator("input").first(), composer.locator(".ProseMirror")]) {
      await field.click();
      assert.equal(await field.evaluate(el => getComputedStyle(el).outlineStyle), "none", "Borderless editing fields must not gain a focus rectangle");
    }
    console.log("PASS borderless subject, recipients and body have no focus outline");
    await composer.getByRole("button", { name: "Discard draft", exact: true }).click();
    opened = false;
    await composer.waitFor({ state: "hidden" });

    const primary = page.getByRole("button", { name: /^Primary/ }).first();
    await primary.click();
    await primary.hover();
    assert.equal(await primary.evaluate(el => getComputedStyle(el).outlineStyle), "none");
    await page.keyboard.press("Tab");
    await primary.focus();
    const focus = await primary.evaluate(el => ({ visible: el.matches(":focus-visible"), outline: getComputedStyle(el).outlineStyle, marker: getComputedStyle(el).boxShadow }));
    assert.equal(focus.visible, true);
    assert.equal(focus.outline, "none");
    assert.notEqual(focus.marker, "none", "Keyboard users must retain a visible row focus marker");
    console.log("PASS navigation hover has no rectangle and keyboard focus keeps its marker");
    assert.deepEqual(errors, [], "Unexpected browser errors");
    console.log("All compose/focus regression checks passed");
  } finally {
    if (opened) {
      const discard = page.getByRole("button", { name: "Discard draft", exact: true });
      if (await discard.isVisible().catch(() => false)) await discard.click().catch(() => {});
    }
    await browser.close();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
