import { mkdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:5173";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOTS = "C:\\Users\\qaima\\AppData\\Local\\Temp\\opencode\\shots";
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
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/")) {
      apiLog.push(`${tag} < ${r.status()} ${r.request().method()} ${u.replace(BASE, "")}`);
      const ignore =
        (u.includes("/auth/refresh") && r.status() === 401) ||
        (u.includes("/auth/me") && r.status() === 401);
      if (!ignore && r.status() >= 400)
        problems.push(`${tag} api ${r.status()} ${r.request().method()} ${u.replace(BASE, "")}`);
    }
  });
}

const shot = (page, name) => page.screenshot({ path: `${SHOTS}\\${name}.png` });
const bodyText = (page) => page.evaluate(() => document.body.innerText);

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
      document.body.innerText.includes("SHOP BY CATEGORY") &&
      document.querySelectorAll('a[href*="/products?category="]').length > 0,
    { timeout: 30000 },
  );
  const t = await bodyText(page);
  check(t.includes("Groceries"), "hero copy missing");
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
  await goto(page, href);
  await page.waitForFunction(
    () => document.body.innerText.includes("Add to cart"),
    { timeout: 20000 },
  );
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
      (document.querySelector('a[aria-label^="Cart"]')?.getAttribute("aria-label") || "").includes(
        "1 item",
      ),
    { timeout: 15000 },
  );
  await shot(page, "03-product");
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
    await page.type('input[type="email"]', "demo@onemart.test");
    await page.type('input[type="password"]', "Demo@1234");
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
  check(/Pending|Confirmed/.test(t), "status timeline missing");
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

const ctx2 = await browser.createBrowserContext();
const apage = await ctx2.newPage();
wire(apage, "[admin]");

await run("admin login lands authenticated", async () => {
  await goto(apage, "/login");
  await apage.waitForSelector('input[type="email"]', { timeout: 15000 });
  await apage.type('input[type="email"]', "admin@onemart.test");
  await apage.type('input[type="password"]', "Admin@1234");
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
  await page.waitForFunction(() => document.body.innerText.includes("Confirmed"), {
    timeout: 20000,
  });
  await shot(page, "14-customer-timeline-confirmed");
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
