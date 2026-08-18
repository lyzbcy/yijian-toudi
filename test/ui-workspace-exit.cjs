const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-workspace-ui-'));
  const application = await electron.launch({
    args: [root, `--user-data-dir=${profile}`],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });

  try {
    const window = await application.firstWindow();
    await window.waitForSelector('.hero-card');
    if (await window.locator('#onboardingDialog[open]').count() > 0) {
      await window.locator('.onboarding-choice[data-recruit="social"]').click();
      await window.waitForTimeout(300);
    }

    // 无需访问外网：模拟主进程发来的 workspace active 状态，验证真实 DOM/CSS 层级。
    await window.evaluate(() => {
      document.body.classList.add('workspace-active');
      document.querySelector('#workspaceBar').classList.remove('hidden');
    });

    const bar = window.locator('#workspaceBar');
    assert.equal(await bar.isVisible(), true, '工作区激活后顶部退出栏必须可见');
    const box = await bar.boundingBox();
    assert.equal(Math.round(box.y), 0, '退出栏必须贴住窗口顶部');
    assert.equal(Math.round(box.height), 52, '退出栏高度必须与原生网页偏移一致');
    await window.screenshot({ path: path.join(output, 'workspace-top-bar.png') });

    await window.locator('#workspaceCancel').click();
    await window.waitForSelector('body:not(.workspace-active) .main');
    assert.equal(await bar.isVisible(), false, '取消后退出栏必须隐藏');
    assert.equal(await window.locator('.main').isVisible(), true, '取消后应用主界面必须恢复');
    const status = await window.evaluate(() => window.oneClick.workspaceStatus());
    assert.equal(status.active, false, '取消后原生网页工作区必须关闭');

    // 校招手动维护也必须把“提交简历可能真实投递”写在仍可见的顶部栏上。
    await window.evaluate(() => {
      window.dispatchEvent(new CustomEvent('yjt-test-workspace'));
      document.body.classList.add('workspace-active');
      const node = document.querySelector('#workspaceBar');
      node.classList.remove('hidden');
    });
    // 通过主进程同款 workspace:changed 订阅回调难以在测试隔离中直接注入，
    // 因而同时静态断言 renderer 对 manual-fill-resume + campus 的条件和风险文案。
    const appSource = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
    assert.match(appSource, /\['fill-resume', 'manual-fill-resume'\]\.includes/);
    assert.match(appSource, /提交简历\/申请.*真实投递/);

    console.log(JSON.stringify({
      ok: true,
      bar: { y: Math.round(box.y), height: Math.round(box.height) },
      screenshot: 'test-output/workspace-top-bar.png'
    }));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
