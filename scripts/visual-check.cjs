// 视觉自查：启动 app，注入真实腾讯岗位，截取各页面用于美化审查
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-visual-'));

  // 把预制的带真实岗位的 state.json 放进临时 userData
  const seedState = path.join(process.env.HOME || '', '.local-yijian-screenshot', 'state.json');
  if (fs.existsSync(seedState)) {
    fs.copyFileSync(seedState, path.join(profile, 'state.json'));
  }

  const application = await electron.launch({
    args: [root, `--user-data-dir=${profile}`],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });

  try {
    const win = await application.firstWindow();
    await win.waitForSelector('.job-item', { timeout: 15000 });
    await win.waitForTimeout(800);

    // 岗位页（桌面端）
    await win.screenshot({ path: path.join(output, 'visual-jobs.png'), fullPage: true });

    // 点开一个岗位详情
    await win.locator('.job-item').first().click();
    await win.waitForSelector('#jobDialog[open]');
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(output, 'visual-job-detail.png') });
    await win.locator('#jobDialog .dialog-close').click();
    await win.waitForTimeout(300);

    // 简历页
    await win.locator('[data-page="resume"]').first().click();
    await win.waitForSelector('#resumeForm');
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(output, 'visual-resume.png'), fullPage: true });

    // 收件箱
    await win.locator('[data-page="inbox"]').first().click();
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(output, 'visual-inbox.png'), fullPage: true });

    // 自动化中心
    await win.locator('[data-page="automation"]').first().click();
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(output, 'visual-automation.png'), fullPage: true });

    console.log(JSON.stringify({ ok: true, shots: ['visual-jobs.png', 'visual-job-detail.png', 'visual-resume.png', 'visual-inbox.png', 'visual-automation.png'] }));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
