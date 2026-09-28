const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  const skipScreenshots = process.env.YIJIAN_SKIP_SCREENSHOT === '1';
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
    const workspaceControls = await window.locator('#workspaceBar [data-workspace-action]').count();
    if (workspaceControls < 2) throw new Error(`工作区控制按钮不足：${workspaceControls}`);
    const privacyText = await window.locator('#onboardingPrivacy').textContent();
    if (!privacyText.includes('保存在本机') || !privacyText.includes('最终投递')) {
      throw new Error(`首次隐私说明不完整：${privacyText}`);
    }
    const backupControls = await window.locator('#backupExportButton, #backupRestoreButton').count();
    if (backupControls !== 2) throw new Error(`备份恢复按钮数量不正确：${backupControls}`);
    // 首启会弹出 onboarding 选方向 dialog，点"社招"关掉它
    const onboarding = window.locator('#onboardingDialog[open]');
    if (await onboarding.count() > 0) {
      await window.locator('.onboarding-choice[data-recruit="social"]').click();
      await window.waitForTimeout(500);
    }
    // 首次启动无演示数据，应显示空状态而非岗位卡片
    await window.waitForSelector('#jobEmpty:not(.hidden)');
    const emptyText = await window.locator('#jobEmpty').textContent();
    if (!emptyText.includes('还没有岗位数据')) throw new Error(`空状态文案不正确：${emptyText}`);
    const title = await window.locator('#pageTitle').textContent();
    if (title !== '招聘项目') throw new Error(`首屏标题不正确：${title}`);
    if (!skipScreenshots) await window.screenshot({ path: path.join(output, 'desktop-jobs.png'), fullPage: true });
    await window.locator('[data-page="resume"]').first().click();
    await window.waitForSelector('#resume-basic');
    const fields = await window.locator('#resumeForm [name]').count();
    if (fields < 30) throw new Error(`简历字段数量不足：${fields}`);
    // 多段经历：默认每个 group 至少 1 段，且有「添加段」按钮
    const eduSegments = await window.locator('[data-repeat="education"] .repeatable-segment').count();
    if (eduSegments < 1) throw new Error(`教育经历应至少有 1 段，实际 ${eduSegments}`);
    const addBtns = await window.locator('[data-add-segment]').count();
    if (addBtns !== 5) throw new Error(`应有 5 个添加段按钮（教育/工作/项目/家庭/游戏），实际 ${addBtns}`);
    if (!skipScreenshots) await window.screenshot({ path: path.join(output, 'desktop-resume.png'), fullPage: true });
    await window.locator('[data-page="agent"]').first().click();
    await window.waitForSelector('#agentPrompt');
    const promptText = await window.locator('#agentPrompt').textContent();
    if (!promptText.includes('/v1/jobs')) throw new Error('Agent Prompt 缺少 API');
    const base = /Base URL: (http:\/\/127\.0\.0\.1:\d+)/.exec(promptText)?.[1];
    const token = /Authorization: Bearer (\S+)/.exec(promptText)?.[1];
    if (!base || !token) throw new Error('Agent API 地址或 Token 未渲染');
    const unauthorized = await fetch(`${base}/v1/status`);
    if (unauthorized.status !== 401) throw new Error(`Agent API 未鉴权：${unauthorized.status}`);
    const headers = { Authorization: `Bearer ${token}` };
    const apiStatus = await (await fetch(`${base}/v1/status`, { headers })).json();
    if (apiStatus.version !== require('../package.json').version) throw new Error(`打包应用版本不符：${apiStatus.version}`);
    const accounts = await (await fetch(`${base}/v1/boss/accounts`, { headers })).json();
    if (!accounts.accounts?.some((account) => account.id === 'default')) throw new Error('Boss 默认账号缺失');
    await window.locator('.agent-deploy-guide summary').click();
    const deployGuide = await window.locator('.agent-deploy-guide').textContent();
    if (!deployGuide.includes('SSH 反向隧道') || !deployGuide.includes('YJTD_TARGET=100')) {
      throw new Error('连接 AI Agent 页缺少 Skill 云端部署说明');
    }
    if (!skipScreenshots) await window.screenshot({ path: path.join(output, 'desktop-agent-skill.png'), fullPage: true });
    console.log(JSON.stringify({ ok: true, title, fields, apiVersion: apiStatus.version, accounts: accounts.accounts.length, screenshots: skipScreenshots ? [] : ['desktop-jobs.png', 'desktop-resume.png', 'desktop-agent-skill.png'] }));
  } finally {
    await application.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
