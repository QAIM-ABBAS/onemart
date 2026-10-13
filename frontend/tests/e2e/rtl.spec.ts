import { test, expect } from '@playwright/test';

const ROUTES = [
  '/',
  '/products',
  '/cart',
  '/login',
  '/register',
  '/checkout',
];

const PRODUCT_SLUG = 'pampers-diapers';

for (const lang of ['fa', 'en'] as const) {
  for (const [w, h] of [[390, 844], [1280, 800]] as const) {
    for (const route of ROUTES) {
      test(`${lang} ${w}px ${route}`, async ({ page }) => {
        const missing: string[] = [];
        page.on('console', (m) => {
          if (m.text().includes('MISSING_I18N_KEY')) missing.push(m.text());
        });
        await page.setViewportSize({ width: w, height: h });
        await page.addInitScript((l) => localStorage.setItem('onemart_lang', l), lang);
        await page.goto(route);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('html')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow).toBe(false);
        const raw = await page.evaluate(() =>
          (document.body.innerText.match(/\b[a-z]+(?:\.[a-zA-Z_]+)+\b/g) ?? []).filter((s) => !/\.(com|ir|org|net|io|js|ts)$/.test(s)));
        expect(raw, 'raw i18n keys visible').toEqual([]);
        expect(missing, 'missing i18n keys').toEqual([]);
        await page.screenshot({ path: `rtl-screenshots/${lang}-${w}-${route.replace(/\W+/g, '_') || 'home'}.png`, fullPage: true });
      });
    }
    // Product page (needs a real slug)
    test(`${lang} ${w}px /p/${PRODUCT_SLUG}`, async ({ page }) => {
      const missing: string[] = [];
      page.on('console', (m) => {
        if (m.text().includes('MISSING_I18N_KEY')) missing.push(m.text());
      });
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript((l) => localStorage.setItem('onemart_lang', l), lang);
      await page.goto(`/p/${PRODUCT_SLUG}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      const raw = await page.evaluate(() =>
        (document.body.innerText.match(/\b[a-z]+(?:\.[a-zA-Z_]+)+\b/g) ?? []).filter((s) => !/\.(com|ir|org|net|io|js|ts)$/.test(s)));
      expect(raw, 'raw i18n keys visible').toEqual([]);
      expect(missing, 'missing i18n keys').toEqual([]);
      await page.screenshot({ path: `rtl-screenshots/${lang}-${w}-product.png`, fullPage: true });
    });
    // Auth routes
    test(`${lang} ${w}px /auth/forgot`, async ({ page }) => {
      const missing: string[] = [];
      page.on('console', (m) => {
        if (m.text().includes('MISSING_I18N_KEY')) missing.push(m.text());
      });
      await page.setViewportSize({ width: w, height: h });
      await page.addInitScript((l) => localStorage.setItem('onemart_lang', l), lang);
      await page.goto('/auth/forgot');
      await page.waitForLoadState('networkidle');
      await expect(page.locator('html')).toHaveAttribute('dir', lang === 'fa' ? 'rtl' : 'ltr');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      const raw = await page.evaluate(() =>
        (document.body.innerText.match(/\b[a-z]+(?:\.[a-zA-Z_]+)+\b/g) ?? []).filter((s) => !/\.(com|ir|org|net|io|js|ts)$/.test(s)));
      expect(raw, 'raw i18n keys visible').toEqual([]);
      expect(missing, 'missing i18n keys').toEqual([]);
      await page.screenshot({ path: `rtl-screenshots/${lang}-${w}-forgot.png`, fullPage: true });
    });
  }
}