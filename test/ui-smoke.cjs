const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-ui-'));
  const application = await electron.launch({
    args: [root, `--user-data-dir=${profile}`],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  try {
    const window = await application.firstWindow();
    await window.waitForSelector('.hero-card');
    // 首次启动无演示数据，应显示空状态而非岗位卡片
    await window.waitForSelector('#jobEmpty:not(.hidden)');
    const emptyText = await window.locator('#jobEmpty').textContent();
    if (!emptyText.includes('还没有岗位数据')) throw new Error(`空状态文案不正确：${emptyText}`);
    const title = await window.locator('#pageTitle').textContent();
    if (title !== '招聘项目') throw new Error(`首屏标题不正确：${title}`);
    await window.screenshot({ path: path.join(output, 'desktop-jobs.png'), fullPage: true });
    await window.locator('[data-page="resume"]').first().click();
    await window.waitForSelector('#resume-basic');
    const fields = await window.locator('#resumeForm [name]').count();
    if (fields < 30) throw new Error(`简历字段数量不足：${fields}`);
    await window.screenshot({ path: path.join(output, 'desktop-resume.png'), fullPage: true });
    await window.locator('[data-page="agent"]').first().click();
    await window.waitForSelector('#agentPrompt');
    if (!(await window.locator('#agentPrompt').textContent()).includes('/v1/jobs')) throw new Error('Agent Prompt 缺少 API');
    console.log(JSON.stringify({ ok: true, title, fields, screenshots: ['desktop-jobs.png', 'desktop-resume.png'] }));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
