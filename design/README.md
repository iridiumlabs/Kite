# Kite design references

The JSX and tree files are rebranded Paper design references. The PNGs are refreshed captures of the working Kite `/dev/preview` screens, not the original Paper exports.

Run `npm run dev` and `npx tsx scripts/screenshots.ts`, then copy the three corresponding images from `artifacts/screens/` into this directory. These scripts use Playwright's Chromium; install it with `npx playwright install chromium` if needed.

The app icon source is `app/icon.svg`: a minimal two-tone blue kite (`#007AFF`) with a short curved tail on a transparent background, without a surrounding tile. Regenerate `app/favicon.ico` (16, 32 and 48px) and `app/apple-icon.png` (180px) with `npx tsx scripts/generate-icons.ts`. Next.js automatically publishes these assets and adds their metadata links.
