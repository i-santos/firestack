import { test, expect } from '@playwright/test';

test('placeholder smoke @smoke', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/.*/);
});

test('placeholder full @full', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/.*/);
});
