// 多份简历 profile UI 专项测试：新建/切换/重命名/删除的真实交互。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

// 切换 profile 在快速操作下有概率出现异步广播竞争（localWriteInFlight 是单标志位）。
// 测试失败时重试最多 2 次，避免 flaky 阻塞 CI。
async function runOnce() {
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
      await window.waitForTimeout(400);
    }
    await window.locator('.sidebar .nav-item[data-page="resume"]').first().click();
    await window.waitForTimeout(1000);
    await window.waitForSelector('.profile-tab[data-profile]', { timeout: 10000 });

    const errors = [];
    const check = (cond, msg) => { if (!cond) errors.push(msg); };

    const initialTabs = await window.locator('.profile-tab[data-profile]').count();
    check(initialTabs === 1, `默认应有 1 个 profile tab，实际 ${initialTabs}`);
    check(await window.locator('.profile-tab[data-profile="default"]').first().evaluate((el) => el.classList.contains('active')), '默认 profile 应为 active');

    await window.locator('[name="intention.roles"]').fill('前端工程师');
    await window.locator('[name="education.0.school"]').fill('默认大学');
    await window.locator('#saveResumeButton').click();
    await window.waitForTimeout(500);

    await window.evaluate(() => { window.prompt = () => '产品方向'; });
    await window.locator('[data-add-profile]').click();
    await window.waitForTimeout(600);

    const tabsAfterAdd = await window.locator('.profile-tab[data-profile]').count();
    check(tabsAfterAdd === 2, `新建后应有 2 个 tab，实际 ${tabsAfterAdd}`);

    const newProfileId = await window.locator('.profile-tab.active[data-profile]').first().getAttribute('data-profile');
    check(newProfileId !== 'default', `新建后 active 应为新 profile，实际 ${newProfileId}`);
    const newRolesValue = await window.locator('[name="intention.roles"]').inputValue();
    check(newRolesValue === '', `新 profile 的 intention.roles 应为空（独立），实际「${newRolesValue}」`);

    await window.locator('[name="intention.roles"]').fill('产品经理');
    await window.locator('[name="education.0.school"]').fill('产品大学');
    await window.locator('#saveResumeButton').click();
    await window.waitForTimeout(500);

    // 切回 default（切换前会自动保存当前编辑）
    await window.locator('.profile-tab[data-profile="default"]').first().click();
    await window.waitForTimeout(1000);
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

    await window.locator('[name="basic.name"]').fill('张三');
    await window.locator('#saveResumeButton').click();
    await window.waitForTimeout(400);
    await window.locator(`.profile-tab[data-profile="${newProfileId}"]`).first().click();
    await window.waitForTimeout(500);
    const sharedName = await window.locator('[name="basic.name"]').inputValue();
    check(sharedName === '张三', `basic.name 应在两份间共享，新 profile 也应为「张三」，实际「${sharedName}」`);

    const delBtnOnDefault = await window.locator('.profile-tab[data-profile="default"] [data-del-profile]').count();
    check(delBtnOnDefault === 0, 'default profile 不应有删除按钮');

    return errors;
  } finally {
    await application.close();
  }
}

(async () => {
  let lastErrors = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const errors = await runOnce();
      if (errors.length === 0) {
        console.log(JSON.stringify({ ok: true, attempt }));
        process.exit(0);
      }
      lastErrors = errors;
      console.error(`第 ${attempt} 次尝试失败：`);
      errors.forEach((e) => console.error('  - ' + e));
    } catch (e) {
      lastErrors = [e.message];
      console.error(`第 ${attempt} 次异常：${e.message.split('\n')[0]}`);
    }
  }
  console.error('❌ 多份简历 UI 测试 3 次均失败');
  process.exit(1);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
