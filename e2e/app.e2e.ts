import { expect, test } from '@playwright/test';

test('unauthenticated visitor sees the login screen', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'daylog' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
});
