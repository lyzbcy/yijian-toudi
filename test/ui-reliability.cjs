const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-background-reliability-'));
  const seed = new JsonStore(profile); seed.init();
  seed.update(s => { s.settings.kimiBridgeEnabled = false; s.settings.autoCheckUpdates = false; s.settings.jobs.autoRefresh = false; s.settings.apiPort = 0; return s; });
  const application = await electron.launch({
    args: [root, `--user-data-dir=${profile}`],
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  const errors = [];
  const timings = [], started = Date.now();
  const progressFile = path.join(root, 'test-output/reliability-progress.json');
  fs.mkdirSync(path.dirname(progressFile), { recursive: true });
  function progress(iteration, step) {
    timings.push({ iteration, step, elapsedMs: Date.now() - started });
    fs.writeFileSync(progressFile, JSON.stringify({ version: require('../package.json').version, complete: false, timings }, null, 2));
  }
  try {
    const page = await application.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForSelector('.hero-card');
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(w => w.isVisible())), false);
    await page.locator('#onboardingDialog[open]').waitFor({state:'visible'});
    await page.locator('[data-recruit="social"]').click();
    await page.locator('#onboardingDialog[open]').waitFor({state:'hidden'});
    await page.locator('.sidebar [data-page="resume"]').click();
    // Only deletion confirmation is stubbed; creation uses the actual input dialog.
    await page.evaluate(() => { window.confirm = () => true; });
    for (let i = 0; i < 10; i++) {
      console.log(`profile reliability iteration ${i}: add/switch/delete`);
      progress(i, 'begin');
      const school = `未保存的学校-${i}`;
      await page.locator('[name="education.0.school"]').fill(school);
      // 新建前没有点击保存；操作必须自动保留原简历输入。
      await page.locator('[data-add-profile]').click();
      await page.locator('#textEntryDialog[open]').waitFor();
      await page.locator('#textEntryInput').fill('回归测试');
      await page.locator('#textEntryInput').press('Enter');
      await page.waitForFunction(() => document.querySelector('.profile-tab.active')?.dataset.profile !== 'default');
      const id = await page.locator('.profile-tab.active').getAttribute('data-profile');
      progress(i, 'created');
      await page.locator('[name="education.0.school"]').fill(`新方向-${i}`);
      await page.locator('[data-profile="default"] [data-rename-profile]').click();
      await page.waitForFunction((expected) => document.querySelector('.profile-tab.active')?.dataset.profile === 'default' && document.querySelector('[name="education.0.school"]').value === expected, school);
      progress(i, 'switched');
      // 删除另一个 profile 时，共享信息和当前未保存输入也需要保留。
      await page.locator('[name="basic.name"]').fill(`姓名-${i}`);
      await page.locator(`[data-del-profile="${id}"]`).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-profile]').length === 1);
      const state = await page.evaluate(() => window.oneClick.getState());
      assert.equal(state.resume.basic.name, `姓名-${i}`);
      assert.equal(state.resume.education[0].school, school);
      progress(i, 'deleted-and-verified');
    }
    await page.reload();
    await page.waitForSelector('.hero-card');
    const state = await page.evaluate(() => window.oneClick.getState());
    assert.equal(state.resume.education[0].school, '未保存的学校-9');
    const disk = JSON.parse(fs.readFileSync(path.join(profile, 'state.json'), 'utf8'));
    assert.equal(disk.resume.basic.name, '姓名-9');
    assert.equal(disk.resume.profiles.length, 1);
    assert.deepEqual(errors, []);
    const report={ok:true,version:require('../package.json').version,fixtureOnly:true,promptStubbed:false,deletionConfirmStubbed:true,loops:10,profileOperations:30,visibleWindows:0,pageErrors:0,persisted:true,elapsedMs:Date.now()-started,timings};
    fs.mkdirSync(path.join(root,'test-output'),{recursive:true});
    fs.writeFileSync(path.join(root,'test-output/reliability.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {
    await application.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
