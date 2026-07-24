// 端到端验证：启动 app → 点"刷新全部岗位" → 等真实数据出现 → 截图
// 这是最接近用户明早体验的验证：空状态 → 点击 → 真实三厂岗位入库
const fs = require('node:fs');
const path = require('path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  // 全新 profile，确保首屏是空状态
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-e2e-'));

  const application = await electron.launch({
    args: [root, `--user-data-dir=${profile}`],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });

  try {
    const win = await application.firstWindow();
    await win.waitForSelector('.hero-card');
    // 首启 onboarding dialog，点"社招"
    if (await win.locator('#onboardingDialog[open]').count() > 0) {
      await win.locator('.onboarding-choice[data-recruit="social"]').click();
      await win.waitForTimeout(500);
    }

    // 1. 验证空状态
    await win.waitForSelector('#jobEmpty:not(.hidden)');
    const emptyText = await win.locator('#jobEmpty').textContent();
    if (!emptyText.includes('还没有岗位数据')) throw new Error('初始空状态不对');
    console.log('✓ 首屏空状态正确');
    await win.screenshot({ path: path.join(output, 'e2e-1-empty.png') });

    // 2. 点刷新按钮，等真实抓取（给 90 秒，三家要联网）
    console.log('点击刷新，等待三家抓取（最多 90s）...');
    await win.locator('#refreshJobsButton').click();
    await win.waitForSelector('.job-item', { timeout: 90000 });
    await win.waitForTimeout(2000); // 让渲染稳定

    // 3. 验证真实数据出现
    const jobCount = await win.locator('.job-item').count();
    if (jobCount === 0) throw new Error('刷新后仍无岗位');
    console.log(`✓ 刷新后出现 ${jobCount} 个岗位卡片`);

    // 4. 统计公司分布
    const companies = await win.locator('.job-item .job-main p').allTextContents();
    const dist = {};
    for (const c of companies) {
      const name = c.split('·')[0].trim();
      dist[name] = (dist[name] || 0) + 1;
    }
    console.log('✓ 公司分布:', JSON.stringify(dist));

    await win.screenshot({ path: path.join(output, 'e2e-2-refreshed.png'), fullPage: true });

    // 5. 检查任务记录
    await win.locator('[data-page="automation"]').first().click();
    await win.waitForTimeout(500);
    await win.screenshot({ path: path.join(output, 'e2e-3-tasks.png'), fullPage: true });
    const taskText = await win.locator('#taskList').textContent();
    if (!taskText.includes('已抓取')) throw new Error('任务记录未反映抓取结果');
    console.log('✓ 任务记录正确显示抓取结果');

    console.log(JSON.stringify({ ok: true, jobCount, dist }));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error('E2E 失败:', error.message);
  process.exit(1);
});
