// 真站简历页探测（人工实测脚本，不进 npm test）。
// 用真实 userData（含各公司 persist:<id> 登录分区）逐家打开社招简历页，
// 只探测登录态与表单识别情况，不写入任何字段。
// 用法：node test/real-site-resume-probe.cjs [companyId ...]
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const COMPANIES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['tencent', 'bytedance', 'alibaba', 'xiaomi', 'jd', 'meituan', 'baidu'];

(async () => {
  const application = await electron.launch({
    args: [ROOT],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  const report = [];
  try {
    await application.firstWindow();
    // 在主进程里直接复用 loginManager 工作区 + 表单探测脚本，只读不写。
    for (const companyId of COMPANIES) {
      const entry = await application.evaluate(async ({ app }, id) => {
        const { createRequire } = process.getBuiltinModule('node:module');
        const mainRequire = createRequire(`${app.getAppPath()}/electron/main.cjs`);
        const loginManager = mainRequire('./login-manager.cjs');
        // 页面跳转会孤儿化 executeJavaScript 的 Promise：所有 run 都加超时兜底
        const runWithTimeout = (script, ms) => Promise.race([
          loginManager.run(script),
          new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), ms))
        ]);
        const { PLATFORM_MANIFESTS, resolvePlatformUrl } = mainRequire('./platform-manifests.cjs');
        const { LOGIN_AND_FORM_PROBE, INSPECT_FORM_FIELDS } = mainRequire('./form-inspection.cjs');
        const manifest = PLATFORM_MANIFESTS[id];
        if (!manifest) return { companyId: id, error: 'no-manifest' };
        const url = resolvePlatformUrl(id, 'social', 'resume');
        const company = { id, name: id };
        const out = { companyId: id, url };
        try {
          await loginManager.openWorkspace({ company, url, mode: 'resume-review', title: `probe ${id}`, context: null });
          // SPA 慢加载：轮询最多 25 秒，直到出现表单或超时
          let probe = null;
          for (let i = 0; i < 25; i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            probe = await runWithTimeout(LOGIN_AND_FORM_PROBE, 9000);
            if (probe.loginRequired || (probe.inputCount && probe.inputCount > 2)) break;
          }
          out.loginRequired = Boolean(probe.loginRequired);
          out.isNotFound = Boolean(probe.isNotFound);
          out.inputCount = probe.inputCount ?? null;
          const pageInfo = await runWithTimeout(`(() => ({
            url: location.href, title: document.title,
            iframeCount: document.querySelectorAll('iframe').length,
            iframeInputCount: [...document.querySelectorAll('iframe')].reduce((sum, f) => {
              try { return sum + f.contentDocument.querySelectorAll('input,textarea,select').length; } catch (e) { return sum; }
            }, 0),
            bodySnippet: (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').slice(0, 160)
          }))()`);
          out.page = pageInfo;
          if (!out.loginRequired && (out.inputCount || pageInfo.iframeInputCount)) {
            const fields = await runWithTimeout(INSPECT_FORM_FIELDS, 9000);
            out.fields = (fields || []).slice(0, 200).map((f) => ({
              type: f.type, id: f.id || null, name: f.name || null,
              label: (f.label || '').slice(0, 40), value: (f.value || '').slice(0, 30)
            }));
            out.iframeFields = pageInfo.iframeInputCount;
          }
        } catch (error) {
          out.error = error.message;
        } finally {
          try { await loginManager.closeWorkspaceIfOpen(); } catch {}
        }
        return out;
      }, companyId);
      report.push(entry);
      console.log(JSON.stringify(entry, (key, value) => key === 'fields' ? `[${value.length} fields]` : value));
    }
  } finally {
    try { await application.close(); } catch {}
    fs.writeFileSync(path.join(__dirname, '..', 'test-output', 'real-site-probe.json'), JSON.stringify(report, null, 2));
  }
})().catch((error) => { console.error(error); process.exit(1); });
