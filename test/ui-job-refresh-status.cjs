'use strict';
// Provider functions are explicit fixtures. The main refresh loop, IPC, store,
// merge behavior and renderer run unchanged in a real Electron process.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const output = fs.mkdtempSync(path.join(root, '.local-data', 'job-refresh-ui-' + version + '-'));
const profile = path.join(output, 'profile'), store = new JsonStore(profile); store.init();
const cached = companyId => ({ id: companyId + '-cached', companyId, title: '旧岗位（样本）',
  city: '北京', department: '样本', url: 'https://example.invalid/job', postedAt: '2026-10-01', favorite: false,
  tags: [], summary: '样本岗位', jobType: '社招', type: '全职', education: '本科', experience: '不限', salary: '', match: 0 });
store.update(state => {
  state.jobs = [cached('baidu'), cached('bytedance')];
  state.settings.kimiBridgeEnabled = false; state.settings.jobs.autoRefresh = false;
  state.settings.autoCheckUpdates = false; state.settings.apiEnabled = false;
  state.meta.onboardingSeen = true; return state;
});
const report = { ok: false, version, platform: process.platform,
  packaged: !!process.env.YJT_PACKAGED_EXECUTABLE, providerFunctionsFixture: true,
  realRecruitment: false, externalMessages: 0, checks: [], at: new Date().toISOString() };
const errors = []; let application, page;
async function launch() {
  application = await electron.launch({ executablePath: process.env.YJT_PACKAGED_EXECUTABLE || undefined,
    args: [...(process.env.YJT_PACKAGED_EXECUTABLE ? [] : [root]), '--user-data-dir=' + profile],
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: '0' } });
  page = await application.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.hero-card').waitFor();
}
async function close() { if (application) { await application.close(); application = null; } }
async function providers(mode) {
  await application.evaluate(({ app }, mode) => {
    const req = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/electron/main.cjs');
    const adapters = req('./adapters/registry.cjs').listJobAdapters();
    for (const adapter of adapters) adapter.listJobs = async () => {
      if (mode === 'failed' || mode === 'partial' && ['baidu', 'bytedance'].includes(adapter.id)) throw Error('fixture-offline');
      if (mode === 'empty') return [];
      return [{ id: adapter.idPrefix + 'new', companyId: adapter.id, title: '新岗位（样本）',
        department: '样本', city: '北京', url: 'https://example.invalid/job', favorite: false,
        postedAt: new Date().toISOString().slice(0, 10), tags: [], summary: '样本岗位',
        jobType: '社招', type: '全职', education: '本科', experience: '不限', salary: '', match: 0 }];
    };
  }, mode);
}
const state = () => page.evaluate(() => window.oneClick.getState());
const refresh = async mode => {
  await providers(mode);
  await page.locator('.sidebar [data-page="jobs"]').click();
  await page.locator('#refreshJobsButton').click();
  await page.waitForFunction(() => !document.querySelector('#refreshJobsButton').disabled);
  return state();
};
(async () => {
  await launch();
  let current = await refresh('partial');
  assert.equal(current.settings.jobs.lastRefreshResult.status, 'partial');
  assert.equal(current.settings.jobs.lastRefreshResult.count, 4);
  assert.equal(current.settings.jobs.lastRefreshAt, null);
  assert(current.jobs.some(job => job.id === 'baidu-cached'));
  assert(current.jobs.some(job => job.id === 'bytedance-cached'));
  await page.locator('#jobsRefreshResultTitle').filter({ hasText: '上次刷新部分完成' }).waitFor();
  assert.match(await page.locator('#jobsRefreshResultDetail').textContent(), /百度、字节跳动刷新失败/);
  await page.locator('.sidebar [data-page="settings"]').click();
  assert.match(await page.locator('#jobsLastRefresh').textContent(), /最近尝试.*尚无完整成功记录/);
  report.checks.push('Real refresh loop persists partial provider outcome, preserves failed companies old jobs and shows partial notice plus attempt without claiming full success');
  const jobsTaskIDs = current.tasks.filter(task => task.type === 'jobs').map(task => task.id);
  await close();
  const restartState = JSON.parse(fs.readFileSync(path.join(profile, 'state.json'), 'utf8'));
  restartState.settings.jobs.autoRefresh = true;
  fs.writeFileSync(path.join(profile, 'state.json'), JSON.stringify(restartState));
  await launch();
  await page.locator('#jobsRefreshResultTitle').filter({ hasText: '上次刷新部分完成' }).waitFor();
  assert.equal((await state()).settings.jobs.lastRefreshResult.status, 'partial');
  assert.deepEqual((await state()).tasks.filter(task => task.type === 'jobs').map(task => task.id), jobsTaskIDs);
  await page.screenshot({ path: path.join(output, 'partial-reopened.png'), animations: 'disabled' });
  report.checks.push('Real cold reopen with automatic refresh enabled preserves partial notice/provider names/old jobs and starts no new refresh after the recent failed attempt');

  current = await refresh('done');
  const fullAt = current.settings.jobs.lastRefreshAt;
  assert(fullAt); assert.equal(current.settings.jobs.lastRefreshResult.status, 'done');
  assert.equal(current.settings.jobs.lastRefreshAttemptAt, fullAt);
  assert.equal(current.jobs.length, 6);
  await page.locator('#jobsRefreshResultTitle').filter({ hasText: '上次刷新完成' }).waitFor();
  report.checks.push('Next real full refresh replaces obsolete partial notice and uses one timestamp for full success and attempt');
  const before = current.jobs;
  current = await refresh('failed');
  assert.equal(current.settings.jobs.lastRefreshResult.status, 'failed');
  assert.equal(current.settings.jobs.lastRefreshAt, fullAt);
  assert.deepEqual(current.jobs, before);
  await page.locator('#jobsRefreshResultTitle').filter({ hasText: '上次刷新失败' }).waitFor();
  await page.locator('.sidebar [data-page="settings"]').click();
  assert.match(await page.locator('#jobsLastRefresh').textContent(), /最近尝试.*上次完整抓取/);
  report.checks.push('All-provider failure preserves actual prior data/full-success timestamp and shows persistent failure with both attempt and full-success time');

  current = await refresh('empty');
  assert.equal(current.settings.jobs.lastRefreshResult.status, 'done');
  assert.equal(current.settings.jobs.lastRefreshResult.count, 0);
  assert.equal(current.jobs.length, 0);
  assert.equal(current.tasks.find(task => task.type === 'jobs').status, 'done');
  await page.locator('#jobsRefreshResultDetail').filter({ hasText: '查询已完成' }).waitFor();
  assert.equal(await page.locator('#dataModeLabel').textContent(), '暂无岗位');
  assert.match(await page.locator('#onboardingTasks').textContent(), /抓取岗位/);
  assert.equal(await page.locator('.ob-step.done').filter({ hasText: '抓取岗位' }).count(), 1);
  report.checks.push('Successful zero-result query finishes done, clears nonfavorite old snapshot, labels no jobs and does not invent a failed/unattempted query');
  for (const width of [1280, 1024, 840]) {
    await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    assert(await page.locator('#jobsRefreshResult').isVisible());
  }
  assert.deepEqual(errors, []); report.ok = true;
  report.checks.push('Persistent notice remains visible at three supported widths with no horizontal overflow or renderer errors');
})().catch(async error => {
  report.error = error.message; process.exitCode = 1;
  if (page) {
    report.failureBodyText = (await page.locator('body').textContent().catch(() => '')).slice(0, 3000);
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  }
}).finally(async () => {
  await close(); report.pageErrors = errors;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, ok: report.ok, checks: report.checks.length, error: report.error }));
});
