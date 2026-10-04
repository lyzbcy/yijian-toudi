const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-boss-recovery-'));
  const store = new JsonStore(dir); store.init();
  store.update((s) => {
    s.meta.onboardingSeen = true;
    s.settings.kimiBridgeEnabled = false;
    s.settings.autoCheckUpdates = false;
    s.bossBatchRun = { id: 'fixture-run', accountId: 'default', phase: 'running', applied: [],
      pending: { title: '前端开发实习生', company: '离线样本公司', attemptId: 'fixture-attempt' } };
    return s;
  });
  const app = await electron.launch({ args: [root, `--user-data-dir=${dir}`],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.hero-card');
    await page.locator('[data-page="settings"]').first().click();
    await page.waitForFunction(() => document.querySelector('#bossBatchStartButton').disabled);
    assert.equal(await page.locator('#bossBatchDryRunButton').isDisabled(), true);
    assert.equal(await page.locator('#bossBatchResolveButton').isVisible(), true);
    assert.equal(await page.locator('#bossBatchResolveButton').evaluate((e) => getComputedStyle(e).whiteSpace), 'nowrap');
    const rejected = await page.evaluate(() => window.oneClick.bossBatchStart({ target: 1 }));
    assert.equal(rejected.error, 'review-required');
    fs.mkdirSync(path.join(root, 'test-output'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'test-output/boss-recovery-before.png'), fullPage: true });
    await page.evaluate(() => { window.confirm = () => true; });
    await page.locator('#bossBatchResolveButton').click();
    await page.waitForFunction(() => !document.querySelector('#bossBatchStartButton').disabled);
    const status = await page.evaluate(() => window.oneClick.bossBatchStatus());
    assert.equal(status.running, false);
    assert.equal(status.requiresReview, false);
    assert.equal(status.applied.length, 0);
    const state = await page.evaluate(() => window.oneClick.getState());
    assert.ok(state.accounts[0].boss.heldCompanies.includes('离线样本公司'));
    assert.equal((await page.evaluate(() => window.oneClick.kimiStatus())).running, false);
    await page.screenshot({ path: path.join(root, 'test-output/boss-recovery-after.png'), fullPage: true });
    console.log(JSON.stringify({ ok: true, blockedBeforeReview: true, skippedUnknown: true,
      applied: 0, bridgeStarted: false, offlineFixture: true }));
  } finally { await app.close(); }
  const persisted = new JsonStore(dir); persisted.init();
  assert.equal(persisted.get().bossBatchRun.phase, 'reviewed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
