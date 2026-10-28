import { test, expect } from '@playwright/test';

test('task edits persist after reload and undo restores the prior task', async ({ page }) => {
 await page.goto('/');
 await expect(page.getByText('Interactive local demo')).toBeVisible();
 await page.getByRole('navigation', { name: 'Workspace', exact: true }).getByRole('link', { name: /Plan/ }).click();
 await expect(page.getByRole('heading', { name: 'Every little step counts.' })).toBeVisible();
 await page.getByRole('button', { name: /^Check sound, lights & power points/ }).click();
 const dialog = page.getByRole('dialog');
 await dialog.getByLabel('Task title').fill('Check the stage microphones');
 await dialog.getByRole('button', { name: 'Save task' }).click();
 await expect(page.getByRole('button', { name: /^Check the stage microphones/ })).toBeVisible();
 await page.getByRole('button', { name: 'Undo', exact: true }).first().click();
 await expect(page.getByRole('button', { name: /^Check sound, lights & power points/ })).toBeVisible();
 await page.getByRole('button', { name: /^Check sound, lights & power points/ }).click();
 await page.getByRole('dialog').getByLabel('Task title').fill('Check the stage microphones');
 await page.getByRole('dialog').getByRole('button', { name: 'Save task' }).click();
 await page.reload();
 await expect(page.getByRole('button', { name: /^Check the stage microphones/ })).toBeVisible();
});

test('closing a keyboard-opened drawer restores focus to its opener', async ({ page }) => {
 await page.goto('/');
 const opener = page.getByRole('button', { name: 'Event details', exact: true });
 await opener.focus();
 await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog', { name: 'Event details' })).toBeVisible();
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
 await expect(opener).toBeFocused();
});
