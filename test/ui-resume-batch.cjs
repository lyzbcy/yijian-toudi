const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');

async function poll(read) {
  const end = Date.now() + 45000;
  while (Date.now() < end) { if (await read()) return; await new Promise(r => setTimeout(r, 100)); }
  throw Error('batch UI condition timed out');
}
(async () => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-resume-batch-'));
  const store = new JsonStore(dir); store.init();
  const legacyAttachment = '旧版中文简历（样本）.pdf';
  fs.mkdirSync(path.join(dir, 'resumes'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'resumes', legacyAttachment), '%PDF-1.4\nlegacy attachment fixture\n%%EOF');
  store.update(s => { s.meta.onboardingSeen = true; s.settings.kimiBridgeEnabled = false;
    s.settings.autoCheckUpdates = false; s.settings.jobs.recruitType = 'campus';
    s.resume.basic.name = '离线测试姓名'; s.resume.basic.resumeFile = legacyAttachment; return s; });
  const app = await electron.launch({ args: [...(process.env.YJT_PACKAGED_EXECUTABLE ? [] : [root]), `--user-data-dir=${dir}`],
    executablePath: process.env.YJT_PACKAGED_EXECUTABLE || process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
  try {
    // In-memory HTTPS fixtures; production navigation allowlist, partitions,
    // native windows and generic fill/read-back engine remain real.
    await app.evaluate(({ app, session }) => {
      const req = process.getBuiltinModule('node:module').createRequire(`${app.getAppPath()}/electron/main.cjs`);
      const { REGISTRY } = req('./adapters/registry.cjs');
      const { createGenericResumeFill } = req('./adapters/generic-resume-fill.cjs');
      for (const a of REGISTRY.filter(a => a.fillResume)) {
        session.fromPartition(`persist:${a.id}`).protocol.handle('https', () => new Response(`<!doctype html><meta charset="utf-8"><style>body{font:18px system-ui;padding:24px;background:#fcfbf8}input{padding:12px;margin:16px;width:75%}</style><h2>${a.name} · 离线回归样本</h2><p>简历编辑（不连接招聘网站）</p><div class="brick-field field-56411.-name"><label class="brick-field-label-wrap" for="name">姓名</label><input id="name" name="name"></div><div class="brick-field field-56411.-email"><label class="brick-field-label-wrap" for="email">邮箱</label><input id="email" type="email"></div><button>保存样本</button>`, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
        const fill = createGenericResumeFill(a.id, a.name);
        a.fillResume = (resume, options) => {
          if (!options.attachmentPath?.endsWith('旧版中文简历（样本）.pdf')) throw Error('旧版附件未传入同步引擎');
          return fill(resume, options);
        };
      }
    });
    const page = await app.firstWindow();
    await page.waitForSelector('.hero-card');
    await page.locator('[data-page="resume"]').first().click();
    await page.locator('#fillResumeAllButton').click();
    await page.locator('#resumeBatchDialog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#resumeBatchStart').isDisabled(), true);
    await page.locator('#resumeBatchAll').check();
    const count = await page.locator('[data-resume-target]').count();
    assert.equal(count, 7);
    const ids = await page.locator('[data-resume-target]').evaluateAll(nodes => nodes.map(n => n.value));
    await page.locator('[data-resume-target]').last().uncheck();
    assert.equal(await page.locator('#resumeBatchAll').evaluate(e => e.indeterminate), true);
    await page.locator('#resumeBatchAll').check();
    fs.mkdirSync(path.join(root, 'test-output'), { recursive: true });
    await capture('resume-batch-picker.png');
    async function capture(name) {
      // Hidden packaged windows can stall CDP Page.captureScreenshot after native
      // views open. Electron's documented stayHidden capture wakes the compositor.
      const base64 = await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().startsWith('file:'));
        const png = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        return png.toPNG().toString('base64');
      });
      const bytes = Buffer.from(base64, 'base64');
      assert.ok(bytes.length > 500, 'native screenshot must contain image data');
      fs.writeFileSync(path.join(root, 'test-output', name), bytes);
    }
    for (const concurrency of [4, 6]) {
      await page.locator('#resumeBatchConcurrency').selectOption(String(concurrency));
      await page.locator('#resumeBatchStart').click();
      await poll(async () => {
        const { batch } = await page.evaluate(() => window.oneClick.resumeBatchCatalog());
        return batch.entries.filter(e => e.open && e.status === 'review-required').length === concurrency;
      });
      await page.waitForFunction(n => [...document.querySelectorAll('.resume-batch-result span')].filter(e => e.textContent === '等待核对').length === n, concurrency);
      const catalog = await page.evaluate(() => window.oneClick.resumeBatchCatalog());
      assert.equal(catalog.batch.entries.filter(e => e.status === 'queued').length, 7 - concurrency);
      assert.ok(catalog.targets.every(t => !t.history?.lastUpdatedAt));
      const views = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().startsWith('data:')).map(w => ({ bounds: w.getBounds(), children: w.contentView.children.length })));
      if (views.length !== concurrency) console.log(JSON.stringify({ views, catalog, windows: await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>({id:w.id,url:w.webContents.getURL()}))) }));
      assert.equal(views.length, concurrency); assert.ok(views.every(v => v.children >= 1));
      for (let i = 0; i < views.length; i++) for (let j = i + 1; j < views.length; j++) {
        const a = views[i].bounds, b = views[j].bounds;
        assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y);
      }
      const values = await app.evaluate(async ({ webContents }) => {
        const pages = webContents.getAllWebContents().filter(w => w.getURL().startsWith('https:'));
        return Promise.all(pages.map(w => w.executeJavaScript('({value:document.querySelector("#name").value, title:document.querySelector("h2").textContent})')));
      });
      assert.equal(values.length, concurrency); assert.ok(values.every(v => v.value === '离线测试姓名'));
      assert.equal(new Set(values.map(v => v.title)).size, concurrency);
      await capture(`resume-batch-${concurrency}.png`);
      await page.evaluate(id => window.oneClick.resumeBatchAction({ action: 'close', id }), ids[0]);
      await poll(async () => {
        const { batch } = await page.evaluate(() => window.oneClick.resumeBatchCatalog());
        return !batch.entries.find(e => e.id === ids[0]).open && batch.entries.filter(e => e.open && e.status === 'review-required').length === concurrency;
      });
      await page.evaluate(id => window.oneClick.resumeBatchAction({ action: 'confirm-saved', id }), ids[1]);
      await page.locator('#resumeBatchStop').click();
      await poll(async () => !(await page.evaluate(() => window.oneClick.resumeBatchCatalog())).batch.active);
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    }
    const persisted = await page.evaluate(() => window.oneClick.resumeBatchCatalog());
    assert.ok(persisted.targets.find(t => t.id === ids[1]).history.lastUserConfirmedAt);
    assert.ok(persisted.targets.every(t => !t.history?.lastUpdatedAt));
    assert.equal((await page.evaluate(() => window.oneClick.kimiStatus())).running, false);
    console.log(JSON.stringify({ ok: true, platformCount: count, concurrency: [4, 6],
      realNativeWindows: true, genericFieldReadback: true, queueAdvance: true,
      historyPersisted: true, falseSaved: 0, externalRequests: 0, offlineFixture: true }));
  } finally { await app.close(); }
  const persisted = new JsonStore(dir); persisted.init();
  assert.ok(Object.values(persisted.get().resumeSyncHistory).some(h => h.lastUserConfirmedAt));
})().catch(e => { console.error(e); process.exitCode = 1; });
