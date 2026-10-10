import { expect, test, type Page } from "@playwright/test";

import { ADMIN, CUSTOMER, dropLeftoverCoupon, emptyCart, inr, login } from "./helpers";

/**
 * Phase 3 flash-deal loop, end to end on the dev stack:
 *
 *   homepage strip (countdown + claimed meter) → product page deal price →
 *   cart / checkout flash rows → order placed at the deal price → the claimed
 *   counter moves by exactly one → admin sees the live sold/remaining →
 *   customer cancels and the counter moves back (exactly-once release) →
 *   deactivating the deal hides the strip, re-enabling brings it back.
 *
 * Seeded deal: "Weekend Flash Sale" — Surf Excel Easy Wash 1 kg, ₹135 →
 * 20 % off = ₹108, 100 units, max 5 per customer. Claimed/released counters
 * are read dynamically, so re-running the suite never asserts stale numbers
 * (and cancelling at the end returns both the stock and the per-customer
 * budget, keeping the demo account usable).
 */

test.use({ actionTimeout: 30_000 });

const DEAL_NAME = "Weekend Flash Sale";
const SLUG = "surf-excel-easy-wash";
const LIST = 135;
const DEAL = 108; // ₹135 − 20 %
const CUT = LIST - DEAL; // ₹27 — flash cuts land in discount_total
const TOTAL = DEAL + 40; // flat ₹40 delivery under ₹999
const LIMIT = 100;

interface Claimed {
  claimed: number;
  remaining: number;
}

/** Load the homepage and wait for the deals payload (never a stale shell). */
async function gotoHome(page: Page) {
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/deals/active") && r.request().method() === "GET",
      { timeout: 30_000 },
    ),
    page.goto("/"),
  ]);
  expect(resp.ok()).toBeTruthy();
}

/** The Surf card's "N% claimed · M left" caption on the strip. */
async function readStripClaim(page: Page): Promise<Claimed> {
  const card = page
    .locator("section:has(#flash-deals-heading)")
    .locator(`a[href="/p/${SLUG}"]`);
  const caption = card.getByText(/^\d+% claimed · \d+ left$/);
  await expect(caption).toBeVisible({ timeout: 15_000 });
  const match = (await caption.textContent())!.match(/(\d+)% claimed · (\d+) left/);
  expect(match).not.toBeNull();
  return { claimed: Number(match![1]), remaining: Number(match![2]) };
}

