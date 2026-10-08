import { expect, test, type Page } from "@playwright/test";

import { CUSTOMER, dropLeftoverCoupon, emptyCart, inr, login } from "./helpers";

/**
 * Phase 1 E2E: the online-payment loop against the mock Zarinpal gateway.
 *
 *   place order (Online payment) → local StartPay page → Complete payment →
 *   back on /payment/result, paid and confirmed
 *
 *   …and the unhappy path: Simulate failure → the order stays Pending with a
 *   working Retry payment → second attempt succeeds.
 *
 * Runs against the dev stack (`docker compose up -d`). No ZARINPAL_MERCHANT_ID
 * is configured there, so the provider serves its own StartPay stand-in at
 * /api/payments/mock/{authority} with a Complete / Simulate failure choice.
 */

// Pampers Diapers · Medium pack — ₹749, the default variant on the page.
const PRODUCT_SLUG = "pampers-diapers";
const SUBTOTAL = 749;
const DELIVERY = 40; // below the ₹999 free-delivery threshold
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

/** Cart → checkout with the online method chosen, ready to place. */
async function checkoutOnline(page: Page) {
  await page.goto("/cart");
  await dropLeftoverCoupon(page);
  await expect(page.locator("body")).toContainText(inr(SUBTOTAL));

  const go = page.getByRole("button", { name: "Proceed to checkout" });
  await expect(go).toBeEnabled();
  await go.click();
  await page.waitForURL("**/checkout");

  await page.getByRole("radio", { name: /Online payment/ }).check();
  const place = page.getByRole("button", { name: /^Continue to payment/ });
  await expect(place).toBeEnabled();
  await expect(place).toContainText(inr(TOTAL));
  await place.click();

  // The browser is handed over to the gateway (the local mock StartPay page).
  await page.waitForURL(/\/api\/payments\/mock\//);
  await expect(page.getByRole("heading", { name: /mock gateway/i })).toBeVisible();
}

/** Pick an outcome on the StartPay page and wait for the SPA return page. */
async function chooseGatewayOutcome(page: Page, outcome: "ok" | "fail") {
  const label = outcome === "ok" ? "Complete payment" : "Simulate failure";
  await page.getByRole("link", { name: label }).click();
  await page.waitForURL(/\/payment\/result/);
}

test("customer pays online and the order comes back confirmed", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await seedCart(page);
    await checkoutOnline(page);
    await chooseGatewayOutcome(page, "ok");

    // The return page polls the server for the verdict — paid, not the URL hint.
    await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible();
    await expect(page.locator("body")).toContainText(inr(TOTAL));
    await expect(page.locator("body")).toContainText("Payment complete");

    await page.getByRole("button", { name: "View order" }).click();
    await page.waitForURL(/\/orders\/\d+/);

    await expect(page.locator("body")).toContainText("Confirmed");
    await expect(page.locator("body")).toContainText("paid");
    // Money landed: no retry offer, no payment window countdown.
    await expect(page.getByRole("button", { name: "Retry payment" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Payment window");
  } finally {
    await context.close();
  }
});

test("a failed payment keeps the order payable, and retry succeeds", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await seedCart(page);
    await checkoutOnline(page);
    await chooseGatewayOutcome(page, "fail");

    // ── The return page says it failed and offers a way out ────────────────
    await expect(page.getByRole("heading", { name: /didn't go through/i })).toBeVisible();
    await expect(page.locator("body")).toContainText("Nothing was charged");
    await expect(page.getByRole("button", { name: "Retry payment" })).toBeEnabled();

    // ── …and so does the order page, where the customer really lands ───────
    await page.getByRole("button", { name: "Back to order" }).click();
    await page.waitForURL(/\/orders\/\d+/);

    await expect(page.locator("body")).toContainText("Pending");
    await expect(page.locator("body")).toContainText("failed");
    await expect(page.locator("body")).toContainText("Payment window");

    // ── Second attempt from the order page ─────────────────────────────────
    await page.getByRole("button", { name: "Retry payment" }).click();
    await page.waitForURL(/\/api\/payments\/mock\//);
    await chooseGatewayOutcome(page, "ok");

    await expect(page.getByRole("heading", { name: /Thank you/ })).toBeVisible();

    await page.getByRole("button", { name: "View order" }).click();
    await page.waitForURL(/\/orders\/\d+/);
    await expect(page.locator("body")).toContainText("Confirmed");
    await expect(page.locator("body")).toContainText("paid");
    await expect(page.getByRole("button", { name: "Retry payment" })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
