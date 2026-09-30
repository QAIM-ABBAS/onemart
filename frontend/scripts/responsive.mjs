import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:5173";
const SHOTS = "C:\\Users\\qaima\\AppData\\Local\\Temp\\opencode\\shots";
mkdirSync(SHOTS, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"],
});

async function shoot(name, url, width, height, prep) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(BASE + url, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  if (prep) await prep(page).catch(() => {});
  await page.screenshot({ path: `${SHOTS}\\${name}.png` });
  await page.close();
  console.log("shot " + name);
}

await shoot("m1-home", "/", 390, 844);
await shoot("m2-browse", "/products", 390, 844);
const firstProduct = async (page) => {
  await page.evaluate(() => (location.href = document.querySelector('a[href^="/p/"]')?.href || location.href));
  await new Promise((r) => setTimeout(r, 2000));
};
await shoot("m3-product", "/products", 390, 844, firstProduct);
await shoot("m4-cart", "/cart", 390, 844);
await shoot("t1-home", "/", 834, 1112);
await shoot("t2-products", "/products", 834, 1112);
await shoot("m5-login", "/login", 390, 844);

await browser.close();
