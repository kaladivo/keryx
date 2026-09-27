/**
 * Signed-content regressions in WebKit. Build bin/pub and app, then serve app:
 * APP=http://127.0.0.1:4173 NODE_PATH=<playwright node_modules> node e2e-content.cjs
 * Creates its own temporary publisher and keys; never touches a deployed repo.
 */
'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { webkit } = require('playwright');

const APP = process.env.APP ?? 'http://127.0.0.1:4173';
const PUB = process.env.PUB ?? path.join(__dirname, 'bin/pub');
const ORIGIN = 'https://content.keryx.test';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keryx-content-'));
const workspace = path.join(root, 'publisher');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ioAAAAASUVORK5CYII=', 'base64');
const sha = createHash('sha256').update(png).digest('hex');
const pub = (...args) => execFileSync(PUB, ['--workspace', workspace, '--keystore', path.join(root, 'keys'), ...args], { encoding: 'utf8' });

function publish(version) {
  const image = `${ORIGIN}/images/${version}.png`;
  const draft = path.join(root, 'item.json');
  fs.writeFileSync(draft, JSON.stringify({
    id: 'content', title: `Content ${version}`, date_published: new Date().toISOString(),
    image, image_sha256: sha,
    content_html: `<p>Signed text ${version}</p><img src="${image}" alt="remote"><img src="${ORIGIN}/images/bad-${version}.png" alt="bad"><img src="data:image/png;base64,${png.toString('base64')}" alt="inline"><form><input placeholder="FORBIDDEN"></form><script>window.pwned=true</script>`,
    attachments: [{ url: `${ORIGIN}/images/bad-${version}.png`, mime_type: 'image/png', sha256: '0'.repeat(64) }],
  }));
  pub('item', 'sign', '--channel', 'updates', '--file', draft);
  pub('publish', '--channel', 'updates', '--file', draft);
}

