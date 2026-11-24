import { expect, test } from '@playwright/test';

/**
 * Phase 1 golden paths, driven through a real browser against the running API
 * and Next.js app.
 *
 * The flow is split in two on purpose: a freshly signed-up workspace has an
 * *unverified* email and the API deliberately refuses to start a session for it
 * (see `AuthService.assertCanSignIn`). So provisioning is covered on its own,
 * and the sign-in half uses the seeded, verified demo administrator.
 */
const DEMO_EMAIL = process.env.SEED_DEMO_EMAIL ?? 'admin@acme-demo.test';
const DEMO_PASSWORD = process.env.SEED_WORKSPACE_PASSWORD ?? 'Passw0rd!23';

test('provisions a workspace from signup, then signs out', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const email = `e2e-${stamp}@talentflow.test`;
  const password = 'Passw0rd!23';
  const company = `E2E Workspace ${stamp}`;

  // --- Sign up -------------------------------------------------------------
  await page.goto('/signup');

  await page.getByLabel('Company name').fill(company);
  await page.getByLabel('First name').fill('Edie');
  await page.getByLabel('Last name').fill('Endtoend');
  await page.getByLabel('Work email').fill(email);
  // `getByLabel('Password')` also matches the “Show password” reveal button, so
  // the field is addressed by its id.
  await page.locator('#password').fill(password);
  // Radix renders the checkbox as a button carrying the `id` from the form.
  await page.locator('#acceptedTerms').click();

  await page.getByRole('button', { name: 'Create workspace' }).click();

  // --- Workspace shell -----------------------------------------------------
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  // The account menu only renders once the session resolves for this tenant.
  const accountMenu = page.getByRole('button', { name: /Account menu for/ });
  await expect(accountMenu).toBeVisible();
  // The workspace name is shown verbatim in the sidebar's tenant switcher.
  await expect(page.getByText(company, { exact: true }).first()).toBeVisible();

  // --- Sign out ------------------------------------------------------------
  await accountMenu.click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('signs the seeded demo administrator in', async ({ page }) => {
  await page.goto('/login');

  await page.getByLabel('Work email').fill(DEMO_EMAIL);
  await page.locator('#password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Account menu for/ })).toBeVisible();
});
