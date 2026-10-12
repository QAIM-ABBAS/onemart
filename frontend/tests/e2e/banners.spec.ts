import { expect, test } from "@playwright/test";

import { ADMIN, CUSTOMER, dropLeftoverCoupon, emptyCart, login } from "./helpers";

/**
 * Phase 4 banner engine, end to end on the dev stack:
 *
 *   homepage renders the API-driven hero carousel + mid strip (payload cap
 *   ≤ 5, at most one of each) → category page shows its single header
 *   banner, plain search shows none → the seeded cart promo renders and its
 *   CTA deep-links `?coupon=FREESHIP`, which the cart applies once and then
 *   strips from the URL → admin creates a higher-priority cart promo → it
 *   displaces the seeded strip, its impression + click land in the live CTR
 *   counters → admin deletes it → the seeded strip comes back.
 *
 * The created banner is deleted again in `finally`, so a crashed run can't
 * leak fixtures into the next one.
 */

test.use({ actionTimeout: 30_000 });

// Pampers Diapers · Medium pack — ₹749 clears FREESHIP's ₹499 minimum in
// one unit, and it's the default variant on the PDP.
const PRODUCT_SLUG = "pampers-diapers";
const MY_TITLE = "E2E Banner Run";
const SEEDED_CART_TITLE = "Free delivery over ₹499";
const SEEDED_MID = "20% off featured picks";

