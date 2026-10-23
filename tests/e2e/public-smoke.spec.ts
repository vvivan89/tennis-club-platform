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

test('primary navigation reaches public events, gallery, and contacts pages', async ({ page }) => {
  test.skip(
    !process.env.NEXT_PUBLIC_SUPABASE_URL && !process.env.PLAYWRIGHT_BASE_URL,
    'The public data pages require a configured test Supabase project.',
  );
  await page.goto('/');
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await navigation.getByRole('link', { name: 'Events' }).click();
  await expect(page.getByRole('heading', { name: 'Club events' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Gallery' })
    .click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Contacts' })
    .click();
  await expect(page.getByRole('heading', { name: /Contact/ })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('navigation', { name: 'Main navigation mobile' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation mobile' })
      .getByRole('link', { name: 'Events' }),
  ).toBeVisible();
});
