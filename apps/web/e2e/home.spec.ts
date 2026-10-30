import { expect, test } from '@playwright/test';

test('home page shows the Inkline placeholder', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Inkline/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Read the Best');
  await expect(page.getByRole('link', { name: 'Inkline home' })).toBeVisible();
  await expect(page.getByText('Coming soon')).toBeVisible();
});
