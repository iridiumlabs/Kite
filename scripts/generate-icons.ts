// Regenerate raster app icons from the SVG source: npx tsx scripts/generate-icons.ts
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";

const svg = await readFile(new URL("../app/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const sizes = [16, 32, 48];
  const icons: Buffer[] = [];
  for (const size of [...sizes, 180]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:100%;height:100%}</style>${svg}`);
    const png = await page.screenshot({ omitBackground: true });
    if (size === 180) {
      await writeFile(new URL("../app/apple-icon.png", import.meta.url), png);
    } else {
      icons.push(png);
    }
  }
  // ICO directory with PNG payloads, one native-resolution image per tab size.
  const directory = Buffer.alloc(6 + 16 * icons.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(icons.length, 4);
  let offset = directory.length;
  icons.forEach((png, i) => {
    const entry = 6 + 16 * i;
    directory[entry] = sizes[i];
    directory[entry + 1] = sizes[i];
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await writeFile(new URL("../app/favicon.ico", import.meta.url), Buffer.concat([directory, ...icons]));
  console.log("Generated favicon.ico (16/32/48px) and apple-icon.png (180px).");
} finally {
  await browser.close();
}
