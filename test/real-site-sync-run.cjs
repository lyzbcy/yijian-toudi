// 真站一键更新全流程实测（人工实测脚本，不进 npm test）。
// 用真实 userData 启动应用，通过 UI 点击「一键更新」，逐家记录真实结果，
// 需要人工核对/登录时点顶部「完成核对」继续下一家。
// 用法：node test/real-site-sync-run.cjs [最多停留站点数，默认 8]
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const MAX_STOPS = Number(process.argv[2] || 8);

const withTimeout = (promise, timeout, description) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout: ${description}`)), timeout))
]);

(async () => {
  const application = await electron.launch({
    args: [ROOT],
    executablePath: process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  const report = { stops: [] };
  try {
    // 观察真实编排阶段
    await withTimeout(application.evaluate(({ app }) => {
      const { createRequire } = process.getBuiltinModule('node:module');
      const mainRequire = createRequire(`${app.getAppPath()}/electron/main.cjs`);
      const { ResumeSyncSession } = mainRequire('./resume-sync.cjs');
      const original = ResumeSyncSession.prototype.acceptStage;
      globalThis.__yjtStages = [];
      ResumeSyncSession.prototype.acceptStage = function observed(stage = {}) {
        globalThis.__yjtStages.push({
          status: stage.status ?? null,
          currentCompanyId: stage.currentCompanyId ?? null,
          nextCompanyId: stage.nextCompanyId ?? null,
          atEnd: Boolean(stage.atEnd)
        });
        return original.call(this, stage);
      };
    }), 5000, 'stage observation');

    const window = await application.firstWindow();
    await window.waitForSelector('.hero-card', { timeout: 20000 });
    // 切到简历页并点「一键更新」启动本轮同步
    await window.locator('[data-page="resume"]').first().click();
    await window.locator('#fillResumeAllButton').click();
    // 轮询确认同步已启动（workspace 打开即认为启动）
    await withTimeout(
      (async () => {
        for (;;) {
          const status = await window.evaluate(() => window.oneClick.workspaceStatus());
          if (status.active) return status;
          await new Promise((r) => setTimeout(r, 500));
        }
      })(), 60000, 'resume sync to start'
    );

    for (let stop = 0; stop < MAX_STOPS; stop += 1) {
      // 观察到的最新一次阶段
      const stage = await withTimeout(
        (async () => {
          for (;;) {
            const stages = await application.evaluate(() => globalThis.__yjtStages || []);
            if (stages.length && stages[stages.length - 1].currentCompanyId) return stages[stages.length - 1];
            await new Promise((r) => setTimeout(r, 500));
          }
        })(), 90000, `stop ${stop} stage`
      );
      const workspace = await window.evaluate(() => window.oneClick.workspaceStatus());
      const entry = {
        stop,
        target: stage.currentCompanyId,
        status: stage.status,
        nextCompanyId: stage.nextCompanyId,
        workspaceTitle: workspace.title || null
      };
      report.stops.push(entry);
      console.log(JSON.stringify(entry));
      if (stage.atEnd || !stage.nextCompanyId) break;
      // login-required 完成后会停在原目标；连续 2 次同一目标即结束实测（等用户登录）
      const seen = report.stops.filter((x) => x.target === stage.currentCompanyId).length;
      if (seen >= 2) { console.log('STOP: ' + stage.currentCompanyId + ' 需要用户登录，实测到此为止'); break; }
      // 点「完成核对」进入下一家（login-required 时业务上应停在原目标，这里继续观察即可）
      await window.locator('#workspaceFinish').click({ timeout: 5000 }).catch(async () => {
        // login-required 完成后需再点一次「一键更新」
        await window.locator('#fillResumeAllButton').click({ timeout: 5000 }).catch(() => {});
      });
      // 完成后如果 workspace 未再激活（login-required 会停），再点一键更新
      await new Promise((r) => setTimeout(r, 3000));
      const stillActive = await window.evaluate(() => window.oneClick.workspaceStatus().active);
      if (!stillActive) {
        await window.locator('#fillResumeAllButton').click({ timeout: 5000 }).catch(() => {});
      }
    }
  } finally {
    try { await application.close(); } catch {}
    fs.writeFileSync(path.join(ROOT, 'test-output', 'real-site-sync-run.json'), JSON.stringify(report, null, 2));
  }
})().catch((error) => { console.error(error); process.exit(1); });
