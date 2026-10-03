import { expect, test, type Page } from "@playwright/test";

/**
 * One Playwright test covering the whole Phase 2 pricing loop end to end:
 *
 *   add to cart → apply coupon → checkout with the discounted total →
 *   admin moves the order status → customer sees it on their timeline
 *
 * Runs against the dev stack (`docker compose up -d`) with the seeded demo
 * accounts. WELCOME10 = 10% off orders over ₹499, capped at ₹200.
 */

const CUSTOMER = { email: "demo@onemart.test", password: "Demo@1234" };
const ADMIN = { email: "admin@onemart.test", password: "Admin@1234" };

// Pampers Diapers · Medium pack — ₹749, and the default variant on the page.
const PRODUCT_SLUG = "pampers-diapers";
const SUBTOTAL = 749;
const DISCOUNT = 74.9; // 10% of ₹749, under the ₹200 cap
const PAYABLE = SUBTOTAL - DISCOUNT; // ₹674.10 → below ₹999, so delivery applies
const DELIVERY = 40;
const TOTAL = PAYABLE + DELIVERY; // ₹714.10
const NOTE = "Confirmed by the checkout flow test";

const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Start from a known state: no items left over from an earlier run. */
async function emptyCart(page: Page) {
  await page.goto("/cart");
  await expect(
    page.getByText("Your cart is empty").or(page.locator("article")).first(),
  ).toBeVisible();

  for (let i = 0; i < 40; i += 1) {
    // Scoped to the item list so the coupon's own Remove button is never clicked.
    const remove = page.locator("article").getByRole("button", { name: "Remove" });
    const count = await remove.count();
    if (count === 0) break;
    await remove.first().click();
    await expect(remove).toHaveCount(count - 1);
  }

  await expect(page.locator("body")).toContainText("Your cart is empty");
}

/**
 * A code pinned by an earlier run replaces the input with a chip (and an empty
 * cart hides the block entirely, so this can only be done once items exist).
 */
async function dropLeftoverCoupon(page: Page) {
  const remove = page.locator("aside").getByRole("button", { name: "Remove" });
  if (await remove.count()) {
    await remove.click();
    await expect(remove).toHaveCount(0);
  }
}

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
