import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.chan-tile:not(.skeleton), .channel-row').first()).toBeVisible({ timeout: 20_000 });
  return errors;
}

test('loads with header, on-air bar and channel tiles, and no page errors', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('.app-header')).toBeVisible();
  await expect(page.locator('.nowbar')).toBeVisible();
  expect(await page.locator('.chan-tile:not(.skeleton)').count()).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('page does not scroll sideways', async ({ page }) => {
  await open(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test('number keys switch tabs and every tab renders without errors', async ({ page }) => {
  const errors = await open(page);
  const names = ['Monitor', 'Trends', 'Scopes', 'Subscribers', 'Talkgroups', 'Topology', 'Alerts'];
  for (let i = 0; i < names.length; i += 1) {
    await page.keyboard.press(String(i + 1));
    await expect(page.locator('.tab-btn.btn-active')).toContainText(names[i], { timeout: 5000 });
  }
  expect(errors).toEqual([]);
});

// The point of fixed channel slots: a call starting or stopping must not move anything.
test('layout stays put while calls come and go', async ({ page }) => {
  await open(page);
  const samples = new Set<string>();
  for (let i = 0; i < 12; i += 1) {
    samples.add(
      await page.evaluate(() => {
        const grid = document.querySelector('.chan-grid')?.getBoundingClientRect();
        const below = document.querySelector('.split-grid')?.getBoundingClientRect();
        return `${Math.round(grid?.height ?? 0)}/${Math.round(below?.top ?? 0)}`;
      }),
    );
    await page.waitForTimeout(2000);
  }
  expect([...samples]).toHaveLength(1);
});

test('clicking a talkgroup opens the drawer and Escape closes it', async ({ page }) => {
  await open(page);
  const link = page.locator('.call-table .ent-link').first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  await link.click();
  await expect(page.locator('.drawer')).toBeVisible();
  await expect(page.locator('.drawer-id')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(page.locator('.drawer')).toHaveCount(0);
});

test('pinning a talkgroup and following narrows the call list', async ({ page }) => {
  await open(page);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const rows = page.locator('.call-table tbody tr');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  // Compare by talkgroup, not row count: new calls keep arriving while the test runs.
  // Hover first: that freezes the list, so the row we read is the row we pin.
  await rows.first().hover();
  const pinned = (await rows.first().locator('.tg-line .ent-link').first().innerText()).trim();
  await rows.first().locator('.pin-btn').click();
  await page.keyboard.press('f');
  await expect(page.getByRole('button', { name: /^Follow/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(rows.first()).toBeVisible();
  const names = await rows.locator('.tg-line .ent-link').allInnerTexts();
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names.map((n) => n.trim()))).toEqual(new Set([pinned]));
  await page.evaluate(() => localStorage.clear());
});

test('L and H switch between Live and History', async ({ page }) => {
  await open(page);
  await page.keyboard.press('h');
  await expect(page.locator('.range-bar .chip').first()).toBeVisible();
  await expect(page.locator('.nowbar')).toHaveCount(0);
  await page.keyboard.press('l');
  await expect(page.locator('.nowbar')).toBeVisible();
});

test('a list under the mouse holds still and releases on leave', async ({ page }) => {
  await open(page);
  const panel = page.locator('.call-table').first();
  await expect(panel).toBeVisible();
  await page.mouse.move(700, 700);
  await expect(page.locator('.badge.held')).toHaveCount(1);
  await page.mouse.move(5, 5);
  await expect(page.locator('.badge.held')).toHaveCount(0);
});

// Regression: the "N new" pill and the held state used to push rows down / reflow the header.
test('holding a list does not move its rows or reflow its header', async ({ page }) => {
  await open(page);
  const panel = page.locator('.glass-panel', { has: page.locator('h2', { hasText: 'Call History' }) }).first();
  const sample = () =>
    panel.evaluate((el) => {
      const row = el.querySelector('.call-table tbody tr')!.getBoundingClientRect();
      const head = el.querySelector('.panel-header')!.getBoundingClientRect();
      return `${Math.round(row.top)}/${Math.round(head.height)}`;
    });
  await page.mouse.move(5, 5);
  const seen = new Set([await sample()]);
  await page.mouse.move(700, 700);
  await expect(page.locator('.new-pill')).toBeVisible({ timeout: 45_000 }); // wait until a call arrives behind the hold
  for (let i = 0; i < 6; i += 1) {
    seen.add(await sample());
    await page.waitForTimeout(1000);
  }
  expect([...seen]).toHaveLength(1);
});

// The pill sits in the header, outside the list, so the hold must survive the trip up to it.
test('the "N new" pill can be reached and clicked, and releases the list', async ({ page }) => {
  await open(page);
  const panel = page.locator('.glass-panel', { has: page.locator('h2', { hasText: 'Call History' }) }).first();
  await page.mouse.move(700, 700);
  const pill = panel.locator('.new-pill');
  await expect(pill).toBeVisible({ timeout: 45_000 });
  await pill.hover(); // travels list -> header
  await page.waitForTimeout(800); // longer than the release grace period
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(pill).toHaveCount(0);
  await expect(panel.locator('.badge.held')).toHaveCount(0);
});
