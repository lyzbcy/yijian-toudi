// Real Electron input dialogs: never replace native prompt() in these flows.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');

(async () => {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'test-output');
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-profiles-'));
  const seed = new JsonStore(profile); seed.init();
  seed.update(s => { s.settings.kimiBridgeEnabled = false; s.settings.autoCheckUpdates = false; s.settings.jobs.autoRefresh = false; s.settings.apiPort = 0; return s; });
  const application = await electron.launch({
    args: [...(process.env.YJT_PACKAGED_EXECUTABLE ? [] : [root]), `--user-data-dir=${profile}`, '--remote-debugging-port=0'],
    executablePath: process.env.YJT_PACKAGED_EXECUTABLE || process.env.ELECTRON_EXECUTABLE || undefined,
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: process.env.YJT_VISIBLE_TEST === '1' ? '0' : '1', ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  });
  const errors = [], checks = [], renameAttempts=[];
  let page;
  const phase = async (page, name) => {
    const manifest = process.env.YJT_PROFILE_OBSERVER_MANIFEST;
    if (!manifest) return;
    await page.screenshot({ path: path.join(output, `profiles-${name}.png`), animations: 'disabled' });
    const port = Number(fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/)[0]);
    fs.writeFileSync(manifest, JSON.stringify({ port, phase: name, version: require('../package.json').version, root }));
    const ack = `${manifest}.${name}.ack.json`, deadline = Date.now() + 60000;
    while (!fs.existsSync(ack) && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
    assert.ok(fs.existsSync(ack), `Independent profile observation missing: ${name}`);
    const result = JSON.parse(fs.readFileSync(ack, 'utf8'));
    assert.equal(result.phase, name); assert.equal(result.ok, true);
  };
  try {
    page = await application.firstWindow();
    page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => {
      window.profileInputEvents = [];
      for (const type of ['pointerdown', 'pointerup', 'click', 'dblclick']) document.addEventListener(type, event => {
        window.profileInputEvents.push({ type, detail: event.detail, target: event.target.tagName, inProfiles:!!event.target.closest('#resumeProfilesBar'), x:event.clientX,y:event.clientY,focused:document.hasFocus(), rename: !!event.target.closest('[data-rename-profile]'), active: !!event.target.closest('.profile-tab.active'), open: !!document.querySelector('#textEntryDialog[open]') });
        if (window.profileInputEvents.length > 60) window.profileInputEvents.shift();
      }, true);
    });
    await page.locator('#onboardingDialog[open]').waitFor();
    await page.locator('[data-recruit="social"]').click();
    await page.locator('#onboardingDialog[open]').waitFor({ state: 'hidden' });
    await page.locator('.sidebar [data-page="resume"]').click();
    const tabs = page.locator('.profile-tab[data-profile]');
    await tabs.first().waitFor();
    assert.equal(await tabs.count(), 1);
    const nativePrompt = await page.evaluate(() => String(window.prompt));
    assert.match(nativePrompt, /\[native code\]/);
    const input = page.locator('#textEntryInput'), dialog = page.locator('#textEntryDialog[open]');
    const save = async () => {
      await page.locator('#saveResumeButton').click();
      await page.locator('.toast-text').filter({ hasText: '简历已安全保存在本机' }).waitFor();
    };
    const add = async () => { await page.locator('[data-add-profile]').click(); await dialog.waitFor(); };
    const submit = async value => { await input.fill(value); await input.press('Enter'); await dialog.waitFor({ state: 'hidden' }); };
    const activeIs = async id => page.waitForFunction(id => document.querySelector('.profile-tab.active')?.dataset.profile === id, id);
    const renameSnapshot=async(locator,phase)=>renameAttempts.push(await locator.evaluate((e,phase)=>{
      const r=e.getBoundingClientRect(),parents=[];for(let p=e.parentElement;p;p=p.parentElement)if(p.scrollHeight>p.clientHeight)parents.push({tag:p.tagName,scrollTop:p.scrollTop,clientHeight:p.clientHeight,scrollHeight:p.scrollHeight});
      return{phase,connected:e.isConnected,focused:document.hasFocus(),rect:{x:r.x,y:r.y,width:r.width,height:r.height},viewport:{width:innerWidth,height:innerHeight},parents,dialogOpen:!!document.querySelector('#textEntryDialog[open]')};
    },phase));
    await page.locator('[name="intention.roles"]').fill('前端工程师');
    await page.locator('[name="education.0.school"]').fill('默认大学');
    await save();
    await page.locator('[name="education.0.school"]').fill('未保存的默认大学');
    await add();
    assert.equal(await input.evaluate(e => e === document.activeElement), true);
    await input.fill('应取消的方向');
    await input.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await tabs.count(), 1);
    assert.equal(await page.locator('[name="education.0.school"]').inputValue(), '未保存的默认大学');
    assert.equal(await page.locator('[data-add-profile]').evaluate(e => e === document.activeElement), true);
    await add();
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await tabs.count(), 1);
    checks.push('New-profile Escape/button cancellation preserves unsaved content and returns keyboard focus');
    await add();
    for (const width of [1100, 1280, 1440]) {
      await application.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width);
      const box = await dialog.boundingBox();
      assert.ok(box.width > 300 && box.x >= 0 && box.x + box.width <= width);
      assert.equal(await input.getAttribute('maxlength'), '80');
      assert.equal(await input.evaluate(e => e.labels[0].textContent), '简历方向名称');
    }
    await input.fill('产品方向');
    await input.evaluate(e => e.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
    assert.equal(await dialog.count(), 1, 'IME candidate Enter must not close dialog');
    await page.screenshot({ path: path.join(output, 'profiles-text-entry.png') });
    await phase(page, 'input');
    await input.press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('.profile-tab[data-profile]').length === 2);
    const newId = await page.locator('.profile-tab.active').getAttribute('data-profile');
    assert.notEqual(newId, 'default');
    assert.equal(await page.locator('[name="intention.roles"]').inputValue(), '');
    await phase(page, 'created');
    checks.push('Actual labeled modal at three widths creates independent profile with Enter; native prompt unchanged');
    await page.locator('[name="education.0.school"]').fill('产品大学');
    await page.locator('[name="intention.roles"]').fill('产品经理');
    const firstRename=page.locator(`[data-rename-profile="${newId}"]`);
    await renameSnapshot(firstRename,'before-first-dblclick');
    await firstRename.dblclick();
    await renameSnapshot(firstRename,'after-first-dblclick');
    await dialog.waitFor();
    assert.equal(await input.inputValue(), '产品方向');
    await input.fill('   ');
    await dialog.getByRole('button', { name: '确定', exact: true }).click();
    assert.equal(await dialog.count(), 1, 'Whitespace-only required name must be rejected');
    await input.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[name="education.0.school"]').inputValue(), '产品大学');
    await page.locator(`[data-rename-profile="${newId}"]`).dblclick();
    await dialog.waitFor();
    await submit('产品与运营方向');
    await page.waitForFunction(id => document.querySelector(`[data-rename-profile="${id}"]`)?.textContent === '产品与运营方向', newId);
    assert.equal(await page.locator('[name="education.0.school"]').inputValue(), '产品大学');
    const renamed = await page.evaluate(() => window.oneClick.getState());
    assert.equal(renamed.resume.education[0].school, '产品大学');
    await phase(page, 'renamed');
    checks.push('Rename prefill, required validation, cancellation and Enter retain unsaved current resume');
    await page.locator('[data-profile="default"]').click();
    await activeIs('default');
    assert.equal(await page.locator('[name="education.0.school"]').inputValue(), '未保存的默认大学');
    assert.equal(await page.locator('[name="intention.roles"]').inputValue(), '前端工程师');
    await page.locator('[name="basic.name"]').fill('共享信息样本');
    await page.locator(`[data-profile="${newId}"]`).click();
    await activeIs(newId);
    assert.equal(await page.locator('[name="basic.name"]').inputValue(), '共享信息样本');
    assert.equal(await page.locator('[name="education.0.school"]').inputValue(), '产品大学');
    await add();
    await submit('');
    await page.waitForFunction(() => document.querySelectorAll('.profile-tab[data-profile]').length === 3);
    assert.equal(await page.locator('.profile-tab.active [data-rename-profile]').textContent(), '简历 3');
    assert.equal(await page.locator('[data-profile="default"] [data-del-profile]').count(), 0);
    checks.push('Automatic blank-name fallback, independent directions and shared identity verified');
    await page.locator('.sidebar [data-page="settings"]').click();
    const accounts = () => page.evaluate(() => window.oneClick.accountList());
    const before = (await accounts()).accounts.length;
    const create = async () => { await page.locator('#bossAccountCreateButton').click(); await dialog.waitFor(); };
    await create(); await input.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await accounts()).accounts.length, before);
    await create(); await input.fill('取消客户样本'); await input.press('Enter');
    await page.locator('#textEntryTitle').filter({ hasText: '核对客户身份' }).waitFor();
    await input.press('Escape'); await dialog.waitFor({ state: 'hidden' });
    assert.equal((await accounts()).accounts.length, before);
    await create(); await input.fill('客户档案样本'); await input.press('Enter');
    await page.locator('#textEntryTitle').filter({ hasText: '核对客户身份' }).waitFor();
    await input.fill('abcd'); await input.press('Enter');
    assert.equal(await dialog.count(), 1);
    assert.equal((await accounts()).accounts.length, before);
    await submit('1234');
    await page.waitForFunction(async count => (await window.oneClick.accountList()).accounts.length === count, before + 1);
    const created = (await accounts()).accounts.find(a => a.name === '客户档案样本');
    assert.equal(created.phoneMasked, '***1234');
    await page.locator('#bossAccountCreateButton:not([disabled])').waitFor();
    await create(); await input.fill('跳过尾号样本'); await input.press('Enter');
    await page.locator('#textEntryTitle').filter({ hasText: '核对客户身份' }).waitFor();
    await submit('');
    await page.waitForFunction(async count => (await window.oneClick.accountList()).accounts.length === count, before + 2);
    assert.equal((await accounts()).accounts.find(a => a.name === '跳过尾号样本').phoneMasked, '');
    checks.push('Both customer-dialog cancellations, digit validation and optional tail work without launching browser or sending');
    await page.reload(); await page.locator('.hero-card').waitFor();
    const persisted = await page.evaluate(() => window.oneClick.getState());
    assert.equal(persisted.resume.profiles.find(p => p.id === newId).label, '产品与运营方向');
    assert.equal(persisted.resume.profiles.find(p => p.id === newId).education[0].school, '产品大学');
    assert.equal(persisted.resume.basic.name, '共享信息样本');
    assert.equal(await page.evaluate(() => String(window.prompt)), nativePrompt);
    assert.deepEqual(errors, []);
    checks.push('Reload retains names, independent resume content and shared identity with zero page errors');
    const report = { ok: true, version: require('../package.json').version, fixtureOnly: true, packaged: !!process.env.YJT_PACKAGED_EXECUTABLE, promptStubbed: false, checks, pageErrors: errors,renameAttempts };
    fs.writeFileSync(path.join(output, 'resume-profiles.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = { ok: false, version: require('../package.json').version, fixtureOnly: true, packaged: !!process.env.YJT_PACKAGED_EXECUTABLE, promptStubbed: false, checks, pageErrors: errors,renameAttempts, error: error.message };
    if (page && !page.isClosed()) {
      report.inputEvents = await page.evaluate(() => window.profileInputEvents || []).catch(() => []);
      report.dialogState = await page.evaluate(() => ({ open: !!document.querySelector('#textEntryDialog[open]'), activeTabCount: document.querySelectorAll('.profile-tab.active').length, tabCount: document.querySelectorAll('.profile-tab[data-profile]').length })).catch(() => null);
      await page.screenshot({ path: path.join(output, 'profiles-failure.png'), animations: 'disabled' }).catch(() => {});
    }
    fs.writeFileSync(path.join(output, 'resume-profiles.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
