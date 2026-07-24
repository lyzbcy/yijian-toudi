// E2E 验证嵌入式登录：启动 app → 点需登录的公司 → 验证 WebContentsView 出现
const fs = require('node:fs');
const path = require('path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-login-'));
  const app = await electron.launch({
    args: [root, `--user-data-dir=${profile}`],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });

  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.hero-card');
    if (await win.locator('#onboardingDialog[open]').count() > 0) {
      await win.locator('.onboarding-choice[data-recruit="social"]').click();
      await win.waitForTimeout(500);
    }

    // 进入"公司与邮箱"页
    await win.locator('[data-page="connections"]').first().click();
    await win.waitForSelector('#companyGrid');

    // 找一个需登录的公司（如拼多多，adapterStatus: login-only/needed）
    // 点击它，触发嵌入式登录
    const pddButton = win.locator('.company-button', { hasText: '拼多多' });
    if (await pddButton.count() === 0) throw new Error('没找到拼多多公司卡片');
    await pddButton.click();
    await win.waitForTimeout(2000);

    // 验证登录控制条出现
    const loginBarVisible = await win.locator('#loginBar:not(.hidden)').count();
    console.log('登录控制条可见:', loginBarVisible > 0);

    // 通过 evaluate 检查主进程是否有 view（间接：检查 login:status IPC）
    const status = await win.evaluate(async () => await window.oneClick.loginStatus());
    console.log('登录状态:', JSON.stringify(status));
    if (!status.active) throw new Error('嵌入式登录视图未激活');

    console.log('✓ 嵌入式登录视图成功创建');

    // 关闭登录
    await win.locator('#loginBarDone').click();
    await win.waitForTimeout(500);
    const status2 = await win.evaluate(async () => await window.oneClick.loginStatus());
    console.log('关闭后状态:', JSON.stringify(status2));
    if (status2.active) throw new Error('关闭后视图仍在');
    console.log('✓ 登录视图正确关闭');

    console.log(JSON.stringify({ ok: true }));
  } finally {
    await app.close();
  }
})().catch((e) => {
  console.error('E2E 登录测试失败:', e.message);
  process.exit(1);
});
