const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-delivery-layout-'));
  const fixture = new JsonStore(profile); fixture.init();
  fixture.update(s => { s.meta.onboardingSeen = true; s.settings.kimiBridgeEnabled = false; s.settings.autoCheckUpdates = false; s.settings.jobs.autoRefresh = false; s.settings.apiPort = 0; return s; });
  const application = await electron.launch({
    args: [...(process.env.YJT_PACKAGED_EXECUTABLE ? [] : [root]), `--user-data-dir=${profile}`, '--remote-debugging-port=0'],
    executablePath: process.env.YJT_PACKAGED_EXECUTABLE || process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: process.env.YJT_VISIBLE_TEST === '1' ? '0' : '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  const manifest = process.env.YJT_UI_OBSERVER_MANIFEST;
  const errors = [], checks = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const navigate = async (page, name) => {
    await page.locator(`.sidebar [data-page="${name}"]`).click();
    await page.waitForFunction(name => {
      const active = document.querySelectorAll('.page.active');
      const selected = document.querySelectorAll('.sidebar .nav-item.active');
      return active.length === 1 && active[0].id === `page-${name}` && selected.length === 1 && selected[0].dataset.page === name;
    }, name);
    await page.evaluate(async name => {
      await Promise.all(document.querySelector(`#page-${name}`).getAnimations().map(a => a.finished.catch(() => {})));
      scrollTo({ top: 0, behavior: 'instant' });
    }, name);
    assert.equal(await page.locator(`#page-${name}`).evaluate(el => getComputedStyle(el).opacity), '1');
  };
  const phase = async (page, name) => {
    await page.screenshot({ path: path.join(output, `delivery-${name}.png`), animations: 'disabled' });
    if (!manifest) return;
    const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]);
    fs.writeFileSync(manifest, JSON.stringify({ port, phase: name, version: require('../package.json').version, profile, root }));
    const ack = `${manifest}.${name}.ack.json`, deadline = Date.now() + 60000;
    while (!fs.existsSync(ack) && Date.now() < deadline) await delay(200);
    assert.ok(fs.existsSync(ack), `Independent observation missing: ${name}`);
    assert.equal(JSON.parse(fs.readFileSync(ack, 'utf8')).phase, name);
  };
  try {
    const page = await application.firstWindow();
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForSelector('.hero-card');
    for (const width of [1100, 1280, 1440]) {
      await application.evaluate(({ BrowserWindow }, width) => {
        const main = BrowserWindow.getAllWindows()[0]; main.setMinimumSize(0, 0); main.setContentSize(width, 900);
      }, width);
      await navigate(page, 'jobs');
      const filters = await page.locator('.filter-chip').evaluateAll(elements => elements.map(e => {
        const range = document.createRange(); range.selectNodeContents(e);
        return { text: e.textContent, lines: range.getClientRects().length, clipped: e.scrollWidth > e.clientWidth };
      }));
      assert.ok(filters.every(f => f.lines === 1 && !f.clipped), `Filter text wraps or clips at ${width}: ${JSON.stringify(filters)}`);
      await navigate(page, 'resume');
      await page.waitForSelector('.sync-chip');
      const geometry = await page.evaluate(() => {
        const summary = document.querySelector('.resume-summary'), status = document.querySelector('#resumeSyncStatus');
        const heading = summary.querySelector('h2').getBoundingClientRect();
        return { width: innerWidth, headingWidth: heading.width, summaryHeight: summary.getBoundingClientRect().height, statusWidth: status.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth - innerWidth,
          closedDialogsVisible: [...document.querySelectorAll('dialog:not([open])')].filter(d => d.getBoundingClientRect().height > 0).map(d => d.id) };
      });
      assert.ok(geometry.headingWidth >= 300, `Resume heading squeezed: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.summaryHeight < 650 && geometry.statusWidth > 500, `Resume summary unusable: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.overflow <= 1, `Horizontal overflow: ${JSON.stringify(geometry)}`);
      assert.deepEqual(geometry.closedDialogsVisible, [], 'Closed dialogs must occupy no space');
      checks.push({ width, filters, geometry });
    }
    const directory = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('.resume-sections > section')];
      return { expected: sections.map(s => ({ href: `#${s.id}`, text: `${s.querySelector('.section-heading > span').textContent} ${s.querySelector('h3').textContent}` })), actual: [...document.querySelectorAll('.resume-nav a')].map(a => ({ href: a.getAttribute('href'), text: a.textContent })) };
    });
    assert.deepEqual(directory.actual, directory.expected, 'Resume directory must cover all sections in order');
    await page.locator('[name="education.0.school"]').fill('交付验收样本大学');
    await page.locator('#saveResumeButton').click();
    await page.waitForFunction(async () => (await window.oneClick.getState()).resume.education[0].school === '交付验收样本大学');
    await page.evaluate(() => scrollTo(0, 0));
    await phase(page, 'resume');
    await navigate(page, 'jobs');
    await phase(page, 'jobs');
    await navigate(page, 'agent');
    const token = await page.evaluate(async () => (await window.oneClick.getState()).settings.apiToken);
    assert.ok(token.length >= 20);
    const prompt = await page.locator('#agentPrompt').textContent();
    assert.ok(!prompt.includes(token), 'Publicly visible prompt must mask the credential');
    const clipboardBefore = await application.evaluate(({ clipboard }) => clipboard.readText());
    try {
      await page.locator('#copyPromptButton').click();
      await page.locator('.toast-text').filter({ hasText: '接入 Prompt 已复制' }).waitFor();
      const copied = await application.evaluate(({ clipboard }) => clipboard.readText());
      assert.ok(copied.includes(`Authorization: Bearer ${token}`), 'Copied private prompt must retain a usable credential');
      assert.ok(!copied.includes('[复制时自动加入本机凭证]'));
    } finally { await application.evaluate(({ clipboard }, text) => clipboard.writeText(text), clipboardBefore); }
    await phase(page, 'agent');
    assert.deepEqual(errors, []);
    const report = { ok: true, version: require('../package.json').version, fixtureOnly: true, packaged: Boolean(process.env.YJT_PACKAGED_EXECUTABLE), visible: process.env.YJT_VISIBLE_TEST === '1', checks, directorySections: directory.actual.length, credentialMasked: true, credentialCopiedCorrectly: true, clipboardRestored: true, pageErrors: errors };
    fs.writeFileSync(path.join(output, 'delivery-layout.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: true, widths: checks.map(c => c.width), directorySections: directory.actual.length, credentialMasked: true, pageErrors: errors.length }));
  } finally {
    if (manifest) fs.writeFileSync(manifest, JSON.stringify({ status: 'finished', root }));
    await application.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
