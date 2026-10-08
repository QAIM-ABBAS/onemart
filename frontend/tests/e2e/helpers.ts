import { expect, type Page } from "@playwright/test";

/**
 * Shared fixtures for the E2E suite: the seeded accounts everyone signs in
 * with, the money formatter the UI uses (so assertions read exactly what the
 * page renders), and the login / cart-reset steps every flow starts from.
 */

export const CUSTOMER = { email: "demo@onemart.test", password: "Demo@1234" };
export const ADMIN = { email: "admin@onemart.test", password: "Admin@1234" };

export const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);

export async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.fill("#email", user.email);
  await page.fill("#password", user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Start from a known state: no items left over from an earlier run. */
export async function emptyCart(page: Page) {
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
export async function dropLeftoverCoupon(page: Page) {
  const remove = page.locator("aside").getByRole("button", { name: "Remove" });
  if (await remove.count()) {
    await remove.click();
    await expect(remove).toHaveCount(0);
  }
}
