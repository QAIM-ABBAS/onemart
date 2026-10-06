import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:5173";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOTS = process.env.ONEMART_SHOTS ?? join(tmpdir(), "opencode", "onemart-shots");
mkdirSync(SHOTS, { recursive: true });

const problems = [];
const apiLog = [];
const failures = [];
let step = "init";
let aborted = false;
const check = (cond, msg) => {
  if (!cond) throw new Error(`[${step}] ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--no-proxy-server",
    "--proxy-bypass-list=*",
    "--window-size=1440,900",
  ],
  defaultViewport: { width: 1440, height: 900 },
});

function wire(page, tag) {
  page.on("pageerror", (e) => problems.push(`${tag} pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const loc = m.location()?.url ?? "";
    if (loc.includes("/auth/refresh")) return;
    problems.push(`${tag} console: ${m.text()}`);
  });
  page.on("request", (r) => {
    if (r.url().includes("/api/")) apiLog.push(`${tag} > ${r.method()} ${r.url().replace(BASE, "")}`);
  });
  page.on("response", async (r) => {
    const u = r.url();
    if (u.includes("/api/")) {
      apiLog.push(`${tag} < ${r.status()} ${r.request().method()} ${u.replace(BASE, "")}`);
      const ignore =
        (u.includes("/auth/refresh") && r.status() === 401) ||
        (u.includes("/auth/me") && r.status() === 401) ||
        // The review step deliberately tolerates a leftover review
        // ("already reviewed" after an interrupted run) — see below.
        (u.includes("/reviews") && r.request().method() === "POST" && r.status() === 409);
      if (!ignore && r.status() >= 400) {
        const body = await r.text().catch(() => "");
        problems.push(
          `${tag} api ${r.status()} ${r.request().method()} ${u.replace(BASE, "")}` +
            (body ? ` :: ${body.slice(0, 200)}` : ""),
        );
      }
    }
  });
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}\\${name}.png` });
const bodyText = (page) => page.evaluate(() => document.body.innerText);

/**
 * Fill the login form. Two failure modes are guarded, both observed as
 * silently dropped keystrokes:
 *
 *  1. Typing before the auth store has booted: the form remounts when the
 *     bootstrap lands, and the keystrokes reach the detached node. So wait
 *     for `booted` — do NOT let a missing `window.__auth` pass the wait.
 *  2. Even after boot, a re-render can swap the form mid-type. Verify the
 *     fields, clear both, and type again (up to 3 attempts) so the failure —
 *     if it persists — is legible instead of a mysterious 422 later.
 */
async function fillLogin(page, email, password) {
  await page.waitForFunction(() => window.__auth?.getState?.().booted === true, {
    timeout: 20000,
  });
  let typed = { email: "", password: "" };
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.type('input[type="email"]', email, { delay: 15 });
    await page.type('input[type="password"]', password, { delay: 15 });
    typed = await page.evaluate(() => ({
      email: document.querySelector('input[type="email"]')?.value ?? "",
      password: document.querySelector('input[type="password"]')?.value ?? "",
    }));
    if (typed.email === email && typed.password === password) return;
    if (attempt < 3) {
      // Form was swapped mid-type: select whatever landed, then retype.
      for (const sel of ['input[type="email"]', 'input[type="password"]']) {
        await page.evaluate((s) => {
          const el = document.querySelector(s);
          el?.focus();
          el?.select();
        }, sel);
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
      }
    }
  }
  check(false, `login fields not filled after 3 attempts: ${JSON.stringify(typed)}`);
}

async function run(name, fn) {
  step = name;
  if (aborted) {
    console.log(`skip - ${name}`);
    return;
  }
  try {
    await fn();
    console.log(`ok   - ${name}`);
  } catch (e) {
    aborted = true;
    failures.push(`${name}: ${e.message}`);
    const pg = step.startsWith("admin") ? apage ?? page : page;
    try {
      const txt = await pg.evaluate(() => document.body.innerText.slice(0, 300));
      const auth = await pg.evaluate(() => {
        const s = window.__auth?.getState?.();
        return s ? { user: s.user?.email ?? null, booted: s.booted } : "no __auth";
      });
      const rq = await pg.evaluate(() => {
        const rq = window.__rq;
        if (!rq) return "no __rq";
        return rq
          .getQueryCache()
          .getAll()
          .filter((q) => JSON.stringify(q.queryKey).includes("orders"))
          .map((q) => ({
            key: JSON.stringify(q.queryKey),
            status: q.state.status,
            fetch: q.state.fetchStatus,
            age: q.state.dataUpdatedAt ? Date.now() - q.state.dataUpdatedAt : null,
            items: q.state.data?.items?.length ?? null,
            obs: q.getObserversCount(),
          }));
      });
      const probe = await pg.evaluate(async () => {
        const t0 = performance.now();
        try {
          const r = await fetch("/api/orders?page=1&page_size=10&sort=newest", {
            headers: { Authorization: "Bearer " + (window.__token?.() ?? "") },
          });
          const txt = await r.text();
          return `status=${r.status} len=${txt.length} ms=${Math.round(performance.now() - t0)}`;
        } catch (e) {
          return "probe err " + e.message;
        }
      });
      failures.push(
        `  url: ${pg.url()}\n  auth: ${JSON.stringify(auth)}\n  rq: ${JSON.stringify(rq)}\n  probe: ${probe}\n  body: ${txt}\n  api tail:\n${apiLog
          .slice(-40)
          .map((l) => "    " + l)
          .join("\n")}`,
      );
      await shot(pg, `fail-${name.replace(/[^a-z0-9]+/gi, "-")}`);
    } catch {
      /* ignore */
    }
    console.log(`FAIL - ${name}`);
  }
}

const ctx1 = await browser.createBrowserContext();
const page = await ctx1.newPage();
wire(page, "[cust]");
// set by the PDP step, reused by the review + wishlist steps
let productUrl = "";
let productName = "";

const goto = async (p, url) => {
  try {
    // 60s: absorbs a cold Vite start right after `docker compose up --recreate`.
    await p.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 60000 });
  } catch (e) {
    const finalUrl = p.url();
    throw new Error(`goto ${url} failed (now at ${finalUrl}): ${e.message}`);
  }
};

await run("home renders hero + categories + featured", async () => {
  await goto(page, "/");
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Shop by category") &&
      document.querySelectorAll('a[href*="/products?category="]').length > 4,
    { timeout: 30000 },
  );
  const t = await bodyText(page);
  check(t.includes("Fruit, vegetables"), "hero copy missing");
  await page.waitForFunction(
    () => document.querySelectorAll('a[href^="/p/"]').length > 0,
    { timeout: 30000 },
  );
  await shot(page, "01-home");
});

await run("browse lists products + sort updates URL", async () => {
  await goto(page, "/products");
  await page.waitForFunction(
    () => document.querySelectorAll('a[href^="/p/"]').length > 0,
    { timeout: 20000 },
  );
  const sorted = await page.evaluate(() => {
    const s = [...document.querySelectorAll("select")].find((el) =>
      [...el.options].some((o) => o.value === "price_asc"),
    );
    if (!s) return false;
    s.value = "price_asc";
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });
  check(sorted, "sort select not found");
  await page.waitForFunction(() => location.search.includes("sort=price_asc"), {
    timeout: 10000,
  });
  await shot(page, "02-browse");
});

await run("product detail add to cart updates header badge", async () => {
  const href = await page.$eval('a[href^="/p/"]', (a) => a.getAttribute("href"));
  productUrl = href;
  await goto(page, href);
  await page.waitForFunction(
    () => document.body.innerText.includes("Add to cart"),
    { timeout: 20000 },
  );
  productName = (await page.$eval("h1", (h) => h.textContent ?? "")).trim();
  check(productName.length > 0, "product name missing from the product page");
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.includes("Add to cart"),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  check(clicked, "add to cart button missing");
  await page.waitForFunction(
    () =>
      (document.querySelector('button[aria-label^="Open cart"]')?.getAttribute("aria-label") || "").includes(
        "1 item",
      ),
    { timeout: 15000 },
  );
  await shot(page, "03-product");
});

await run("guest sees ratings section with login prompt", async () => {
  await page.waitForFunction(() => document.body.innerText.includes("Ratings & reviews"), {
    timeout: 20000,
  });
  const t = await bodyText(page);
  check(t.includes("Sign in to write a review"), "guest login prompt missing");
  check((await page.$("#review-sort")) !== null, "review sort select missing");
  await shot(page, "03b-product-reviews");
});

await run("guest tapping save gets a login prompt", async () => {
  await page.waitForSelector('button[aria-label="Save this product to your wishlist"]', {
    timeout: 15000,
  });
  await page.click('button[aria-label="Save this product to your wishlist"]');
  await page.waitForFunction(() => document.body.innerText.includes("Sign in to save items"), {
    timeout: 15000,
  });
  await shot(page, "03c-wishlist-login-prompt");
  // Dismissing must keep the tap parked — it is replayed after sign-in.
  const dismissed = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.includes("Keep browsing"),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  check(dismissed, "prompt dismiss button missing");
  await page.waitForFunction(() => !document.body.innerText.includes("Sign in to save items"), {
    timeout: 10000,
  });
});

await run("cart shows line item", async () => {
  await goto(page, "/cart");
  await page.waitForFunction(
    () => document.body.innerText.includes("Proceed to checkout"),
    { timeout: 20000 },
  );
  await shot(page, "04-cart");
});

await run("checkout gates on login, demo login returns to checkout", async () => {
  await goto(page, "/checkout");
  await page.waitForFunction(
    () => location.pathname === "/login" || document.body.innerText.includes("Place order"),
    { timeout: 20000 },
  );
  if (new URL(page.url()).pathname === "/login") {
    check(page.url().includes("next=%2Fcheckout"), "login did not carry next=/checkout");
    await fillLogin(page, "demo@onemart.test", "Demo@1234");
    const submitted = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) =>
        x.textContent.includes("Sign in"),
      );
      if (!b) return false;
      b.click();
      return true;
    });
    check(submitted, "sign in button missing");
    await page.waitForFunction(() => location.pathname === "/checkout", { timeout: 20000 });
  }
  await page.waitForFunction(
    () => document.body.innerText.includes("Place order"),
    { timeout: 20000 },
  );
  await shot(page, "05-checkout");
});

await run("place order lands on confirmation with timeline", async () => {
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.includes("Place order"),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  check(clicked, "place order button missing");
  await page.waitForFunction(() => /\/orders\/\d+\?placed=1/.test(location.href), {
    timeout: 25000,
  });
  await page.waitForFunction(() => document.body.innerText.includes("Order placed"), {
    timeout: 15000,
  });
  const t = await bodyText(page);
  // Status labels are `.label` (uppercase) — innerText applies the transform,
  // so match case-insensitively.
  check(/pending|confirmed/i.test(t), "status timeline missing");
  await shot(page, "06-order-confirmation");
});

await run("order history lists the order", async () => {
  await goto(page, "/orders");
  await page.waitForFunction(() => document.body.innerText.includes("OM-"), {
    timeout: 25000,
  });
  const t = await bodyText(page);
  check(t.includes("OM-"), "no order number in history list");
  await shot(page, "07-orders");
});

await run("wishlist replayed the guest tap and manages items", async () => {
  await goto(page, "/wishlist");
  await page.waitForFunction(() => document.body.innerText.includes("Wishlist"), {
    timeout: 20000,
  });
  // The heart tapped as a guest must have been saved once the session existed.
  await page.waitForFunction((name) => document.body.innerText.includes(name), {
    timeout: 20000,
  }, productName);
  await shot(page, "07b-wishlist");

  // Add it to the cart — multi-option products must open the picker first.
  const clickedAdd = await page.evaluate((name) => {
    const card = [...document.querySelectorAll("article")].find((a) =>
      a.innerText.includes(name),
    );
    if (!card) return false;
    const b = [...card.querySelectorAll("button")].find((x) => x.textContent.includes("Add to cart"));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, productName);
  check(clickedAdd, "add to cart button missing on the wishlist card");

  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Choose an option") ||
      document.body.innerText.includes("to your cart"),
    { timeout: 15000 },
  );
  if ((await bodyText(page)).includes("Choose an option")) {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[role="dialog"] button')].find(
        (x) => !x.disabled && x.textContent.trim().length > 0 && !x.hasAttribute("aria-label"),
      );
      b?.click();
    });
  }
  await page.waitForFunction(() => document.body.innerText.includes("to your cart"), {
    timeout: 15000,
  });

  // Remove it again so the next run replays into a predictable list.
  const removed = await page.evaluate((name) => {
    const card = [...document.querySelectorAll("article")].find((a) =>
      a.innerText.includes(name),
    );
    const b = card?.querySelector('button[aria-label*="from wishlist"]');
    if (!b) return false;
    b.click();
    return true;
  }, productName);
  check(removed, "remove-from-wishlist button missing");
  await page.waitForFunction(
    (name) =>
      ![...document.querySelectorAll("article")].some((a) => a.innerText.includes(name)),
    { timeout: 20000 },
    productName,
  );
  await shot(page, "07c-wishlist-removed");
});

const ctx2 = await browser.createBrowserContext();
const apage = await ctx2.newPage();
wire(apage, "[admin]");
// admin actions use window.confirm() — accept them so the flow can continue
apage.on("dialog", (d) => d.accept());

await run("admin login lands authenticated", async () => {
  await goto(apage, "/login");
  await apage.waitForSelector('input[type="email"]', { timeout: 15000 });
  await fillLogin(apage, "admin@onemart.test", "Admin@1234");
  await apage.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.includes("Sign in"),
    );
    b.click();
  });
  await apage.waitForFunction(() => location.pathname !== "/login", { timeout: 20000 });
});

await run("admin products list renders", async () => {
  await goto(apage, "/admin/products");
  await apage.waitForFunction(
    () =>
      document.body.innerText.includes("+ New product") &&
      !document.body.innerText.includes("Loading"),
    { timeout: 30000 },
  );
  const rows = await apage.$$eval('a[href*="/admin/products/"][href*="/edit"]', (a) => a.length);
  check(rows > 0, "no product edit links");
  await shot(apage, "08-admin-products");
});

await run("admin product edit form loads with data", async () => {
  const href = await apage.$eval(
    'a[href*="/admin/products/"][href*="/edit"]',
    (a) => a.getAttribute("href"),
  );
  await goto(apage, href);
  await apage.waitForFunction(
    () =>
      document.body.innerText.includes("Save") &&
      (document.querySelector("#p-name")?.value || "").length > 0,
    { timeout: 30000 },
  );
  await shot(apage, "09-admin-product-edit");
});

await run("admin stock page renders", async () => {
  await goto(apage, "/admin/stock");
  await apage.waitForFunction(
    () =>
      /variants|No stock|Nothing/.test(document.body.innerText) &&
      !document.body.innerText.includes("Loading"),
    { timeout: 30000 },
  );
  await shot(apage, "10-admin-stock");
});

await run("admin reviews queue renders", async () => {
  await goto(apage, "/admin/reviews");
  await apage.waitForFunction(
    () =>
      document.body.innerText.includes("No reviews yet") ||
      document.querySelectorAll("tbody tr").length > 0,
    { timeout: 30000 },
  );
  await shot(apage, "10b-admin-reviews");
});

let orderUrl = "";

await run("admin orders list + open newest order", async () => {
  await goto(apage, "/admin/orders");
  await apage.waitForFunction(
    () => document.querySelectorAll('a[href*="/admin/orders/"]').length > 0,
    { timeout: 20000 },
  );
  await shot(apage, "11-admin-orders");
  orderUrl = await apage.$eval('a[href*="/admin/orders/"]', (a) => a.getAttribute("href"));
  await goto(apage, orderUrl);
  await apage.waitForFunction(
    () => document.body.innerText.includes("Update status"),
    { timeout: 20000 },
  );
  await shot(apage, "12-admin-order-detail");
});

await run("admin updates order status to confirmed", async () => {
  const selected = await apage.evaluate(() => {
    const s = [...document.querySelectorAll("select")].find((el) =>
      [...el.options].some((o) => o.value === "confirmed"),
    );
    if (!s) return false;
    s.value = "confirmed";
    s.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });
  check(selected, "status select with confirmed option not found");
  const clicked = await apage.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.includes("Update status"),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  check(clicked, "update status button missing");
  await apage.waitForFunction(
    () => document.body.innerText.includes("Status updated"),
    { timeout: 20000 },
  );
  await shot(apage, "13-admin-status-updated");
});

await run("customer sees confirmed status in timeline", async () => {
  await goto(page, orderUrl.replace("/admin", ""));
  // `.label` text is uppercased by innerText — match case-insensitively.
  await page.waitForFunction(() => /confirmed/i.test(document.body.innerText), {
    timeout: 20000,
  });
  await shot(page, "14-customer-timeline-confirmed");
});

await run("customer cancels a confirmed order and sees the terminal step", async () => {
  await goto(page, orderUrl.replace("/admin", ""));
  await page.waitForFunction(() => document.body.innerText.includes("Status timeline"), {
    timeout: 20000,
  });

  // Cancel order (page) -> confirm inside the dialog (same label, scoped).
  const clicked = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent.includes("Cancel order") && !x.closest('[role="dialog"]'),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  check(clicked, "cancel order button missing on a confirmed order");
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });

  const confirmed = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) =>
      x.textContent.includes("Cancel order"),
    );
    if (!b) return false;
    b.click();
    return true;
  });
  check(confirmed, "confirm-cancel button missing in the dialog");

  // Waits for the terminal step's note (from the backend history row) — the
  // toast alone could match a beat before the timeline re-renders.
  // `.label` text is uppercased by innerText — match case-insensitively.
  await page.waitForFunction(() => /cancelled by the customer/i.test(document.body.innerText), {
    timeout: 20000,
  });
  const t = await bodyText(page);
  // The history row written by the backend shows up as the terminal step note.
  check(t.includes("Cancelled by the customer"), "cancellation history note missing");
  // Cancelled is terminal: the cancel action must be gone.
  const cancelGone = await page.evaluate(
    () =>
      ![...document.querySelectorAll("button")].some(
        (x) => x.textContent.includes("Cancel order") && !x.closest('[role="dialog"]'),
      ),
  );
  check(cancelGone, "cancel button still shown on a cancelled order");
  await shot(page, "14b-customer-order-cancelled");
});

await run("customer writes a review on the product", async () => {
  await goto(page, productUrl);
  await page.waitForFunction(() => document.body.innerText.includes("Ratings & reviews"), {
    timeout: 25000,
  });
  const opened = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.textContent.trim() === "Write a review",
    );
    if (!b) return "absent";
    b.click();
    return true;
  });
  if (opened === true) {
    await page.waitForSelector("#review-title", { timeout: 15000 });
    await page.type("#review-title", "Tried and tested");
    await page.type("#review-body", "Good quality and it arrived the next morning.");
    const posted = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find(
        (x) => x.textContent.trim() === "Post review",
      );
      if (!b) return false;
      b.click();
      return true;
    });
    check(posted, "post review button missing");
  }
  // The new card, an "already reviewed" notice (leftover from an interrupted
  // run), or an existing own-review with Edit — all mean the section reacted.
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Tried and tested") ||
      document.body.innerText.includes("already reviewed") ||
      [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Edit"),
    { timeout: 25000 },
  );
  await shot(page, "15-review-written");
});

await run("admin hides and deletes the new review", async () => {
  await goto(apage, "/admin/reviews");
  await apage.waitForFunction(
    () =>
      document.querySelectorAll("tbody tr").length > 0 ||
      document.body.innerText.includes("No reviews yet"),
    { timeout: 30000 },
  );
  const hasRow = await apage.evaluate(() => document.querySelectorAll("tbody tr").length > 0);
  check(hasRow, "the new review is missing from the queue");

  const firstRowHas = (label) =>
    apage.evaluate(
      (l) =>
        [...document.querySelectorAll("tbody tr:first-child button")].some(
          (b) => b.textContent.trim() === l,
        ),
      label,
    );

  // A run interrupted before cleanup can leave this row hidden — unhide it
  // first so the hide path below always runs for real. Sequence on the button
  // label, not the toast: the refetch lands a beat after the success notice.
  if (await firstRowHas("Unhide")) {
    await apage.evaluate(() => {
      const b = [...document.querySelectorAll("tbody tr:first-child button")].find(
        (x) => x.textContent.trim() === "Unhide",
      );
      b?.click();
    });
    await apage.waitForFunction(
      () =>
        [...document.querySelectorAll("tbody tr:first-child button")].some(
          (b) => b.textContent.trim() === "Hide",
        ),
      { timeout: 20000 },
    );
    await apage.waitForFunction(() => document.body.innerText.includes("visible again"), {
      timeout: 20000,
    });
  }

  check(await firstRowHas("Hide"), "hide button missing");
  await apage.evaluate(() => {
    const b = [...document.querySelectorAll("tbody tr:first-child button")].find(
      (x) => x.textContent.trim() === "Hide",
    );
    b?.click();
  });
  await apage.waitForFunction(() => document.body.innerText.includes("Review hidden"), {
    timeout: 20000,
  });
  await shot(apage, "16-admin-review-hidden");

  // Delete it afterwards so the next run can post again (one review per
  // customer per product, and the demo account is reused every run).
  await apage.evaluate(() => {
    const b = [...document.querySelectorAll("tbody tr:first-child button")].find(
      (x) => x.textContent.trim() === "Delete",
    );
    b?.click();
  });
  await apage.waitForFunction(() => document.body.innerText.includes("Review deleted"), {
    timeout: 20000,
  });
  await shot(apage, "17-admin-review-deleted");
});

await run("hidden review disappears for the customer", async () => {
  await goto(page, productUrl);
  await page.waitForFunction(() => document.body.innerText.includes("Ratings & reviews"), {
    timeout: 25000,
  });
  // wait for the refetch, not the cache: a stale entry still shows the review
  await page.waitForFunction(() => !document.body.innerText.includes("Tried and tested"), {
    timeout: 20000,
  });
  await shot(page, "18-review-removed");
});

await run("customer sees the notifications inbox and clears it", async () => {
  // Full reload so the bell's count query fetches on mount instead of waiting
  // out its 45s poll. This run produced placed + confirmed + cancelled + hidden.
  await goto(page, "/notifications");
  await page.waitForFunction(
    () =>
      document.body.innerText.includes("Notifications") &&
      /Order \S+ (placed|confirmed)/i.test(document.body.innerText),
    { timeout: 25000 },
  );
  await page.waitForFunction(() => {
    const b = document.querySelector('button[aria-label="Notifications"]');
    return b && /^\d/.test(b.innerText.trim());
  }, { timeout: 20000 });
  const badge = await page.evaluate(
    () => document.querySelector('button[aria-label="Notifications"]').innerText.trim(),
  );
  check(badge.length > 0, `bell badge should show an unread count, got "${badge}"`);
  await shot(page, "19-notifications-inbox");

  // The bell opens the latest-10 dropdown...
  await page.evaluate(() => document.querySelector('button[aria-label="Notifications"]').click());
  await page.waitForFunction(() => document.body.innerText.includes("View all notifications"), {
    timeout: 10000,
  });
  await shot(page, "20-notifications-bell");
  // ...and closes again so the controls underneath stay reachable.
  await page.evaluate(() => document.querySelector('button[aria-label="Notifications"]').click());
  await page.waitForFunction(() => !document.body.innerText.includes("View all notifications"), {
    timeout: 10000,
  });

  // Mark all as read empties the badge...
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) =>
      x.textContent.includes("Mark all as read"),
    );
    if (b) b.click();
  });
  await page.waitForFunction(
    () => {
      const b = document.querySelector('button[aria-label="Notifications"]');
      return b && b.innerText.trim() === "";
    },
    { timeout: 20000 },
  );
  // ...and the Unread filter falls back to its real empty state. Case-
  // insensitive: `.label` uppercases via text-transform and innerText obeys it
  // (the same trap as the PENDING status labels).
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find(
      (x) => x.getAttribute("aria-pressed") !== null && x.textContent.trim() === "Unread",
    );
    if (b) b.click();
  });
  await page.waitForFunction(() => /nothing here/i.test(document.body.innerText), {
    timeout: 20000,
  });
  await shot(page, "21-notifications-read");
});

await browser.close();

console.log("\n--- failures ---");
if (failures.length === 0) console.log("none");
else failures.forEach((f) => console.log("FAIL: " + f));
console.log("\n--- console/page/api problems ---");
if (problems.length === 0) console.log("none");
else problems.forEach((p) => console.log("!!  " + p));
console.log("\n--- all api calls ---");
apiLog.forEach((l) => console.log(l));
console.log(`\nscreenshots: ${SHOTS}`);
process.exit(problems.length || failures.length ? 2 : 0);