test("flash deal: strip → PDP → cart → checkout, claim/release, admin visibility", async ({
  browser,
}) => {
  // Two sign-ins and a dozen navigations across cold route chunks.
  test.setTimeout(240_000);

  const customerContext = await browser.newContext();
  const customer = await customerContext.newPage();
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();

  let deactivated = false;

  /** Best-effort undo: a crashed run must never leave the strip switched off. */
  async function restoreDeal() {
    if (!deactivated) return;
    try {
      await admin.goto("/admin/flash-deals");
      const row = admin.locator("tr").filter({ hasText: DEAL_NAME });
      await row.getByRole("button", { name: "Edit" }).click();
      await admin.getByLabel(/can be paused/).check();
      await admin.getByRole("button", { name: "Save deal" }).click();
      await expect(admin.locator("body")).toContainText("Deal updated.");
      deactivated = false;
    } catch {
      // Best effort only — a paused demo deal is visible in admin either way.
    }
  }

  try {
    // ── Customer: signed in, empty cart, a deal is live on the strip ────
    await login(customer, CUSTOMER);
    await emptyCart(customer);

    await gotoHome(customer);
    await expect(customer.getByRole("heading", { name: DEAL_NAME })).toBeVisible();
    await expect(customer.getByText("Limited stock").first()).toBeVisible();
    await expect(customer.getByText("Expires in").first()).toBeVisible();

    const strip = customer.locator("section:has(#flash-deals-heading)");
    await expect(strip.locator('a[href^="/p/"]')).toHaveCount(3);

    const before = await readStripClaim(customer);
    // Fresh stock reads 100 left; re-runs read less after earlier claims.
    // Anything above the seeded limit would mean the payload is lying.
    expect(before.remaining).toBeLessThanOrEqual(LIMIT);

    // ── Product page: the deal price beats the list price ────────────────
    await strip.locator(`a[href="/p/${SLUG}"]`).click();
    await customer.waitForURL(`**/p/${SLUG}`);
    await customer.getByRole("button", { name: /1 kg/ }).click();

    await expect(customer.getByText(/Flash deal −20%/)).toBeVisible();
    await expect(customer.locator("body")).toContainText(inr(DEAL));
    await expect(customer.locator("body")).toContainText(inr(LIST));
    await expect(customer.getByTestId("flash-deal-meter")).toContainText(
      `${before.claimed}% claimed · ${before.remaining} left in this deal`,
    );

    const add = customer.getByRole("button", { name: "Add to cart" });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(customer.locator("body")).toContainText("Added to your cart");

    // ── Cart: deal line struck to list, the cut as its own row ───────────
    await customer.goto("/cart");
    await dropLeftoverCoupon(customer);
    await expect(customer.getByText(`${inr(DEAL)} each`)).toBeVisible();
    await expect(customer.locator("body")).toContainText(inr(LIST)); // subtotal
    await expect(customer.locator("body")).toContainText(`−${inr(CUT)}`);
    await expect(customer.locator("body")).toContainText(inr(TOTAL));

    // ── Checkout: the same flash row reaches the summary ─────────────────
    const proceed = customer.getByRole("button", { name: "Proceed to checkout" });
    await expect(proceed).toBeEnabled();
    await proceed.click();
    await customer.waitForURL("**/checkout");
    await expect(customer.locator("body")).toContainText(`−${inr(CUT)}`);
    await expect(customer.locator("body")).toContainText(inr(DEAL));

    const place = customer.getByRole("button", { name: /^Place order/ });
    await expect(place).toBeEnabled();
    await place.click();
    await customer.waitForURL(/\/orders\/\d+/);
    const orderId = new URL(customer.url()).pathname.split("/").pop()!;

    await expect(customer.locator("body")).toContainText("Order placed");
    await expect(customer.locator("body")).toContainText(`−${inr(CUT)}`);
    await expect(customer.locator("body")).toContainText(inr(TOTAL));

    // ── The claim moved: one unit down, one percent up ───────────────────
    await gotoHome(customer);
    const during = await readStripClaim(customer);
    expect(during.remaining).toBe(before.remaining - 1);
    expect(during.claimed).toBe(before.claimed + 1);

    // ── Admin: live status and the real sold/remaining counter ───────────
    await login(admin, ADMIN);
    await admin.goto("/admin/flash-deals");
    const row = admin.locator("tr").filter({ hasText: DEAL_NAME });
    await expect(row).toContainText("Live");
    await row.getByRole("button", { name: "Items" }).click();
    await expect(admin.getByRole("heading", { name: `${DEAL_NAME} — items` })).toBeVisible();
    const soldBefore = LIMIT - before.remaining;
    const surfRow = admin.locator("tr").filter({ hasText: "Surf Excel Easy Wash" });
    await expect(surfRow).toContainText(
      `${soldBefore + 1} / ${LIMIT} · ${before.remaining - 1} left`,
    );

    // ── Customer cancels → release puts the unit back (exactly once) ────
    await customer.goto(`/orders/${orderId}`);
    const cancel = customer.getByRole("button", { name: "Cancel order", exact: true });
    await expect(cancel).toBeVisible();
    await cancel.click();
    await customer
      .locator('[role="dialog"]')
      .getByRole("button", { name: "Cancel order" })
      .click();

    const [orderResponse] = await Promise.all([
      customer.waitForResponse(
        (r) => r.url().includes(`/api/orders/${orderId}`) && r.request().method() === "GET",
        { timeout: 30_000 },
      ),
      customer.reload(),
    ]);
    expect(orderResponse.ok()).toBeTruthy();
    expect((await orderResponse.json()).status).toBe("cancelled");

    await gotoHome(customer);
    const after = await readStripClaim(customer);
    expect(after.remaining).toBe(before.remaining);
    expect(after.claimed).toBe(before.claimed);

    // ── Deactivate: the whole strip disappears; re-enable brings it back ─
    await admin.goto("/admin/flash-deals");
    const editRow = admin.locator("tr").filter({ hasText: DEAL_NAME });
    await editRow.getByRole("button", { name: "Edit" }).click();
    await admin.getByLabel(/can be paused/).uncheck();
    await admin.getByRole("button", { name: "Save deal" }).click();
    await expect(admin.locator("body")).toContainText("Deal updated.");
    deactivated = true;

    await gotoHome(customer);
    await expect(customer.getByRole("heading", { name: DEAL_NAME })).toHaveCount(0);

    await admin.goto("/admin/flash-deals");
    const enableRow = admin.locator("tr").filter({ hasText: DEAL_NAME });
    await enableRow.getByRole("button", { name: "Edit" }).click();
    await admin.getByLabel(/can be paused/).check();
    await admin.getByRole("button", { name: "Save deal" }).click();
    await expect(admin.locator("body")).toContainText("Deal updated.");
    deactivated = false;

    await gotoHome(customer);
    await expect(customer.getByRole("heading", { name: DEAL_NAME })).toBeVisible();
  } finally {
    await restoreDeal();
    await customerContext.close();
    await adminContext.close();
  }
});
