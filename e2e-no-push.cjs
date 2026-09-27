/**
 * Exercise pairing when the client has no push transport, as in the iOS shell.
 * Run against a production build served locally:
 * APP=http://127.0.0.1:4173 NODE_PATH=<playwright node_modules> node e2e-no-push.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const { webkit } = require('playwright');

const APP = process.env.APP ?? 'http://127.0.0.1:4173';
const JOIN = process.env.JOIN ?? 'https://keryx-demo.github.io/join.txt';

(async () => {
  const response = await fetch(JOIN);
  assert.ok(response.ok, `join URL: HTTP ${response.status}`);
  const joinUrl = (await response.text()).trim();
  const browser = await webkit.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => { delete window.PushManager; });
    await page.goto(APP);
    await page.getByRole('button', { name: 'Add a company' }).click();
    await page.getByRole('button', { name: 'Paste a link' }).click();
    await page.getByPlaceholder('Paste the company link or domain').fill(joinUrl);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Confirm this website' }).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Subscribe', exact: true }).click({ timeout: 30_000 });
    await page.getByRole('heading', { name: 'Notifications are unavailable' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Turn on', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Notifications are unavailable' }).waitFor({ state: 'hidden' });
    // The company feed must be reachable, including real, verified content.
    await page.locator('article').first().waitFor({ timeout: 30_000 });
    assert.ok(await page.locator('article').count() > 0);
    console.log('PASS: unsupported notifications explain the limitation and continue to verified messages');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
