import { expect, test } from '@playwright/test';

const authRoute = (path: string) => (url: URL) => url.pathname.endsWith(`/auth/v1/${path}`);
const json = (body: unknown, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

test.describe('authentication browser flows', () => {
  test('validates required signup fields and submits a pending account with supported ratings', async ({
    page,
  }) => {
    let signupRequest: Record<string, unknown> | undefined;
    await page.route(authRoute('signup'), async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      signupRequest = body;
      await route.fulfill(
        json({
          id: 'e2e-user',
          aud: 'authenticated',
          role: 'authenticated',
          email: 'new.member@example.test',
          app_metadata: { provider: 'email', providers: ['email'] },
          user_metadata: body.data,
          identities: [],
          created_at: '2026-10-22T00:00:00Z',
        }),
      );
    });

    await page.goto('/signup');
    await expect(page.getByRole('heading', { name: 'Create a member account' })).toBeVisible();
    const submit = page.getByRole('button', { name: 'Create account' });
    await submit.click();
    expect(
      await page
        .getByLabel('Full name')
        .evaluate((input: HTMLInputElement) => input.validity.valueMissing),
    ).toBe(true);
    expect(signupRequest).toBeUndefined();

    await page.getByLabel('Full name').fill('Taylor Member');
    await page.getByLabel(/Phone number/).fill('6045550188');
    await page.getByLabel(/Phone number/).blur();
    await page.getByLabel('Tennis skill rating').selectOption('4.0');
    await page.getByLabel('Email', { exact: true }).fill('new.member@example.test');
    await page.getByLabel('Password').fill('valid-test-password');
    await submit.click();

    await expect(page.getByRole('status')).toContainText('Account created. Check your email');
    expect(signupRequest).toMatchObject({
      email: 'new.member@example.test',
      password: 'valid-test-password',
      data: {
        full_name: 'Taylor Member',
        phone: '604.555.0188',
        tennis_skill_level: '4.0',
      },
    });
    expect(
      await page.getByLabel('Tennis skill rating').locator('option').allTextContents(),
    ).toEqual(expect.arrayContaining(['2.5', '3.0', '3.5', '4.0', '6.5', '7.0']));
  });

  test('does not reveal duplicate-account or invalid-login provider details', async ({ page }) => {
    await page.route(authRoute('signup'), async (route) =>
      route.fulfill(json({ code: 'user_already_exists', message: 'User already registered' }, 400)),
    );
    await page.goto('/signup');
    await page.getByLabel('Full name').fill('Existing Member');
    await page.getByLabel(/Phone number/).fill('6045550188');
    await page.getByLabel('Tennis skill rating').selectOption('3.5');
    await page.getByLabel('Email', { exact: true }).fill('existing@example.test');
    await page.getByLabel('Password').fill('valid-test-password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(
      'Could not create account. Please check your details and try again.',
    );
    await expect(page.locator('p[role="alert"]')).not.toContainText('already registered');

    await page.route(authRoute('token'), async (route) =>
      route.fulfill(
        json({ code: 'invalid_credentials', message: 'Invalid login credentials' }, 400),
      ),
    );
    await page.goto('/login');
    await page.getByLabel('Email', { exact: true }).fill('member@example.test');
    await page.getByLabel('Password').fill('incorrect-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(
      'Unable to sign in. Check your email and password and try again.',
    );
    await expect(page.locator('p[role="alert"]')).not.toContainText('Invalid login credentials');
  });

  test('submits valid credentials and honors a public next destination', async ({ page }) => {
    let tokenRequest: Record<string, unknown> | undefined;
    await page.route(authRoute('token'), async (route) => {
      tokenRequest = route.request().postDataJSON();
      await route.fulfill(
        json({
          access_token: 'e2e-access-token',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'e2e-refresh-token',
          user: {
            id: 'e2e-member',
            email: 'member@example.test',
            aud: 'authenticated',
            role: 'authenticated',
            app_metadata: { provider: 'email', providers: ['email'] },
            user_metadata: {},
            identities: [],
            created_at: '2026-10-22T00:00:00Z',
          },
        }),
      );
    });
    await page.route('**/rest/v1/rpc/record_client_audit_event', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    );
    await page.goto('/login?next=%2F');
    await page.getByLabel('Email', { exact: true }).fill('member@example.test');
    await page.getByLabel('Password').fill('valid-test-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/$/);
    expect(tokenRequest).toMatchObject({
      email: 'member@example.test',
      password: 'valid-test-password',
    });
    await expect(page.getByRole('heading', { name: 'Latest news' })).toBeVisible();
  });

  test('reset requests use an account-neutral response and protected pages redirect signed-out users', async ({
    page,
  }) => {
    await page.route(authRoute('recover'), async (route) => route.fulfill(json({})));
    await page.goto('/forgot-password');
    await page.getByLabel('Email', { exact: true }).fill('unknown@example.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText(
      'If an account exists for that address, a password-reset email has been sent.',
    );

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard|\/login\?next=\/dashboard/);
    await expect(page.getByRole('heading', { name: 'Member sign in' })).toBeVisible();

    await page.goto('/admin/dashboard');
    await expect(page).toHaveURL(
      /\/login\?next=%2Fadmin%2Fdashboard|\/login\?next=\/admin\/dashboard/,
    );
    await expect(page.getByRole('heading', { name: 'Member sign in' })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