test("banners render per placement, admin CRUD swaps the cart promo, analytics land", async ({
  browser,
}) => {
  // 240s: same headroom flash-deal.spec takes — as the first spec this run
  // absorbs the cold-Vite compile of the whole shared graph before the flow
  // proper starts (the config's 150s default isn't enough for that plus CRUD).
  test.setTimeout(240_000);
  const customerContext = await browser.newContext();
  const customer = await customerContext.newPage();
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  // Delete confirms with window.confirm — accept it (Playwright dismisses
  // dialogs by default).
  admin.on("dialog", (dialog) => void dialog.accept());

  try {
    // ── Homepage: one hero carousel + one mid strip, from the API ───────
    // 120s: as the alphabetically first spec on the heaviest page, this pays
    // the whole cold-Vite compile (~66s per playwright.config.ts) before the
    // SPA boots far enough to fire the banner query.
    const [heroResponse] = await Promise.all([
      customer.waitForResponse(
        (r) => r.url().includes("/api/banners") && r.url().includes("placement=home_hero"),
        { timeout: 120_000 },
      ),
      customer.goto("/", { timeout: 120_000 }),
    ]);
    expect(heroResponse.ok()).toBeTruthy();
    const heroSlides: unknown = await heroResponse.json();
    expect(Array.isArray(heroSlides)).toBeTruthy();
    expect((heroSlides as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((heroSlides as unknown[]).length).toBeLessThanOrEqual(5); // server-side cap

    const carousels = customer.locator('section[aria-roledescription="carousel"]');
    await expect(carousels).toHaveCount(1); // no stacking: one hero only
    // getByRole, not getByText: the slide title also mirrors into the
    // carousel's sr-only live region, which would trip strict mode.
    await expect(
      carousels.getByRole("heading", { name: "Fresh picks for the week" }),
    ).toBeVisible();
    await expect(customer.locator(`section[aria-label="${SEEDED_MID}"]`)).toHaveCount(1);

    // ── Category page: one header banner; a plain search shows none ─────
    await customer.goto("/products?category=fresh-produce");
    const header = customer.locator('section[aria-label="Fresh produce"]');
    // 30s: first visit to /products compiles that route chunk on demand.
    await expect(header).toBeVisible({ timeout: 30_000 });
    await expect(header).toContainText("Fruit and vegetables, picked this morning.");

    await customer.goto("/products?q=zzzz");
    await expect(customer.locator('section[aria-roledescription="carousel"]')).toHaveCount(0);
    await expect(customer.locator('section[aria-label="Fresh produce"]')).toHaveCount(0);

    // ── Cart: the seeded promo strip + its ?coupon= deep link ───────────
    await login(customer, CUSTOMER);
    await emptyCart(customer);

    await customer.goto(`/p/${PRODUCT_SLUG}`);
    await customer.getByRole("button", { name: /Medium/ }).click();
    const add = customer.getByRole("button", { name: "Add to cart" });
    await expect(add).toBeEnabled();
    // The 201 is the ground truth; the inline note below is only its visible
    // echo, and it self-clears 2.5s after painting — so wait for the server
    // response first, then give the repaint the full 30s on a loaded host.
    const [addResponse] = await Promise.all([
      customer.waitForResponse(
        (r) => r.url().includes("/api/cart/items") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      add.click(),
    ]);
    expect(addResponse.ok()).toBeTruthy();
    await expect(customer.locator("body")).toContainText("Added to your cart", {
      timeout: 30_000,
    });

    await customer.goto("/cart");
    const seededPromo = customer.locator(`section[aria-label="${SEEDED_CART_TITLE}"]`);
    await expect(seededPromo).toBeVisible();
    await dropLeftoverCoupon(customer);

    // Registered before the click: the ?coupon= effect can fire the apply
    // POST during mount, i.e. before waitForURL would even resolve.
    const [couponResponse] = await Promise.all([
      customer.waitForResponse(
        (r) => r.url().includes("/api/cart/coupon") && r.request().method() === "POST",
        { timeout: 30_000 },
      ),
      seededPromo.getByRole("link").click(),
    ]);
    await customer.waitForURL("**/cart?coupon=FREESHIP");
    expect(couponResponse.ok()).toBeTruthy();
    await expect(customer.locator("body")).toContainText("applied", { timeout: 30_000 }); // coupon chip
    // ...and the param is stripped once applied, so a refresh can't re-fire it.
    await expect.poll(() => customer.url(), { timeout: 10_000 }).not.toContain("coupon=");
    await expect(seededPromo).toBeVisible(); // still the strip: ours doesn't exist yet

    // ── Admin: create a higher-priority cart promo ──────────────────────
    await login(admin, ADMIN);
    await admin.goto("/admin/banners");
    // 30s: first visit compiles AdminShell + the Banners page chunk.
    await expect(admin.getByRole("heading", { name: "Banners" })).toBeVisible({
      timeout: 30_000,
    });

    await admin.getByRole("button", { name: "+ New banner" }).click();
    // Ids over getByLabel: "Placement" would also substring-match the filter
    // select's aria-label="Filter by placement" (strict-mode violation).
    await admin.locator("#banner_title").fill(MY_TITLE);
    await admin.locator("#banner_placement").selectOption("cart_promo");
    await admin.locator("#banner_link_type").selectOption("url");
    await admin.locator("#banner_link_target").fill("/products");
    await admin.locator("#banner_image").fill("/api/img/placeholder.svg?text=E2E");
    await admin.locator("#banner_priority").fill("1"); // beats the seeded strip (10)
    await admin.getByRole("button", { name: "Create banner" }).click();
    // Toasts live only 5s, so anchor on the mutation response first.
    // NB: admin routes live under /api/admin/banners — "/api/banners" (the
    // public endpoint) never appears in that URL, so filter on "admin".
    await admin.waitForResponse(
      (r) => r.url().includes("/admin/banners") && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await expect(admin.locator("body")).toContainText("Banner created.", { timeout: 15_000 });

    const myRow = admin.locator("tr").filter({ hasText: MY_TITLE });
    await expect(myRow).toContainText("Active");
    await expect(myRow).toContainText("0%"); // CTR before anyone sees it

    // ── Customer: the new strip displaces the seeded one ────────────────
    await customer.goto("/cart");
    const myPromo = customer.locator(`section[aria-label="${MY_TITLE}"]`);
    await expect(myPromo).toBeVisible();
    await expect(customer.locator(`section[aria-label="${SEEDED_CART_TITLE}"]`)).toHaveCount(0);

    // Click it: navigation works AND the event flushes immediately.
    await myPromo.getByRole("link").click();
    await customer.waitForURL("**/products");

    // ── Analytics: the admin list merges the Redis buffer, so impressions
    //    and clicks are live (no Postgres round trip per view) ───────────
    await expect.poll(
      async () => {
        // reload() resolves on the load event, but the admin page is an SPA —
        // its list query is still in flight after that. Wait for the actual
        // GET, or every poll iteration reads the skeleton and reloads again
        // before the data can render (it would race forever).
        await Promise.all([
          admin.waitForResponse(
            (r) => r.url().includes("/admin/banners") && r.request().method() === "GET",
            { timeout: 30_000 },
          ),
          admin.reload(),
        ]);
        // The response arriving doesn't mean React has committed the row yet
        // — wait for it explicitly, then read the merged counters.
        await admin
          .locator("tr")
          .filter({ hasText: MY_TITLE })
          .first()
          .waitFor({ state: "attached", timeout: 5_000 })
          .catch(() => null);
        const cells = await admin
          .locator("tr")
          .filter({ hasText: MY_TITLE })
          .locator("td")
          .allTextContents();
        if (cells.length < 8) return 0; // columns: banner, placement, status,
        const impressions = Number(cells[5]) || 0; // window, priority, impr,
        const clicks = Number(cells[6]) || 0; // clicks, ctr, actions
        return Math.min(impressions, clicks);
      },
      { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
    ).toBeGreaterThanOrEqual(1);

    // ── Admin: delete it — the seeded promo returns ─────────────────────
    await myRow.getByRole("button", { name: "Delete" }).click();
    await admin.waitForResponse(
      (r) =>
        r.url().includes("/admin/banners") && r.request().method() === "DELETE",
      { timeout: 30_000 },
    );
    await expect(admin.locator("body")).toContainText("Banner deleted.", { timeout: 15_000 });
    await expect(admin.locator("tr").filter({ hasText: MY_TITLE })).toHaveCount(0);

    await customer.goto("/cart");
    await expect(customer.locator(`section[aria-label="${SEEDED_CART_TITLE}"]`)).toBeVisible();
    await expect(customer.locator(`section[aria-label="${MY_TITLE}"]`)).toHaveCount(0);
  } finally {
    // Best-effort cleanup: never leak the fixture banner into the demo.
    // A failed run can leave the admin page mid-reload, and a bare DOM
    // count() then sees a skeleton (zero rows), skips the delete, and
    // leaks the banner — which displaces the seeded cart strip and fails
    // the NEXT run on its first cart visit. So settle the list first and
    // take the row set from the response body, not from a DOM race.
    try {
      const [list] = await Promise.all([
        admin.waitForResponse(
          (r) => r.url().includes("/admin/banners") && r.request().method() === "GET",
          { timeout: 30_000 },
        ),
        admin.goto("/admin/banners"),
      ]);
      const body = (await list.json()) as { items?: Array<{ title?: string }> };
      const stray = admin.locator("tr").filter({ hasText: MY_TITLE });
      if ((body.items ?? []).some((b) => b.title === MY_TITLE)) {
        // click() auto-waits for the row to be actionable after the reload.
        await stray.getByRole("button", { name: "Delete" }).click();
        await expect(stray).toHaveCount(0, { timeout: 10_000 });
      }
    } catch {
      // page already closed or banner already gone — nothing to clean
    } finally {
      await adminContext.close();
      await customerContext.close();
    }
  }
});
