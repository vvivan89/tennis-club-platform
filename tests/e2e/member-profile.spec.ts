import { expect, test, type Page } from '@playwright/test';

type ProfileSnapshot = {
  fullName: string;
  phone: string;
  dateOfBirth: string;
  birthdayEmoji: boolean;
  gender: string;
  playingHand: string;
  skill: string;
};

const email = process.env.PCTC_E2E_MEMBER_EMAIL;
const password = process.env.PCTC_E2E_MEMBER_PASSWORD;
const e2eUrl = process.env.PCTC_E2E_SUPABASE_URL;
const disposableDatabaseConfirmed =
  process.env.PCTC_E2E_DISPOSABLE_DATABASE === 'I_UNDERSTAND_THIS_IS_NOT_PRODUCTION' &&
  Boolean(e2eUrl) &&
  e2eUrl === process.env.NEXT_PUBLIC_SUPABASE_URL;
let original: ProfileSnapshot | null = null;

test.describe('member profile integration', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    test.skip(
      !email || !password || !disposableDatabaseConfirmed,
      'Requires a dedicated member and matching app/test Supabase URLs with PCTC_E2E_DISPOSABLE_DATABASE confirmation.',
    );
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill(email!);
    await page.getByLabel('Password').fill(password!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/member\/dashboard/);
    await page.goto('/member/profile');
    await expect(page.getByLabel('Full name')).toBeVisible();
    original = {
      fullName: await page.getByLabel('Full name').inputValue(),
      phone: await page.getByLabel(/Phone number/).inputValue(),
      dateOfBirth: await page.getByLabel(/Date of birth/).inputValue(),
      birthdayEmoji: await page.getByLabel(/Show a birthday cake emoji/).isChecked(),
      gender: await page.getByLabel('Gender (optional)').inputValue(),
      playingHand: await page.getByLabel('Playing hand (optional)').inputValue(),
      skill: await page.getByLabel('Tennis skill rating').inputValue(),
    };
  });

  test.afterEach(async ({ page }) => {
    if (!original || !email || !password || page.isClosed()) return;
    try {
      if (!page.url().includes('/member/profile')) {
        await page.goto('/member/profile');
        await expect(page.getByLabel('Full name')).toBeVisible();
      }
      await restoreProfile(page, original);
    } catch {
      test.info().annotations.push({
        type: 'cleanup-warning',
        description: 'Could not restore the dedicated E2E member profile; restore it manually.',
      });
    } finally {
      original = null;
    }
  });

  test('updates profile values, verifies persistence after refresh, and restores the fixture', async ({
    page,
  }) => {
    const snapshot = original!;
    await page.getByLabel('Full name').fill('PCTC E2E Profile Check');
    await page.getByLabel(/Phone number/).fill('6045550199');
    await page.getByLabel(/Phone number/).blur();
    await page.getByLabel('Tennis skill rating').selectOption('5.0');
    await page.getByLabel('Gender (optional)').selectOption('female');
    await page.getByLabel('Playing hand (optional)').selectOption('left');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByRole('status')).toContainText('Profile saved.');

    await page.reload();
    await expect(page.getByLabel('Full name')).toHaveValue('PCTC E2E Profile Check');
    await expect(page.getByLabel(/Phone number/)).toHaveValue('604.555.0199');
    await expect(page.getByLabel('Tennis skill rating')).toHaveValue('5.0');
    await expect(page.getByLabel('Gender (optional)')).toHaveValue('female');
    await expect(page.getByLabel('Playing hand (optional)')).toHaveValue('left');

    await restoreProfile(page, snapshot);
  });

  test('rejects invalid/oversized avatars and reports storage failures', async ({ page }) => {
    const file = page.locator('input[type="file"]');
    await file.setInputFiles({
      name: 'not-an-image.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not an image'),
    });
    await expect(page.getByRole('alert')).toContainText('Choose an image file.');

    await file.setInputFiles({
      name: 'large.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(3 * 1024 * 1024 + 1),
    });
    await expect(page.getByRole('alert')).toContainText('Avatar must be 3 MB or smaller.');

    await page.route('**/storage/v1/object/member-avatars/**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"message":"test storage failure"}',
      }),
    );
    await file.setInputFiles({
      name: 'avatar.png',
      mimeType: 'image/png',
      buffer: Buffer.from('small image fixture'),
    });
    await expect(page.getByRole('alert')).toContainText(
      'Could not upload avatar. Please try again.',
    );
  });

  test('prevents an ordinary member from opening the administrator dashboard', async ({ page }) => {
    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(/\/member\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('signs out and redirects from a protected profile route', async ({ page }) => {
    await page.getByRole('button', { name: 'Member menu' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/$/);
    original = null;
    await page.goto('/member/profile');
    await expect(page).toHaveURL(/\/login\?next=%2Fprofile|\/login\?next=\/profile/);
  });
});

async function restoreProfile(page: Page, snapshot: ProfileSnapshot) {
  await page.getByLabel('Full name').fill(snapshot.fullName);
  await page.getByLabel(/Phone number/).fill(snapshot.phone);
  await page.getByLabel(/Date of birth/).fill(snapshot.dateOfBirth);
  const birthdayToggle = page.getByLabel(/Show a birthday cake emoji/);
  if ((await birthdayToggle.isChecked()) !== snapshot.birthdayEmoji) await birthdayToggle.click();
  await page.getByLabel('Gender (optional)').selectOption(snapshot.gender);
  await page.getByLabel('Playing hand (optional)').selectOption(snapshot.playingHand);
  await page.getByLabel('Tennis skill rating').selectOption(snapshot.skill);
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByRole('status')).toContainText('Profile saved.');
}
