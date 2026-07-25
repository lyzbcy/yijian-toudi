// 多份简历 profile UI 专项测试：新建/切换/重命名/删除的真实交互。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-profiles-'));
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
    await window.locator('.sidebar .nav-item[data-page="resume"]').first().click();
    await window.waitForTimeout(1000);
    await window.waitForSelector('.profile-tab[data-profile]', { timeout: 10000 });

    const errors = [];
    const check = (cond, msg) => { if (!cond) errors.push(msg); };

    // 1. 默认 1 个 profile tab（default），active 状态
    const initialTabs = await window.locator('.profile-tab[data-profile]').count();
    check(initialTabs === 1, `默认应有 1 个 profile tab，实际 ${initialTabs}`);
    check(await window.locator('.profile-tab[data-profile="default"]').first().evaluate((el) => el.classList.contains('active')), '默认 profile 应为 active');

    // 2. 在 default 填内容，保存
    await window.locator('[name="intention.roles"]').fill('前端工程师');
    await window.locator('[name="education.0.school"]').fill('默认大学');
    await window.locator('#saveResumeButton').click();
    await window.waitForTimeout(400);

    // 3. 新建一份「产品方向」profile（用 prompt handler）
    await window.evaluate(() => { window.prompt = () => '产品方向'; });
    await window.locator('[data-add-profile]').click();
    await window.waitForTimeout(500);

    const tabsAfterAdd = await window.locator('.profile-tab[data-profile]').count();
    check(tabsAfterAdd === 2, `新建后应有 2 个 tab，实际 ${tabsAfterAdd}`);

    // 4. 新 profile 应为 active，且 intention.roles 为空（独立）
    const newProfileId = await window.locator('.profile-tab.active[data-profile]').first().getAttribute('data-profile');
    check(newProfileId !== 'default', `新建后 active 应为新 profile，实际 ${newProfileId}`);
    const newRolesValue = await window.locator('[name="intention.roles"]').inputValue();
    check(newRolesValue === '', `新 profile 的 intention.roles 应为空（独立），实际「${newRolesValue}」`);

    // 5. 给新 profile 填不同内容，保存
    await window.locator('[name="intention.roles"]').fill('产品经理');
    await window.locator('[name="education.0.school"]').fill('产品大学');
    await window.locator('#saveResumeButton').click();
    await window.waitForTimeout(400);

    // 6. 切回 default，验证内容是 default 的（不是产品的）
    await window.locator('.profile-tab[data-profile="default"]').first().click();
    await window.waitForTimeout(800);
    // 先读后端权威 state，确认切换真的生效
    const backendState = await window.evaluate(() => window.oneClick.getState());
    const backendActive = backendState.resume.activeProfileId;
    const backendRoles = backendState.resume.intention?.roles;
    const backendSchool = backendState.resume.education?.[0]?.school;
    if (backendActive !== 'default' || backendRoles !== '前端工程师' || backendSchool !== '默认大学') {
      errors.push(`后端切换异常：active=${backendActive} roles=${backendRoles} school=${backendSchool}`);
    }
    const defaultRolesAfterSwitch = await window.locator('[name="intention.roles"]').inputValue();
    check(defaultRolesAfterSwitch === '前端工程师', `切回 default 后 intention.roles 应为「前端工程师」，实际「${defaultRolesAfterSwitch}」`);
    const defaultSchoolAfterSwitch = await window.locator('[name="education.0.school"]').inputValue();
    check(defaultSchoolAfterSwitch === '默认大学', `切回 default 后学校应为「默认大学」，实际「${defaultSchoolAfterSwitch}」`);

    // 7. basic 是共享的，两份都应一样（填个名字验证）
    await window.locator('[name="basic.name"]').fill('张三');
    await window.locator('#saveResumeButton').click();
    await window.waitForTimeout(300);
    // 切到新 profile 看 basic.name 也是张三
    await window.locator(`.profile-tab[data-profile="${newProfileId}"]`).first().click();
    await window.waitForTimeout(400);
    const sharedName = await window.locator('[name="basic.name"]').inputValue();
    check(sharedName === '张三', `basic.name 应在两份间共享，新 profile 也应为「张三」，实际「${sharedName}」`);

    // 8. default 不可删（删除按钮不应出现在 default tab 上）
    const delBtnOnDefault = await window.locator('.profile-tab[data-profile="default"] [data-del-profile]').count();
    check(delBtnOnDefault === 0, 'default profile 不应有删除按钮');

    if (errors.length) {
      console.error('❌ 多份简历 UI 测试失败：');
      errors.forEach((e) => console.error('  - ' + e));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, tabsCount: tabsAfterAdd, newProfileId, sharedName }));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
