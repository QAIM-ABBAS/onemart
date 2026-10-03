/**
 * Authenticated layout audit: cart with items, checkout, and the admin shell
 * are only reachable after sign-in, so they need their own pass (the plain
 * box-analysis run silently falls back to the login page).
 *
 * Flow: sign in as the demo customer -> add a product to the cart -> audit
 * /cart and /checkout at every width -> sign in as admin -> audit
 * /admin/products and the first order detail page.
 *
 * NOTE on the cart race: useCart() fires on mount, before the auth bootstrap
 * has an access token, so the first response is an empty guest cart and it is
 * cached for staleTime. We force a correct refetch through the DEV-exposed
 * query client (window.__rq) and wait until the basket badge shows items.
 *
 * Usage: node scripts/auth-layout.mjs
 */
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import { probe, report } from "./probe.mjs";

const BASE = "http://localhost:5173";
const SHOTS = process.env.ONEMART_AUTH_SHOTS ?? join(tmpdir(), "opencode", "onemart-auth");
mkdirSync(SHOTS, { recursive: true });

const WIDTHS = [390, 768, 1024, 1440, 2560];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--no-proxy-server", "--proxy-bypass-list=*"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

async function login(email, password) {
  await page.goto(BASE + "/login", { waitUntil: "networkidle2", timeout: 60000 });
  await page.waitForSelector("#email", { timeout: 15000 });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await wait(500);
    // Start from empty fields so leftover values can never be appended to.
    await page.evaluate(() => {
      const set = (el, v) => {
        if (!el) return;
        const proto = Object.getPrototypeOf(el);
        const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        setter ? setter.call(el, v) : (el.value = v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      set(document.querySelector("#email"), "");
      set(document.querySelector("#password"), "");
    });
    await page.type("#email", email);
    await page.type("#password", password);
    // Click the submit button of the FORM THAT OWNS #email — a bare
    // button[type=submit] selector would hit the header search button instead.
    try {
      await Promise.all([
        page.waitForFunction(() => !location.pathname.startsWith("/login"), { timeout: 12000 }),
        page.evaluate(() => {
          const form = document.querySelector("#email")?.closest("form");
          form?.querySelector('button[type="submit"]')?.click();
        }),
      ]);
      await wait(800);
      console.log(`signed in as ${email} -> ${await page.evaluate(() => location.pathname)}`);
      return;
    } catch {
      console.log(`login attempt ${attempt} for ${email} failed, retrying`);
    }
  }
  const msg = await page.evaluate(() =>
    document.querySelector("main")?.textContent?.replace(/\s+/g, " ").slice(0, 300),
  );
  throw new Error(`login as ${email} never navigated; page said: ${msg}`);
}

/**
 * Wait until the cart queries reflect the signed-in user's cart (items in it).
 * Full page loads race the auth bootstrap; invalidate + wait for the badge.
 */
async function settleCart(path, width) {
  await wait(1200); // let bootstrap finish so the refetch carries the Bearer token
  await page.evaluate(() => {
    window.__rq?.invalidateQueries({ queryKey: ["cart"] });
    window.__rq?.invalidateQueries({ queryKey: ["checkout-summary"] });
  });
  const ok = await page
    .waitForFunction(
      () =>
        /Open cart, [1-9]/.test(
          document.querySelector('button[aria-label^="Open cart"]')?.getAttribute("aria-label") ??
            "",
        ),
      { timeout: 10000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!ok) console.log(`!! cart never showed items on ${path} @ ${width}`);
  await wait(500); // let the page render the settled data
}

async function audit(path, width, { settle = false } = {}) {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 }).catch(() => {});
  await wait(1500);
  const here = await page.evaluate(() => location.pathname);
  if (here.startsWith("/login")) {
    console.log(`\n=== ${path} @ ${width}px  !! REDIRECTED TO LOGIN — skipped`);
    return;
  }
  if (settle) await settleCart(path, width);
  const res = await page.evaluate(probe);
  report(path, width, res);
  const tag = `${path.replace(/[^a-z0-9]+/gi, "_") || "home"}@${width}`;
  await page.screenshot({ path: `${SHOTS}\\${tag}.png` });
}

// ── customer: cart with items + checkout ────────────────────────────────────
await login("demo@onemart.test", "Demo@1234");

await page.goto(BASE + "/products", { waitUntil: "networkidle2", timeout: 60000 });
await page
  .waitForFunction(
    () =>
      [...document.querySelectorAll("button")].some((b) =>
        b.textContent.trim().startsWith("Add to cart"),
      ),
    { timeout: 20000 },
  )
  .catch(() => console.log("!! product cards never rendered"));
const added = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.trim().startsWith("Add to cart"),
  );
  if (!btn) return false;
  btn.click();
  return true;
});
if (!added) console.log("!! could not find an Add to cart button");
await wait(2500);

for (const width of WIDTHS) await audit("/cart", width, { settle: true });
for (const width of WIDTHS) await audit("/checkout", width, { settle: true });

// ── admin: shell + order detail sidebar ─────────────────────────────────────
await (async () => {
  // Drop the customer session (cookie-based) so /login shows the form again.
  const cdp = await page.createCDPSession();
  await cdp.send("Network.clearBrowserCookies").catch(() => {});
  await page.evaluate(() => localStorage.clear());
})();
await login("admin@onemart.test", "Admin@1234");

for (const width of WIDTHS) await audit("/admin/products", width);

await page.goto(BASE + "/admin/orders", { waitUntil: "networkidle2", timeout: 60000 });
await wait(1200);
const orderHref = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href^="/admin/orders/"]')].find(
    (n) => n.getAttribute("href") !== "/admin/orders",
  );
  return a?.getAttribute("href") ?? null;
});
if (orderHref) {
  console.log(`first order: ${orderHref}`);
  for (const width of WIDTHS) await audit(orderHref, width);
} else {
  console.log("!! no order rows found on /admin/orders");
}

await browser.close();
console.log(`\nshots: ${SHOTS}`);
