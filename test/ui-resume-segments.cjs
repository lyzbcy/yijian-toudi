// 多段简历经历 UI 专项测试：验证增删段、段数警告、保存持久化。
// 用 playwright-core 驱动 Electron，对真实渲染的 DOM 做断言（比看截图更可复现）。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-resume-'));
  const application = await electron.launch({
    args: [root, `--user-data-dir=${profile}`],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  try {
    const window = await application.firstWindow();
    await window.waitForSelector('.hero-card');
    // 关掉首启 onboarding
    if (await window.locator('#onboardingDialog[open]').count() > 0) {
      await window.locator('.onboarding-choice[data-recruit="social"]').click();
      await window.waitForTimeout(300);
    }
    // 进简历页：点 sidebar 里的简历导航项（用 nav 容器限定，避免匹配到别处的 data-page 链接）
    await window.locator('.sidebar .nav-item[data-page="resume"]').first().click();
    await window.waitForTimeout(500);
    // 验证切页成功
    const activePage = await window.locator('.page.active').first();
    await window.waitForTimeout(200);
    const pageId = await activePage.getAttribute('id');
    if (pageId !== 'page-resume') {
      // 兜底：再点一次（有时 onboarding 关闭动画抢了焦点）
      await window.locator('.sidebar .nav-item[data-page="resume"]').first().click();
      await window.waitForTimeout(500);
    }

    const errors = [];
    const check = (cond, msg) => { if (!cond) errors.push(msg); };

    // 1. 默认 3 个 section，每个 1 段
    check(await window.locator('[data-repeat="education"] .repeatable-segment').count() === 1, `教育经历默认应为 1 段，实际 ${await window.locator('[data-repeat="education"] .repeatable-segment').count()}`);
    check(await window.locator('[data-repeat="experience"] .repeatable-segment').count() === 1, '工作经历默认应为 1 段');
    check(await window.locator('[data-repeat="projects"] .repeatable-segment').count() === 1, '项目经历默认应为 1 段');
    // 1b. 每段都有段标题（教育经历 1 / 工作经历 1 / 项目经历 1）
    const eduTitle = await window.locator('[data-repeat="education"] .segment-head strong').first().textContent();
    check(eduTitle === '教育经历 1', `教育经历段标题应为「教育经历 1」，实际「${eduTitle}」`);
    const expTitle = await window.locator('[data-repeat="experience"] .segment-head strong').first().textContent();
    check(expTitle === '工作经历 1', `工作经历段标题应为「工作经历 1」，实际「${expTitle}」`);
    const projTitle = await window.locator('[data-repeat="projects"] .segment-head strong').first().textContent();
    check(projTitle === '项目经历 1', `项目经历段标题应为「项目经历 1」，实际「${projTitle}」`);

    // 2. 添加段按钮存在
    check(await window.locator('[data-add-segment="education"]').count() === 1, '应有「添加教育经历」按钮');
    check(await window.locator('[data-add-segment="experience"]').count() === 1, '应有「添加工作经历」按钮');
    check(await window.locator('[data-add-segment="projects"]').count() === 1, '应有「添加项目经历」按钮');

    // 3. 点「添加一段教育经历」5 次 → 6 段，第 6 段应出现警告
    for (let i = 0; i < 5; i++) {
      await window.locator('[data-add-segment="education"]').click();
      await window.waitForTimeout(150);
    }
    const eduCount = await window.locator('[data-repeat="education"] .repeatable-segment').count();
    check(eduCount === 6, `添加 5 次后教育经历应有 6 段，实际 ${eduCount}`);
    const warnCount = await window.locator('[data-repeat="education"] .segment-warn').count();
    check(warnCount >= 1, `第 6 段及以后应有警告提示，实际警告数 ${warnCount}`);

    // 4. 删除第 2 段（index=1）→ 应变成 5 段
    await window.locator('[data-remove-segment="education"][data-index="1"]').click();
    // 删除非空段会弹 confirm，但这里段都是空的（没填内容），不应弹窗；若弹了 Playwright 会卡住
    await window.waitForTimeout(200);
    const eduCountAfterRemove = await window.locator('[data-repeat="education"] .repeatable-segment').count();
    check(eduCountAfterRemove === 5, `删除一段后应有 5 段，实际 ${eduCountAfterRemove}`);

    // 5. 给第 1 段的学校填值，保存，重开验证持久化
    await window.locator('[name="education.0.school"]').fill('测试大学');
    await window.locator('[name="education.0.major"]').fill('计算机科学');
    await window.locator('#saveResumeButton').click();
    await window.waitForTimeout(500);

    // 重新读 state 验证 profile 写入
    const stateAfterSave = await window.evaluate(() => window.oneClick.getState());
    const activeProfile = stateAfterSave.resume.profiles.find((p) => p.id === stateAfterSave.resume.activeProfileId);
    check(activeProfile.education.some((e) => e.school === '测试大学'), '保存后 active profile 的教育经历应包含「测试大学」');
    check(stateAfterSave.resume.education[0].school === '测试大学', '兼容视图顶层 education[0].school 应为「测试大学」');

    // 6. 截图存档（人工复核用）
    await window.locator('#resume-education').scrollIntoViewIfNeeded();
    await window.waitForTimeout(200);
    await window.screenshot({ path: path.join(output, 'resume-segments.png'), fullPage: false });

    if (errors.length) {
      console.error('❌ 多段简历 UI 测试失败：');
      errors.forEach((e) => console.error('  - ' + e));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, eduCount: eduCountAfterRemove, warnCount, school: '测试大学' }));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
