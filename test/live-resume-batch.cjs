// Opt-in real-site smoke. Isolated, empty resume and no cookies; never submits.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');
(async () => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-resume-live-'));
  const store = new JsonStore(dir); store.init();
  store.update(s => { s.meta.onboardingSeen = true; s.settings.kimiBridgeEnabled = false;
    s.settings.autoCheckUpdates = false; s.settings.jobs.autoRefresh = false;
    s.settings.jobs.recruitType = 'campus';
    s.resume = { basic: {}, intention: {}, education: [], experience: [], projects: [], skills: '', activeProfileId: 'default', profiles: [] };
    return s; });
  const app = await electron.launch({ args: [root, `--user-data-dir=${dir}`],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
  const report = { at: new Date().toISOString(), isolated: true, emptyResume: true, bossAccessed: false,
    submitted: 0, targets: ['tencent:campus', 'baidu:campus', 'bytedance:campus', 'jd:campus'] };
  try {
    const page = await app.firstWindow(); await page.waitForSelector('.hero-card');
    await page.evaluate(targetIds => window.oneClick.resumeBatchStart({ targetIds, concurrency: 4 }), report.targets);
    const until = Date.now() + 100000;
    while (Date.now() < until) {
      report.batch = (await page.evaluate(() => window.oneClick.resumeBatchCatalog())).batch;
      if (report.batch.entries.every(e => !e.busy)) break;
      await new Promise(r => setTimeout(r, 1000));
    }
    report.pages = await app.evaluate(async ({ webContents }) => Promise.all(webContents.getAllWebContents()
      .filter(w => w.getURL().startsWith('https:')).map(async w => ({
        url: w.getURL(), title: w.getTitle(),
        text: await w.executeJavaScript('(document.body?.innerText || "").slice(0, 400)').catch(() => '')
      }))));
    report.completedChecks = report.batch.entries.every(e => !e.busy);
    await page.evaluate(() => window.oneClick.resumeBatchAction({ action: 'stop' }));
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && (await page.evaluate(() => window.oneClick.resumeBatchCatalog())).batch.active) await new Promise(r => setTimeout(r, 200));
    report.stopped = !(await page.evaluate(() => window.oneClick.resumeBatchCatalog())).batch.active;
    fs.writeFileSync(path.join(root, 'verification/2026-09-29-resume-batch/live.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (!report.completedChecks || !report.stopped) process.exitCode = 1;
  } finally { await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
