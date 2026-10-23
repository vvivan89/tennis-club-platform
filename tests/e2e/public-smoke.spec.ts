import { expect, test } from '@playwright/test';

test('home page responds successfully', async ({ page }) => {
  const response = await page.goto('/');
  expect(response, 'home page should return an HTTP response').not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
  await expect(page.locator('body')).not.toBeEmpty();
});

test('events page responds successfully when Supabase is configured', async ({ page }) => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.PLAYWRIGHT_BASE_URL,
    'The server-rendered events page requires a configured Supabase project.',
  );
  const response = await page.goto('/events');
  expect(response, 'events page should return an HTTP response').not.toBeNull();
  expect(response!.status()).toBeLessThan(400);
  await expect(page.locator('body')).not.toBeEmpty();
});
