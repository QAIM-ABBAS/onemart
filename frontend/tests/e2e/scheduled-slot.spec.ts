import { expect, test, type Page } from "@playwright/test";

import { CUSTOMER, dropLeftoverCoupon, emptyCart, inr, login } from "./helpers";

// Fail fast with an actionability reason instead of silently eating the whole
// test timeout when a click/check can never land.
test.use({ actionTimeout: 30_000 });

/**
 * Phase 2 E2E: scheduled-slot checkout against the seeded Bengaluru zone.
 *
 *   saved address (PIN 560001, inside the seeded zone) → Delivery section →
 *   Scheduled slot → pick a day + a bookable window → Place order (COD) →
 *   the order page shows the booked window and the zone's standard fee.
 *
 * Runs against the dev stack (`docker compose up -d`) after
 * `python -m app.seed`, which creates the Bengaluru zone, its weekly
 * template, and 14 days of slots.
 *
 * Today's windows are usually past the cutoff by test time, so the flow
 * picks the first day that still advertises a bookable window — the same
 * signal a customer sees.
 */

// Pampers Diapers · Medium pack — ₹749, the default variant on the page.
const PRODUCT_SLUG = "pampers-diapers";
const SUBTOTAL = 749;
const DELIVERY = 40; // the seeded zone's standard fee (under ₹999 free over)
const TOTAL = SUBTOTAL + DELIVERY; // ₹789.00

/** Sign in, start from an empty cart, and put one Medium pack in it. */
async function seedCart(page: Page) {
  await login(page, CUSTOMER);
  await emptyCart(page);

  await page.goto(`/p/${PRODUCT_SLUG}`);
  await page.getByRole("button", { name: /Medium/ }).click();
  const add = page.getByRole("button", { name: "Add to cart" });
  await expect(add).toBeEnabled();
  await add.click();
  await expect(page.locator("body")).toContainText("Added to your cart");
}

test("customer books a scheduled slot and the window shows on the order", async ({
  browser,
}) => {
  // The longest flow in the suite (login → cart → checkout → booked order);
  // a cold Vite compile can eat a big slice of the 150s default.
  test.setTimeout(210_000);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await seedCart(page);

    await page.goto("/cart");
    await dropLeftoverCoupon(page);
    const go = page.getByRole("button", { name: "Proceed to checkout" });
    await expect(go).toBeEnabled();
    await go.click();
    await page.waitForURL("**/checkout");

    // The default address (560001) matches the seeded zone, so checkout shows
    // methods — not the unserviceable block.
    await expect(
      page.getByRole("heading", { name: "Delivery", exact: true, level: 2 }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText(
      "We do not deliver to this address yet",
    );

    // ── Scheduled reveals the day chips + slot grid for the matched zone ──
    await page.getByRole("radio", { name: /Scheduled slot/ }).check();
    const day = page.getByRole("button", { name: /windows/ }).first();
    await expect(day).toBeVisible({ timeout: 15_000 });
    await day.click();

    const windowButton = page.getByRole("button", { name: /Available|Few left/ }).first();
    await expect(windowButton).toBeEnabled();
    const label = (await windowButton.textContent()) ?? "";
    const times = label.match(/(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})/);
    expect(times, `slot button "${label}" shows a time window`).not.toBeNull();
    await windowButton.click();

    // ── The order cannot be placed before a slot is picked ────────────────
    // (the summary is honest about the fee while we're still deciding)
    await expect(page.locator("body")).toContainText(inr(TOTAL));

    // Cash on delivery keeps this test about the slot, not the gateway. It is
    // the default method — assert it rather than clicking. NB: getByRole name
    // REGEXES are case-sensitive; the rendered label is "Cash on Delivery".
    await expect(page.getByRole("radio", { name: /cash on delivery/i })).toBeChecked();
    const place = page.getByRole("button", { name: /^Place order/ });
    await expect(place).toBeEnabled();
    await place.click();

    // ── The order detail names the method and the booked window ───────────
    await page.waitForURL(/\/orders\/\d+/);
    await expect(page.locator("body")).toContainText("Scheduled slot");
    await expect(page.locator("body")).toContainText(`${times![1]}–${times![2]}`);
    await expect(page.locator("body")).toContainText(inr(TOTAL));
    await expect(page.locator("body")).toContainText("Delivery");
  } finally {
    await context.close();
  }
});

test("scheduled without a slot cannot be placed", async ({ browser }) => {
  test.setTimeout(210_000);
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await seedCart(page);

    await page.goto("/cart");
    await dropLeftoverCoupon(page);
    const go = page.getByRole("button", { name: "Proceed to checkout" });
    await expect(go).toBeEnabled();
    await go.click();
    await page.waitForURL("**/checkout");

    await page.getByRole("radio", { name: /Scheduled slot/ }).check();
    // The grid is up (or explicitly empty), but nothing is selected yet.
    await expect(
      page.getByRole("button", { name: /windows/ }).first().or(page.getByText("No delivery slots")),
    ).toBeVisible({ timeout: 15_000 });

    // Submit stays disabled while the method needs a slot and none is picked.
    const place = page.getByRole("button", { name: /^Place order/ });
    await expect(place).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("Order placed");
  } finally {
    await context.close();
  }
});
