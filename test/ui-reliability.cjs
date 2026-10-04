const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-background-reliability-'));
  const application = await electron.launch({
    args: [root, `--user-data-dir=${profile}`],
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  const errors = [];
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
    await page.evaluate(() => { window.prompt = () => '回归测试'; window.confirm = () => true; });
    for (let i = 0; i < 10; i++) {
      console.log(`profile reliability iteration ${i}: add/switch/delete`);
      const school = `未保存的学校-${i}`;
      await page.locator('[name="education.0.school"]').fill(school);
      // 新建前没有点击保存；操作必须自动保留原简历输入。
      await page.locator('[data-add-profile]').click();
      await page.waitForFunction(() => document.querySelector('.profile-tab.active')?.dataset.profile !== 'default');
      const id = await page.locator('.profile-tab.active').getAttribute('data-profile');
      await page.locator('[name="education.0.school"]').fill(`新方向-${i}`);
      await page.locator('[data-profile="default"] [data-rename-profile]').click();
      await page.waitForFunction((expected) => document.querySelector('.profile-tab.active')?.dataset.profile === 'default' && document.querySelector('[name="education.0.school"]').value === expected, school);
      // 删除另一个 profile 时，共享信息和当前未保存输入也需要保留。
      await page.locator('[name="basic.name"]').fill(`姓名-${i}`);
      await page.locator(`[data-del-profile="${id}"]`).click();
      await page.waitForFunction(() => document.querySelectorAll('[data-profile]').length === 1);
      const state = await page.evaluate(() => window.oneClick.getState());
      assert.equal(state.resume.basic.name, `姓名-${i}`);
      assert.equal(state.resume.education[0].school, school);
    }
    await page.reload();
    await page.waitForSelector('.hero-card');
    const state = await page.evaluate(() => window.oneClick.getState());
    assert.equal(state.resume.education[0].school, '未保存的学校-9');
    const disk = JSON.parse(fs.readFileSync(path.join(profile, 'state.json'), 'utf8'));
    assert.equal(disk.resume.basic.name, '姓名-9');
    assert.equal(disk.resume.profiles.length, 1);
    assert.deepEqual(errors, []);
    const report={ok:true,version:require('../package.json').version,fixtureOnly:true,loops:10,profileOperations:30,visibleWindows:0,pageErrors:0,persisted:true};
    fs.mkdirSync(path.join(root,'test-output'),{recursive:true});
    fs.writeFileSync(path.join(root,'test-output/reliability.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {
    await application.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
