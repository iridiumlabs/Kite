// Local-only browser regression for the real next-themes/Convex integration.
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { chromium, type Page } from "playwright";
import { api } from "../convex/_generated/api";
import type { Appearance } from "../lib/ui/useAppearance";

const BASE = process.env.KITE_UI_URL ?? "http://localhost:3000";
const BACKEND = process.env.KITE_CONVEX_URL ?? "http://127.0.0.1:3210";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function skin(page: Page, dark: boolean) {
  await page.waitForFunction(want => document.documentElement.classList.contains("dark") === want, dark);
}

async function chooseProfile(page: Page, appearance: Appearance) {
  await page.getByRole("button", { name: /Dev user/ }).first().click();
  await page.getByRole("menuitem", { name: /Appearance/ }).hover();
  const label = appearance[0].toUpperCase() + appearance.slice(1);
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}

async function main() {
  for (const url of [BASE, BACKEND]) {
    assert.ok(["localhost", "127.0.0.1"].includes(new URL(url).hostname), "This test is local-only");
  }
  const res = await fetch(`${BASE}/api/dev-auth/token`);
  assert.ok(res.ok, "Start the local dev-auth harness first");
  const { token } = await res.json() as { token: string };
  const client = new ConvexHttpClient(BACKEND);
  client.setAuth(token);
  const original = (await client.query(api.settings.get, {})).theme ?? "system";
  const browser = await chromium.launch();
  const context = await browser.newContext({ colorScheme: "light", reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const persisted = async (appearance: Appearance) => {
    for (let i = 0; i < 100; i++) {
      if ((await client.query(api.settings.get, {})).theme === appearance) return;
      await sleep(50);
    }
    throw new Error(`Theme was not persisted: ${appearance}`);
  };
  const freshBrowser = async (appearance: Appearance, os: "light" | "dark") => {
    const fresh = await browser.newContext({ colorScheme: os });
    try {
      const next = await fresh.newPage();
      next.on("pageerror", error => errors.push(error.message));
      await next.goto(`${BASE}/mail/primary`, { waitUntil: "domcontentloaded" });
      await next.getByRole("button", { name: /Dev user/ }).first().waitFor();
      await skin(next, appearance === "dark" || (appearance === "system" && os === "dark"));
      // A fresh browser has no theme localStorage until the backend applies it.
      await next.waitForFunction(want => (localStorage.getItem("theme") ?? "system") === want, appearance);
    } catch (error) {
      console.error("Fresh theme diagnostics", await fresh.pages()[0]?.evaluate(() => ({
        classes: document.documentElement.className,
        stored: localStorage.getItem("theme"),
        darkOS: matchMedia("(prefers-color-scheme: dark)").matches,
      })));
      throw error;
    } finally { await fresh.close(); }
  };
  try {
    await client.mutation(api.settings.update, { theme: "light" });
    await page.goto(`${BASE}/mail/primary`, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Dev user/ }).first().waitFor();
    await skin(page, false);

    for (const [appearance, destination] of [["dark", "other"], ["light", "archive"], ["system", "trash"]] as const) {
      await page.emulateMedia({ colorScheme: appearance === "system" ? "dark" : "light" });
      await chooseProfile(page, appearance);
      // Navigate immediately, without waiting for the server mutation.
      await page.getByRole("button", { name: new RegExp(`^${destination}`, "i") }).first().click();
      await page.waitForURL(`**/mail/${destination}`);
      await skin(page, appearance !== "light");
      await persisted(appearance);
      await page.reload({ waitUntil: "domcontentloaded" });
      await skin(page, appearance !== "light");
      await freshBrowser(appearance, "light");
      if (appearance === "system") {
        await freshBrowser(appearance, "dark");
        await page.emulateMedia({ colorScheme: "light" });
        await skin(page, false);
      }
      console.log(`PASS profile ${appearance}: navigation, reload and fresh browser`);
    }

    await page.keyboard.press("Control+,");
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("button", { name: "Light", exact: true }).click();
    await persisted("light");
    await page.getByRole("button", { name: "MCP & API Keys", exact: true }).click();
    const url = new URL("/api/mcp", BASE).href;
    await page.getByText(url, { exact: true }).waitFor();
    console.log("PASS Settings theme save and current-origin MCP URL");
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.getByRole("button", { name: "Close settings", exact: true }).waitFor({ state: "hidden" });
    await page.keyboard.press("Control+k");
    await page.getByPlaceholder("Search mail or type a command").waitFor();
    await page.getByText("Switch to dark theme", { exact: true }).click();
    await persisted("dark");
    await freshBrowser("dark", "light");
    console.log("PASS command palette persists appearance");
    assert.deepEqual(errors, [], "Unexpected browser errors");
    console.log("All appearance regression checks passed");
  } finally {
    await browser.close();
    await client.mutation(api.settings.update, { theme: original });
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
