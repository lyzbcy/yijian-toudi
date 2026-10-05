const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { _electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');
const { INSPECT_FORM_FIELDS } = require('../electron/form-inspection.cjs');
const { createUniversalResumePlan } = require('../electron/resume-plan.cjs');
const { planGenericResumeFields, buildExecuteFieldPlanScript, mergeExecutionWithInspection } = require('../electron/adapters/generic-resume-fill.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-feishu-guards-'));
  const store = new JsonStore(profile); store.init();
  store.update(s => {
    s.meta.onboardingSeen = true; s.settings.apiPort = 0;
    s.settings.jobs.autoRefresh = false; s.settings.autoCheckUpdates = false;
    s.settings.kimiBridgeEnabled = false; return s;
  });
  let app;
  const checks = [], check = (name, value) => { assert(value, name); checks.push(name); };
  try {
    const executablePath = process.env.YJT_PACKAGED_EXECUTABLE;
    app = await _electron.launch({ executablePath: executablePath || undefined, args: [...(executablePath ? [] : [root]), '--user-data-dir=' + profile], env: { ...process.env, YIJIAN_BACKGROUND_TEST: '1' } });
    assert.equal(await app.evaluate(({ app }) => app.getVersion()), require('../package.json').version);
    const main = await app.firstWindow(); await main.locator('.hero-card').waitFor();
    const nextWindow = app.waitForEvent('window');
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false } });
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8">
        <label for="name">姓名</label><input id="name" value="old-name">
        <div class="resumeEditForm-hiddenField" style="display:none"><label for="ghost">手机号码</label><input id="ghost" value="old-internal"></div>
        <label for="phone">手机号码</label><input id="phone" value="old-phone">
        <div class="atsx-select"><label for="school">学校名称</label><input id="school" value="old-school-search"></div>
        <div class="atsx-date-picker"><label for="end">毕业时间</label><input id="end" value="old-date-display"></div>
        <button id="save">保存</button>`));
    });
    const page = await nextWindow; await page.locator('#save').waitFor();
    await page.evaluate(() => {
      window.fixtureEvents = { save: 0, ghost: 0, school: 0, end: 0 };
      for (const id of ['ghost', 'school', 'end']) document.getElementById(id).addEventListener('input', () => window.fixtureEvents[id]++);
      document.getElementById('save').addEventListener('click', () => window.fixtureEvents.save++);
    });
    const fields = await page.evaluate(INSPECT_FORM_FIELDS);
    check('inspection preserves all five indexes including internal and widget text inputs', fields.length === 5 && fields[2].id === 'phone');
    check('internal text and ATSX search/date inputs are ineligible for generic writing', ['ghost', 'school', 'end'].every(id => fields.find(f => f.id === id).readOnly));
    const planned = planGenericResumeFields(createUniversalResumePlan({ basic: { name: 'fixture-name', phone: 'fixture-phone' }, education: [{ school: 'fixture-school', end: '2026-09' }] }), fields);
    check('visible phone wins over the earlier identical caption in hidden data', planned.writable.find(p => p.key === 'basic.phone')?.locator.value === 'phone');
    check('school catalog and date precision remain manual', ['education.0.school', 'education.0.end'].every(key => planned.manual.some(p => p.key === key)));
    const forced = ['ghost', 'school', 'end'].map(id => ({ key: 'fixture.' + id, value: 'must-not-write', locator: { kind: 'id', value: id } }));
    const blocked = await page.evaluate(buildExecuteFieldPlanScript(forced));
    check('stale explicit locators are rejected at execution without any input event', blocked.every(r => !r.written && r.error === 'unsupported-control') && await page.evaluate(() => ['ghost', 'school', 'end'].every(id => window.fixtureEvents[id] === 0)));
    const result = await page.evaluate(buildExecuteFieldPlanScript(planned.writable));
    const after = await page.evaluate(INSPECT_FORM_FIELDS);
    const merged = mergeExecutionWithInspection(result, after);
    check('ordinary visible text still writes and independently reads back', merged.length === 2 && merged.every(r => r.written && r.observed === r.expected));
    await page.evaluate(() => {
      const wrapper = document.createElement('div'); wrapper.className = 'atsx-select';
      const input = document.getElementById('name'); input.before(wrapper); wrapper.append(input);
      document.getElementById('phone').readOnly = true;
    });
    const stale = await page.evaluate(buildExecuteFieldPlanScript(planned.writable.map(p => ({ ...p, value: 'late-change' }))));
    check('controls replaced by widgets or made readonly after planning remain unchanged', stale.every(r => !r.written) && await page.locator('#name').inputValue() === 'fixture-name' && await page.locator('#phone').inputValue() === 'fixture-phone');
    const events = await page.evaluate(() => window.fixtureEvents);
    check('no internal field, widget, or save action occurs', Object.values(events).every(v => v === 0));
    fs.writeFileSync(path.join(root, 'test-output/feishu-control-guards.json'), JSON.stringify({ ok: true, version: require('../package.json').version, packaged: Boolean(executablePath), fixtureOnly: true, checks, officialWrites: 0 }, null, 2));
    console.log(JSON.stringify({ ok: true, checks: checks.length }));
  } finally { if (app) await app.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