(async () => {
  let browser;
  try {
    pub('init', '--domain', ORIGIN, '--base', `${ORIGIN}/keryx`, '--name', 'Content QA');
    pub('channel', 'add', 'updates', '--display-name', 'Updates', '--generate-keys');
    publish(1);
    const join = pub('join-url', '--channels', 'updates').trim();
    browser = await webkit.launch();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      delete window.PushManager;
      delete Navigator.prototype.serviceWorker;
    });
    const images = [];
    let offline = false;
    let holdTimestamp = null;
    function pauseNextSync() {
      let started;
      let release;
      const reached = new Promise(resolve => { started = resolve; });
      const resume = new Promise(resolve => { release = resolve; });
      holdTimestamp = { started, resume };
      return { reached, release };
    }
    await context.route(`${ORIGIN}/**`, async route => {
      if (offline) return route.abort('internetdisconnected');
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (holdTimestamp && pathname === '/keryx/timestamp.json') {
        const hold = holdTimestamp;
        holdTimestamp = null;
        hold.started();
        await hold.resume;
      }
      const headers = { 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
      if (pathname.startsWith('/images/')) {
        images.push({ pathname, type: request.resourceType() });
        return route.fulfill({ body: png, contentType: 'image/png', headers });
      }
      let file;
      if (pathname.startsWith('/.well-known/keryx/')) file = path.join(workspace, 'anchor', pathname.slice('/.well-known/keryx/'.length));
      else if (pathname.startsWith('/keryx/')) file = path.join(workspace, 'repo', pathname.slice('/keryx/'.length));
      if (!file || !fs.existsSync(file)) return route.fulfill({ status: 404, headers });
      return route.fulfill({ body: fs.readFileSync(file), contentType: 'application/json', headers });
    });
    await page.goto(APP);
    await page.getByRole('button', { name: 'Add a company' }).click();
    await page.getByRole('button', { name: 'Paste a link' }).click();
    await page.getByPlaceholder('Paste the company link or domain').fill(join);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Confirm this website' }).waitFor();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Subscribe', exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('heading', { name: 'Content 1', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('img[alt="remote"]')?.getAttribute('src')?.startsWith('blob:'));
    assert.equal(await page.locator('img[alt="bad"]').getAttribute('src'), null);
    assert.ok((await page.locator('img[alt="inline"]').getAttribute('src')).startsWith('data:'));
    assert.equal(await page.getByPlaceholder('FORBIDDEN').count(), 0);
    assert.equal(await page.evaluate(() => window.pwned), undefined);
    assert.ok(images.length >= 2);
    assert.ok(images.every(request => request.type === 'fetch'), 'remote images must be fetched for verification before rendering');
    console.log('PASS: sanitization, inline image, verified media, mismatched media withheld');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Load images from the web', exact: true }).click();
    await page.getByRole('button', { name: 'Images off (privacy)', exact: true }).waitFor();
    await page.locator('.sheet-backdrop').click({ position: { x: 2, y: 2 } });
    publish(2);
    images.length = 0;
    await page.reload();
    await page.getByRole('heading', { name: 'Content 2', exact: true }).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(images, [], 'privacy preference must prevent every remote image request after reload');
    assert.equal(await page.locator('.article-img').count(), 0);
    assert.equal(await page.locator('img[alt="remote"]').getAttribute('src'), null);
    console.log('PASS: sync on launch without push; persisted privacy prevents hero and inline image requests');

    publish(3);
    // Dispatch the native WebView lifecycle event with the document visible.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.getByRole('heading', { name: 'Content 3', exact: true }).waitFor();
    assert.deepEqual(images, []);
    console.log('PASS: sync when returning to the foreground without push');

    offline = true;
    await page.reload();
    await page.getByRole('heading', { name: 'Content 3', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    assert.equal(await page.getByRole('heading', { name: 'Content 3', exact: true }).count(), 1);
    offline = false;
    publish(4);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('heading', { name: 'Content 4', exact: true }).waitFor();
    console.log('PASS: cached verified content survives offline; manual refresh recovers');

    publish(5);
    const target = path.join(workspace, 'repo/channels/updates/content.json');
    const signed = fs.readFileSync(target);
    const tampered = JSON.parse(signed);
    tampered.title = 'TAMPERED MUST NEVER APPEAR';
    fs.writeFileSync(target, JSON.stringify(tampered));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('heading', { name: 'Content 4', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByText('TAMPERED MUST NEVER APPEAR', { exact: true }).count(), 0);
    offline = true;
    await page.reload();
    await page.getByText('No messages yet', { exact: true }).waitFor();
    assert.equal(await page.locator('article').count(), 0, 'rejected cached copy must stay deleted after restart');
    offline = false;
    fs.writeFileSync(target, signed);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('heading', { name: 'Content 5', exact: true }).waitFor();
    console.log('PASS: a rejected replacement drops the old item from display and persistent cache; valid content recovers');

    publish(6);
    const validSix = fs.readFileSync(target);
    fs.writeFileSync(target, Buffer.alloc(2 * 1024 * 1024, 120));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByText('No messages yet', { exact: true }).waitFor();
    assert.equal(await page.locator('article').count(), 0, 'oversized replacements must also delete the previous item');
    fs.writeFileSync(target, validSix);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('heading', { name: 'Content 6', exact: true }).waitFor();
    console.log('PASS: oversized replacement is rejected and the old cached item is removed');

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Images off (privacy)', exact: true }).click();
    await page.getByRole('button', { name: 'Load images from the web', exact: true }).waitFor();
    await page.locator('.sheet-backdrop').click({ position: { x: 2, y: 2 } });
    publish(7);
    const privacySync = pauseNextSync();
    await page.reload();
    await privacySync.reached;
    await page.getByRole('heading', { name: 'Content 6', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Load images from the web', exact: true }).click();
    await page.getByRole('button', { name: 'Images off (privacy)', exact: true }).waitFor();
    privacySync.release();
    await page.locator('.spin').waitFor({ state: 'hidden' });
    assert.equal(await page.getByRole('button', { name: 'Images off (privacy)', exact: true }).count(), 1);
    await page.locator('.sheet-backdrop').click({ position: { x: 2, y: 2 } });
    images.length = 0;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('heading', { name: 'Content 7', exact: true }).waitFor();
    assert.deepEqual(images, []);
    console.log('PASS: slow startup sync cannot overwrite a privacy change; a fresh sync respects it');

    publish(8);
    const removalSync = pauseNextSync();
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await removalSync.reached;
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Remove company', exact: true }).click();
    await page.getByRole('button', { name: 'Add a company', exact: true }).waitFor();
    removalSync.release();
    await page.waitForLoadState('networkidle');
    await page.reload();
    await page.getByRole('button', { name: 'Add a company', exact: true }).waitFor();
    assert.equal(await page.locator('article').count(), 0);
    console.log('PASS: finishing background sync cannot resurrect a removed company');
    assert.deepEqual(errors, [], 'no uncaught page errors');
  } finally {
    await browser?.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
