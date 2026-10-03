/**
 * Box-structure analysis (practice 1 & 2: read the page as parent/child boxes).
 *
 * Per page and per viewport width it reports:
 *   - horizontal overflow (boxes that stick out of the viewport and are not
 *     inside a scroll/clip ancestor, e.g. an intentional carousel track)
 *   - the layout mode of every container that arranges other boxes:
 *     display / direction / grid-template-columns / gap / flex-grow items
 *
 * Usage: node scripts/box-analysis.mjs [page...]
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { probe, report } from "./probe.mjs";

const BASE = "http://localhost:5173";
const SHOTS = process.env.ONEMART_BOX_SHOTS ?? join(tmpdir(), "opencode", "onemart-boxes");
mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [390, 768, 1024, 1440, 2560];

const PAGES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["/", "/products", "/cart"];

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"],
});

for (const path of PAGES) {
  for (const width of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    const res = await page.evaluate(probe);
    report(path, width, res);
    const tag = `${path.replace(/[^a-z0-9]+/gi, "_") || "home"}@${width}`;
    await page.screenshot({ path: `${SHOTS}\\${tag}.png` });
    await page.close();
  }
}

await browser.close();
console.log(`\nshots: ${SHOTS}`);
