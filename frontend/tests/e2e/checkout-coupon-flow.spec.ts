import { expect, test } from "@playwright/test";

import { ADMIN, CUSTOMER, dropLeftoverCoupon, emptyCart, inr, login } from "./helpers";

/**
 * One Playwright test covering the whole Phase 2 pricing loop end to end:
 *
 *   add to cart → apply coupon → checkout with the discounted total →
 *   admin moves the order status → customer sees it on their timeline
 *
 * Runs against the dev stack (`docker compose up -d`) with the seeded demo
 * accounts. WELCOME10 = 10% off orders over ₹499, capped at ₹200.
 */

// Pampers Diapers · Medium pack — ₹749, and the default variant on the page.
const PRODUCT_SLUG = "pampers-diapers";
const SUBTOTAL = 749;
const DISCOUNT = 74.9; // 10% of ₹749, under the ₹200 cap
const PAYABLE = SUBTOTAL - DISCOUNT; // ₹674.10 → below ₹999, so delivery applies
const DELIVERY = 40;
const TOTAL = PAYABLE + DELIVERY; // ₹714.10
const NOTE = "Confirmed by the checkout flow test";

test("customer buys with a coupon, admin moves the status, the timeline shows it", async ({
  browser,
}) => {
  const customerContext = await browser.newContext();
  const customer = await customerContext.newPage();

  try {
    // ── Customer: sign in and start from an empty cart ───────────────────
    await login(customer, CUSTOMER);
    await emptyCart(customer);

    // ── Add to cart from the product page ─────────────────────────────────
    await customer.goto(`/p/${PRODUCT_SLUG}`);
    await customer.getByRole("button", { name: /Medium/ }).click();
    const add = customer.getByRole("button", { name: "Add to cart" });
    await expect(add).toBeEnabled();
    await add.click();
    await expect(customer.locator("body")).toContainText("Added to your cart");

    // ── Apply the coupon on the cart ──────────────────────────────────────
    await customer.goto("/cart");
    await expect(customer.locator("body")).toContainText(inr(SUBTOTAL));
    await dropLeftoverCoupon(customer);

    await customer.getByLabel("Coupon code").fill("welcome10"); // case-insensitive
    await customer.getByRole("button", { name: "Apply" }).click();

    await expect(customer.locator("body")).toContainText("WELCOME10");
    await expect(customer.locator("body")).toContainText(`−${inr(DISCOUNT)}`);
    await expect(customer.locator("body")).toContainText(inr(TOTAL));

    // ── Checkout: the same discounted total reaches the order summary ─────
    const checkout = customer.getByRole("button", { name: "Proceed to checkout" });
    await expect(checkout).toBeEnabled();
    await checkout.click();
    await customer.waitForURL("**/checkout");
    await expect(customer.locator("body")).toContainText("WELCOME10");
    await expect(customer.locator("body")).toContainText(`−${inr(DISCOUNT)}`);

    const place = customer.getByRole("button", { name: /^Place order/ });
    await expect(place).toBeEnabled();
    await place.click();
    await customer.waitForURL(/\/orders\/\d+/);
    const orderId = new URL(customer.url()).pathname.split("/").pop()!;

    await expect(customer.locator("body")).toContainText("Order placed");
    await expect(customer.locator("body")).toContainText(inr(TOTAL));
    await expect(customer.locator("body")).toContainText(`−${inr(DISCOUNT)}`);

    // ── Admin: confirm the order with a note for the timeline ─────────────
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();

    try {
      await login(admin, ADMIN);
      await admin.goto(`/admin/orders/${orderId}`);

      await expect(admin.locator("body")).toContainText(inr(DISCOUNT)); // Totals card
      await admin.selectOption("#next-status", "confirmed");
      await admin.fill("#status-note", NOTE);
      await admin.getByRole("button", { name: "Update status" }).click();
      await expect(admin.locator("body")).toContainText("Status updated to Confirmed");

      // ── Customer: reload and read back their own order ──────────────────
      const [orderResponse] = await Promise.all([
        customer.waitForResponse(
          (r) => r.url().includes(`/api/orders/${orderId}`) && r.request().method() === "GET",
        ),
        customer.reload(),
      ]);
      expect(orderResponse.ok()).toBeTruthy();

      const order = await orderResponse.json();
      expect(order.status).toBe("confirmed");
      expect(order.discount_total).toBeCloseTo(DISCOUNT, 2);
      expect(order.coupon_code).toBe("WELCOME10");
      expect(order.total).toBeCloseTo(TOTAL, 2);
      expect(order.history.some((event: { note?: string | null }) => event.note === NOTE)).toBe(
        true,
      );

      const timeline = customer.locator("section").filter({ hasText: "Status timeline" });
      await expect(timeline).toBeVisible();
      await expect(timeline).toContainText(NOTE);
    } finally {
      await adminContext.close();
    }
  } finally {
    await customerContext.close();
  }
});
