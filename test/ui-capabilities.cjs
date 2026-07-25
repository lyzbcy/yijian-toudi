// 能力矩阵五维 UI 专项测试：验证两区展示 + 五维徽章 + capabilities 真实反映到前端。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-caps-ui-'));
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
      await window.waitForTimeout(400);
    }
    await window.locator('.sidebar .nav-item[data-page="connections"]').first().click();
    await window.waitForTimeout(700);
    await window.waitForSelector('#companyGridPrimary', { timeout: 10000 });

    const errors = [];
    const check = (cond, msg) => { if (!cond) errors.push(msg); };

    // 1. 主区应有 10 家（6 家 jobs=verified + 4 家 jobs=degraded: 网易/华润微/长电/SK海力士）
    const primaryCards = await window.locator('#companyGridPrimary .company-button').count();
    check(primaryCards === 10, `主区应有 10 家公司（6 verified + 4 degraded），实际 ${primaryCards}`);

    // 2. 腾讯卡片应有 5 个五维徽章，且 resume/apply 是 verified（绿）
    const tencentCard = window.locator('#companyGridPrimary .company-button[data-company="tencent"]');
    const tencentDots = await tencentCard.locator('.cap-dot').count();
    check(tencentDots === 5, `腾讯卡片应有 5 个能力徽章，实际 ${tencentDots}`);
    const tencentResumeClass = await tencentCard.locator('.cap-dot').nth(2).evaluate((el) => el.className);
    check(tencentResumeClass.includes('cap-verified'), `腾讯简历能力应为 verified(绿)，class=${tencentResumeClass}`);
    const tencentApplyClass = await tencentCard.locator('.cap-dot').nth(3).evaluate((el) => el.className);
    check(tencentApplyClass.includes('cap-verified'), `腾讯投递能力应为 verified(绿)，class=${tencentApplyClass}`);
    // 腾讯状态是 manual（黄）
    const tencentStatusClass = await tencentCard.locator('.cap-dot').nth(4).evaluate((el) => el.className);
    check(tencentStatusClass.includes('cap-manual'), `腾讯状态能力应为 manual(黄)，class=${tencentStatusClass}`);

    // 3. 百度简历/投递是 unsupported（灰）
    const baiduCard = window.locator('#companyGridPrimary .company-button[data-company="baidu"]');
    const baiduResumeClass = await baiduCard.locator('.cap-dot').nth(2).evaluate((el) => el.className);
    check(baiduResumeClass.includes('cap-unsupported'), `百度简历能力应为 unsupported(灰)，class=${baiduResumeClass}`);

    // 4. 腾讯有验证日期，百度也应有
    const tencentDate = await tencentCard.locator('.verified-date').first().textContent();
    check(/^\d{4}-\d{2}-\d{2}$/.test(tencentDate.trim()), `腾讯应有验证日期，实际「${tencentDate}」`);

    // 5. 次区「即将支持」应有 9 家（19 - 10）
    const soonText = await window.locator('#soonCount').textContent();
    check(soonText.includes('9'), `次区应有 9 家公司，实际「${soonText}」`);
    await window.locator('.company-section-soon summary').click();
    await window.waitForTimeout(300);
    const soonCards = await window.locator('#companyGridSoon .company-button').count();
    check(soonCards === 9, `次区展开后应有 9 家公司，实际 ${soonCards}`);

    // 6. 点击行为：jobs=verified 的走 openCompany（外部浏览器），degraded/unsupported 走嵌入式登录。
    //    测试环境不真实打开外部浏览器，仅验证 companyClickMode 逻辑在前端代码里正确（已由单元测试覆盖）。

    if (errors.length) {
      console.error('❌ 能力矩阵 UI 测试失败：');
      errors.forEach((e) => console.error('  - ' + e));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, primaryCards, soonCards, tencentDots }));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
