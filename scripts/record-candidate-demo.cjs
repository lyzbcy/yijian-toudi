'use strict';
// Record actual packaged UI with sample resume and anonymous live job refresh.
// This clip is explicitly a candidate preview, never complete account acceptance.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');
const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const output = fs.mkdtempSync(path.join(root, '.local-data', `demo-${version}-`));
const profile = path.join(output, 'isolated-profile'), videos = [], errors = [], checks = [];
const report = { version, candidate: true, completeDemo: false, sampleResume: true, jobsSource: 'anonymous-live-official-providers', realApplications: 0, externalMessages: 0, output, checks, videos };
const store = new JsonStore(profile); store.init();
store.update(s => { s.settings.kimiBridgeEnabled = false; s.settings.autoCheckUpdates = false; s.settings.jobs.autoRefresh = false; s.settings.apiPort = 0; return s; });
let app, page;
const hold = ms => page.waitForTimeout(ms || 1700);
async function launch() {
  app = await electron.launch({ executablePath: path.join(root, 'release/win-unpacked/一键投递.exe'),
    args: [`--user-data-dir=${profile}`], env: { ...process.env, YIJIAN_BACKGROUND_TEST: '0' },
    recordVideo: { dir: output, size: { width: 1280, height: 900 }, showActions: { duration: 700, position: 'top-right', fontSize: 16 } } });
  page = await app.firstWindow(); page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 900));
  await page.locator('.hero-card').waitFor();
}
async function stop() {
  if (!app) return;
  const video = page.video(); await app.close(); app = null;
  assert.ok(video, 'Actual Electron recording must be available');
  videos.push(await video.path());
}
async function navigate(name) {
  await page.locator(`.sidebar [data-page="${name}"]`).click();
  await page.waitForFunction(name => document.querySelector('.page.active')?.id === `page-${name}`, name);
  await page.evaluate(async name => {
    await Promise.all(document.querySelector(`#page-${name}`).getAnimations().map(a => a.finished.catch(() => {})));
    scrollTo({ top: 0, behavior: 'instant' });
  }, name);
  await hold();
}
async function save(expectedSchool) {
  await page.locator('#saveResumeButton').click();
  await page.waitForFunction(async school => (await window.oneClick.getState()).resume.education[0].school === school, expectedSchool);
  await hold();
}
(async () => {
  try {
    await launch();
    await page.locator('#onboardingDialog[open]').waitFor(); await hold(2500);
    await page.locator('[data-recruit="social"]').click();
    await page.locator('#onboardingDialog[open]').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#appVersion').textContent(), version);
    await navigate('resume');
    await page.locator('[name="basic.name"]').fill('演示样本（非真实求职者）'); await hold();
    await page.locator('[name="intention.roles"]').fill('前端工程师');
    await page.locator('[name="education.0.school"]').fill('演示样本大学');
    await save('演示样本大学');
    await page.locator('[data-add-profile]').click();
    await page.locator('#textEntryDialog[open]').waitFor(); await hold();
    await page.locator('#textEntryInput').fill('产品方向（演示样本）'); await hold();
    await page.locator('#textEntryInput').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.profile-tab[data-profile]').length === 2);
    await hold();
    await page.locator('[name="intention.roles"]').fill('产品经理');
    await page.locator('[name="education.0.school"]').fill('产品方向样本大学');
    await save('产品方向样本大学');
    const id = await page.locator('.profile-tab.active').getAttribute('data-profile');
    await page.locator(`[data-rename-profile="${id}"]`).dblclick();
    await page.locator('#textEntryInput').fill('产品与运营（演示样本）'); await hold();
    await page.locator('#textEntryInput').press('Enter');
    await page.waitForFunction(id => document.querySelector(`[data-rename-profile="${id}"]`)?.textContent === '产品与运营（演示样本）', id);
    await hold();
    await page.locator('[data-profile="default"]').click();
    await page.waitForFunction(() => document.querySelector('.profile-tab.active')?.dataset.profile === 'default');
    assert.equal(await page.locator('[name="education.0.school"]').inputValue(), '演示样本大学'); await hold();
    checks.push('Actual onboarding, sample resume, create/rename directions and independent content through UI');
    await page.screenshot({ path: path.join(output, 'sample-resume.png') });
    await stop();
    await launch();
    assert.equal(await page.locator('#onboardingDialog[open]').count(), 0);
    await navigate('resume');
    assert.equal(await page.locator('[name="education.0.school"]').inputValue(), '演示样本大学');
    const reopened = await page.evaluate(() => window.oneClick.getState());
    assert.equal(reopened.resume.profiles.find(p => p.id === id).label, '产品与运营（演示样本）');
    checks.push('Actual process cold reopen retains sample resume and named directions');
    await navigate('jobs');
    await page.locator('#refreshJobsButton').click(); await hold(2000);
    // Click invokes the real IPC/provider path. Read persisted status without wrapping it.
    await page.locator('#refreshJobsButton:not([disabled])').waitFor({ timeout: 300000 });
    await page.waitForFunction(async () => (await window.oneClick.getState()).settings.jobs.lastRefreshAttemptAt, null, { timeout: 30000 });
    const jobs = await page.evaluate(() => window.oneClick.getState());
    const task = jobs.tasks.find(t => t.type === 'jobs');
    report.liveRefresh = { at: jobs.settings.jobs.lastRefreshAttemptAt, completedAllProviders: !!jobs.settings.jobs.lastRefreshAt, jobCount: jobs.jobs.length,
      companies: [...new Set(jobs.jobs.map(j => j.companyId))], task: task ? { status: task.status, detail: task.detail } : null };
    assert.ok(jobs.jobs.length > 0, 'Do not substitute fixture jobs if live refresh has no data');
    checks.push('Actual UI anonymous official job refresh, including real failure/partial state if any');
    await hold(3500); await page.screenshot({ path: path.join(output, 'live-jobs.png') });
    const company = jobs.jobs[0].companyId;
    await page.locator('#companyFilter').selectOption(company); await hold();
    await page.locator('#jobSearch').fill(jobs.jobs[0].title.split(/\s/)[0]); await hold();
    await page.locator('[data-cart]').first().click();
    await navigate('cart');
    assert.ok((await page.evaluate(() => window.oneClick.getState())).cart.length > 0);
    await page.screenshot({ path: path.join(output, 'cart.png') });
    checks.push('Actual job company/search filtering and local cart; no application initiated');
    await navigate('agent');
    const token = await page.evaluate(async () => (await window.oneClick.getState()).settings.apiToken);
    assert.ok(!(await page.locator('#agentPrompt').textContent()).includes(token));
    await page.screenshot({ path: path.join(output, 'masked-agent.png') }); await hold(3000);
    checks.push('Visible Agent prompt masks local token; no private prompt copied');
    assert.deepEqual(errors, []); report.ok = true;
  } catch (error) { report.ok = false; report.error = error.message; throw error; }
  finally {
    await stop(); report.pageErrors = errors;
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ output, ok: report.ok, videos, liveJobs: report.liveRefresh?.jobCount }));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
