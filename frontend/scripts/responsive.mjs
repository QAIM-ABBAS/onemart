import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:5173";
const SHOTS = process.env.ONEMART_SHOTS ?? join(tmpdir(), "opencode", "onemart-shots");
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
  if (prep)
    await prep(page).catch((e) => console.log(`prep warn for ${name}: ${e.message}`));
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

/**
 * Signs in, landing on `next`. A protected route bounces a guest to
 * /login?next=… and an existing session is dropped straight through, so either
 * way we land deterministically (going to /login directly races its own
 * "already signed in" redirect). Credentials default to the demo customer;
 * admin shots pass their own.
 */
const signIn = async (page, next, email = "demo@onemart.test", password = "Demo@1234") => {
  await page.goto(BASE + next, { waitUntil: "domcontentloaded", timeout: 60000 });
  const hasForm = await page
    .waitForSelector('input[type="password"]', { timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  if (hasForm) {
    // Same bootstrap-wait as the smoke script: typing into the pre-boot
    // form loses keystrokes when it re-renders.
    await page
      .waitForFunction(() => !window.__auth || window.__auth.getState().booted === true, {
        timeout: 15000,
      })
      .catch(() => {});
    await page.type('input[type="email"]', email, { delay: 15 });
    await page.type('input[type="password"]', password, { delay: 15 });
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        x.textContent.includes("Sign in"),
      );
      b?.click();
    });
    await page.waitForFunction((p) => location.pathname === p, { timeout: 25000 }, next);
  }
};

/**
 * The wishlist sits behind a login and is a grid of saved products, so its
 * shots need a session and at least two saved cards: sign the demo customer
 * in, heart two products through the UI, then open the page.
 */
const withWishlist = async (page) => {
  await signIn(page, "/wishlist");

  for (let i = 0; i < 2; i++) {
    await page.goto(BASE + "/products", { waitUntil: "domcontentloaded", timeout: 60000 });
    // Wait for React to render the grid — domcontentloaded is too early.
    await page.waitForFunction(() => document.querySelectorAll('a[href^="/p/"]').length > 0, {
      timeout: 25000,
    });
    const href = await page.evaluate((idx) => {
      // Deterministic pick: list order drifts between runs (ratings change),
      // so sort — otherwise every run hearts a different pair forever.
      const unique = [
        ...new Set([...document.querySelectorAll('a[href^="/p/"]')].map((a) => a.href)),
      ].sort();
      return unique[idx] ?? null;
    }, i);
    if (!href) continue;
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Either state is fine: not saved yet, or already saved by an earlier run.
    await page.waitForFunction(
      () =>
        document.querySelector('button[aria-label="Save this product to your wishlist"]') !==
          null ||
        document.querySelector('button[aria-label="Remove this product from your wishlist"]') !==
          null,
      { timeout: 25000 },
    );
    const needsSave = await page.$('button[aria-label="Save this product to your wishlist"]');
    if (needsSave) {
      await needsSave.click();
      await page.waitForFunction(
        () =>
          document.querySelector(
            'button[aria-label="Remove this product from your wishlist"]',
          ) !== null,
        { timeout: 15000 },
      );
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  await page.goto(BASE + "/wishlist", { waitUntil: "networkidle2", timeout: 60000 });
  // Cards first, then let the images settle so the shots are not half-painted.
  await page
    .waitForFunction(() => document.querySelectorAll("article").length > 0, { timeout: 25000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
};

await shoot("m6-wishlist", "/login", 390, 844, withWishlist);
await shoot("t3-wishlist", "/login", 834, 1112, withWishlist);
await shoot("d1-wishlist", "/login", 1440, 900, withWishlist);

/**
 * The notifications inbox sits behind the same login and needs no setup
 * beyond a session — the demo customer always has some — so the prep is just
 * the sign-in plus a settled network (list + bell count) before the shot.
 */
const withNotifications = async (page) => {
  await signIn(page, "/notifications");
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle2", timeout: 60000 });
  await page
    .waitForFunction(() => document.body.innerText.includes("Notifications"), { timeout: 25000 })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
};

await shoot("m7-notifications", "/login", 390, 844, withNotifications);
await shoot("t4-notifications", "/login", 834, 1112, withNotifications);
await shoot("d2-notifications", "/login", 1440, 900, withNotifications);

/**
 * The promo screens sit behind staff auth. Every shoot shares one browser
 * context, so the customer sessions from the shots above are still in the
 * cookie jar — drop them first, or the staff route renders "no access"
 * instead of bouncing to the login form. Admin shots run last, after which
 * the browser closes, so the staff session outlives nothing.
 */
const withAdminPromos = (path, marker) => async (page) => {
  try {
    const cdp = await page.createCDPSession();
    await cdp.send("Network.clearBrowserCookies");
  } catch {
    /* a stale session would only cost an extra login attempt below */
  }
  await signIn(page, path, "admin@onemart.test", "Admin@1234");
  await page.goto(BASE + path, { waitUntil: "networkidle2", timeout: 60000 });
  await page
    .waitForFunction((m) => document.body.innerText.includes(m), { timeout: 25000 }, marker)
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
};

await shoot("m8-admin-coupons", "/login", 390, 844, withAdminPromos("/admin/coupons", "+ New coupon"));
await shoot("m9-admin-discounts", "/login", 390, 844, withAdminPromos("/admin/discounts", "+ New discount"));
await shoot("t5-admin-coupons", "/login", 834, 1112, withAdminPromos("/admin/coupons", "+ New coupon"));
await shoot("t6-admin-discounts", "/login", 834, 1112, withAdminPromos("/admin/discounts", "+ New discount"));
await shoot("d3-admin-coupons", "/login", 1440, 900, withAdminPromos("/admin/coupons", "+ New coupon"));
await shoot("d4-admin-discounts", "/login", 1440, 900, withAdminPromos("/admin/discounts", "+ New discount"));

await browser.close();
