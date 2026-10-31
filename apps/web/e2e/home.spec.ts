import { expect, test } from '@playwright/test';

test('the home page is the public site: hero, header and sections', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Inkline/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Read the Best');
  await expect(page.getByRole('link', { name: 'Inkline home' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start reading' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New episodes' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Trending this week' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browse by genre' })).toBeVisible();
});
