// 社招简历页 URL 候选探测（人工实测脚本，不进 npm test）。
// 逐个打开候选 URL，报告最终跳转、输入框数量和页面摘要，用于校准 platform-manifests。
// 用法：node test/real-site-url-discovery.cjs
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const CANDIDATES = {
  xiaomi: [
    'https://xiaomi.jobs.f.mioffice.cn/user/profile',
    'https://xiaomi.jobs.f.mioffice.cn/user/profile/resume/edit',
    'https://xiaomi.jobs.f.mioffice.cn/user/resume',
    'https://xiaomi.jobs.f.mioffice.cn/index/talent/profile'
  ],
  meituan: [
    'https://zhaopin.meituan.com/web/personal-center/resume-detail?type=social&mode=edit',
    'https://zhaopin.meituan.com/web/personal-center/resume-detail?mode=edit',
    'https://zhaopin.meituan.com/web/personal/resume-edit',
    'https://zhaopin.meituan.com/web/personal-center'
  ],
  baidu: [
    'https://talent.baidu.com/applicants/center',
    'https://talent.baidu.com/applicants/resume/edit',
    'https://talent.baidu.com/applicants/resume'
  ],
  alibaba: [
    'https://talent.alibaba.com/personal/social-resume',
    'https://talent.alibaba.com/personal/center',
    'https://talent-holding.alibaba.com/social/home'
  ]
};

(async () => {
  const application = await electron.launch({
    args: [ROOT],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  try {
    await application.firstWindow();
    for (const [companyId, urls] of Object.entries(CANDIDATES)) {
      for (const url of urls) {
        const out = await application.evaluate(async ({ app }, { id, target }) => {
          const { createRequire } = process.getBuiltinModule('node:module');
          const mainRequire = createRequire(`${app.getAppPath()}/electron/main.cjs`);
          const loginManager = mainRequire('./login-manager.cjs');
          const res = { url: target };
          try {
            await loginManager.openWorkspace({ company: { id, name: id }, url: target, mode: 'resume-review', title: 'probe', context: null });
            await new Promise((resolve) => setTimeout(resolve, 8000));
            const info = await loginManager.run(`(() => ({
              url: location.href, title: document.title,
              inputs: document.querySelectorAll('input,textarea,select').length,
              body: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 120)
            }))()`);
            Object.assign(res, info);
          } catch (error) {
            res.error = error.message;
          } finally {
            try { await loginManager.closeWorkspaceIfOpen(); } catch {}
          }
          return res;
        }, { id: companyId, target: url });
        console.log(JSON.stringify(out));
      }
    }
  } finally {
    try { await application.close(); } catch {}
  }
})().catch((error) => { console.error(error); process.exit(1); });
