const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { _electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const executable = process.env.ONBOARDING_EXECUTABLE || null;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-onboarding-'));
  const store = new JsonStore(profile); store.init(); store.update(s => { s.settings.apiPort = 0; return s; });
  const results = [], check = (name, ok) => results.push({ name, ok: !!ok });
  let application;
  const launch = () => _electron.launch({ ...(executable ? { executablePath: executable } : {}), args: [...(executable ? [] : [root]), `--user-data-dir=${profile}`], env: { ...process.env, YIJIAN_BACKGROUND_TEST: '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
  try {
    application = await launch();
    const identity = await application.evaluate(({app})=>({version:app.getVersion(),packaged:app.isPackaged}));
    if(identity.version!==require('../package.json').version||!!executable!==identity.packaged)throw Error('Onboarding test app identity mismatch');
    const page = await application.firstWindow();
    await page.locator('#onboardingDialog[open]').waitFor({ state: 'visible' });
    check('all five directions remain present', await page.locator('.onboarding-choice').count() === 5);
    for (const width of [960, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const cards = await page.locator('.onboarding-choice').evaluateAll(nodes => nodes.map(n => {
        const bounds = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, right: r.right, bottom: r.bottom }; };
        return { type: n.dataset.recruit, button: bounds(n), icon: bounds(n.querySelector('.choice-icon')), title: bounds(n.querySelector('strong')), copy: bounds(n.querySelector('small')), text: n.querySelector('small').textContent, copyColumn: getComputedStyle(n.querySelector('small')).gridColumnStart, copyRow: getComputedStyle(n.querySelector('small')).gridRowStart };
      }));
      for (const c of cards) check(`${width}px ${c.type} description in readable right column`, c.copyColumn === '2' && c.copyRow === '2' && c.copy.width > 100 && c.copy.x === c.title.x && c.copy.x >= c.icon.right && c.copy.y >= c.title.bottom && c.copy.right <= c.button.right && !!c.text.trim());
    }
    check('empty draft remains empty before choice', (await page.evaluate(() => window.oneClick.getState())).resume.basic.name === '');
    check('empty draft completion is zero in real main/UI', (await page.evaluate(() => window.oneClick.getState())).resume.completion === 0 && await page.locator('#resumeCompletion').textContent() === '0%');
    await page.locator('.onboarding-choice[data-recruit="social"]').click();
    await page.locator('#onboardingDialog[open]').waitFor({ state: 'hidden' });
    const chosen = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    check('direction and onboarding persisted', chosen.meta.onboardingSeen === true && chosen.settings.jobs.recruitType === 'social');
    check('selection does not implicitly refresh or submit', chosen.jobs.length === 0 && !chosen.tasks.some(t => t.type === 'jobs') && chosen.cart.length === 0);
    check('blank resume start step is not checked', !await page.locator('[data-onboarding-step="resume"]').evaluate(el=>el.classList.contains('done')));
    check('API step describes configuration, not a connected external AI', (await page.locator('[data-onboarding-step="agent"]').textContent()).includes('开启 Agent API（可选）'));
    await application.close(); application = await launch();
    const reopened = await application.firstWindow(); await reopened.locator('.hero-card').waitFor();
    const again = JSON.parse(fs.readFileSync(store.file, 'utf8'));
    check('reopen retains selected direction', again.settings.jobs.recruitType === 'social' && again.meta.onboardingSeen === true);
    check('reopen does not display first-run dialog again', await reopened.locator('#onboardingDialog[open]').count() === 0);
    check('reopen blank completion remains zero in UI and disk', await reopened.locator('#resumeCompletion').textContent() === '0%' && again.resume.completion === 0);
    check('reopen blank start step remains unchecked', !await reopened.locator('[data-onboarding-step="resume"]').evaluate(el=>el.classList.contains('done')));
    await reopened.locator('[data-page="resume"]').first().click();
    await reopened.locator('[name="basic.name"]').fill('SAMPLE_NAME');
    await reopened.locator('[name="basic.phone"]').fill('13800000000');
    await reopened.locator('[name="basic.email"]').fill('sample@example.invalid');
    await reopened.locator('#saveResumeButton').click();
    await reopened.waitForFunction(()=>document.querySelector('#resumeCompletion').textContent==='27%');
    check('real form saved contacts below threshold stay unfinished', !await reopened.locator('[data-onboarding-step="resume"]').evaluate(el=>el.classList.contains('done')));
    await reopened.locator('[name="education.0.school"]').fill('SAMPLE_SCHOOL');
    await reopened.locator('#saveResumeButton').click();
    await reopened.waitForFunction(()=>document.querySelector('#resumeCompletion').textContent==='36%');
    check('real form saved name contact and education complete start step', await reopened.locator('[data-onboarding-step="resume"]').evaluate(el=>el.classList.contains('done')));
    // Deterministic prompt text only; real button/IPC/store/profile switch remain production.
    await reopened.evaluate(()=>{window.prompt=()=> 'SAMPLE_EMPTY';});
    await reopened.locator('[data-add-profile]').click();
    await reopened.waitForFunction(()=>document.querySelector('#resumeCompletion').textContent==='27%');
    check('new empty active profile loses old profile credit', !await reopened.locator('[data-onboarding-step="resume"]').evaluate(el=>el.classList.contains('done')));
    check('profile change keeps shared contact facts', (await reopened.locator('[name="basic.name"]').inputValue())==='SAMPLE_NAME');
    await reopened.locator('.profile-tab[data-profile="default"]').click();
    await reopened.waitForFunction(()=>document.querySelector('#resumeCompletion').textContent==='36%');
    check('switch back restores matching score and step without losing education', await reopened.locator('[data-onboarding-step="resume"]').evaluate(el=>el.classList.contains('done')) && (await reopened.locator('[name="education.0.school"]').inputValue())==='SAMPLE_SCHOOL');
  } finally { await application?.close(); }
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.name}`);
  console.log(JSON.stringify({ scope: executable ? 'actual packaged EXE/main/IPC/renderer with isolated SAMPLE and BACKGROUND=1; not ordinary mode' : 'real source renderer with isolated profile and background mode; not ordinary EXE auto-refresh proof', version: require('../package.json').version, packaged: !!executable, tests: results.length, pass: results.filter(r => r.ok).length, fail: results.filter(r => !r.ok).length }));
  if (results.some(r => !r.ok)) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
