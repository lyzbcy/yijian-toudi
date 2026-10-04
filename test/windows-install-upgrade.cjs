'use strict';
// Opt-in integration: real NSIS install/upgrade/uninstall in an isolated path.
// Stops if this user already has a registered installation. Network responses
// are controlled fixtures; binaries and installer/helper processes are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');
const { readInstallation, shaFile } = require('../electron/windows-update.cjs');
const root = path.resolve(__dirname, '..');
const ps = code => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false;" + code, 'utf16le').toString('base64')], { windowsHide: true, timeout: 240000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, timeout = 180000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await delay(250); }
  throw Error('Windows installation verification timed out');
}
(async () => {
  assert.equal(process.platform, 'win32');
  assert.equal(await readInstallation(), null, 'Existing user installation must be preserved');
  const version = require('../package.json').version;
  const oldVersion = process.env.YJT_BASELINE_VERSION || '0.5.34';
  const desktop = process.env.YJT_TEST_DESKTOP === '1';
  const restartCase=process.env.YJT_RESTART_CASE||null,helperTemplate=process.env.YJT_HELPER_TEMPLATE?path.resolve(process.env.YJT_HELPER_TEMPLATE):null;
  if(restartCase)assert(['baseline-no-process','no-process','live-unconfirmed','confirmed'].includes(restartCase));
  if(helperTemplate)assert(fs.existsSync(helperTemplate));
  const base = fs.mkdtempSync(path.join(root, 'verification', '2026-10-04-recovery', 'install-smoke-'));
  const installRoot = path.join(base, '中文安装目录'), profile = path.join(base, 'isolated-profile');
  assert.ok(installRoot.startsWith(base + path.sep));
  const paths = JSON.parse(ps("[Console]::OutputEncoding=New-Object Text.UTF8Encoding $false;@{programs=[Environment]::GetFolderPath('Programs');desktop=[Environment]::GetFolderPath('Desktop');cache=(Join-Path $env:LOCALAPPDATA 'yijian-toudi-updater\\installer.exe')}|ConvertTo-Json -Compress"));
  const preserved = [path.join(paths.programs, '一键投递.lnk'), path.join(paths.desktop, '一键投递.lnk'), paths.cache].map(file => ({ file, existed: fs.existsSync(file), bytes: fs.existsSync(file) ? fs.readFileSync(file) : null }));
  for (const [index, item] of preserved.entries()) if (item.existed) fs.writeFileSync(path.join(base, `preserved-${index}.bin`), item.bytes);
  const operationFile = path.join(base, 'operation.json');
  function operation(data) {
    fs.writeFileSync(operationFile, JSON.stringify(data));
    return ps(`$ErrorActionPreference='Stop';$p=Get-Content -Raw -Encoding UTF8 -LiteralPath '${operationFile.replaceAll("'", "''")}'|ConvertFrom-Json;$child=Start-Process -FilePath $p.exe -ArgumentList $p.arguments -WindowStyle Hidden -Wait -PassThru;$child.ExitCode`);
  }
  const seed = new JsonStore(profile); seed.init();
  seed.update(s => { s.settings.kimiBridgeEnabled = false; s.settings.autoCheckUpdates = false; s.settings.jobs.autoRefresh = false; s.settings.apiPort = 0; return s; });
  const newInstaller = path.join(root, 'release', `yijian-toudi-setup-${version}.exe`);
  const digest = await shaFile(newInstaller), bytes = fs.statSync(newInstaller).size;
  const checks = [], report = { version, oldVersion, desktop, mode: 'real-nsis-controlled-release-response', base, checks, ok: false, restartCase, helperScriptSourceOverriddenForTest:!!helperTemplate, nativeWizardVerified:false };
  let application;
  try {
    const installer = path.join(root, 'release', `yijian-toudi-setup-${oldVersion}.exe`);
    assert.equal(operation({ exe: installer, arguments: `/S /currentuser /DESKTOP=${desktop ? 1 : 0} /D=${installRoot}` }), '0');
    let record = await readInstallation();
    assert.equal(path.resolve(record.root), installRoot); assert.equal(record.version, oldVersion); assert.equal(record.desktop, desktop);
    checks.push(`Real NSIS installed baseline into chosen Chinese path with desktop option ${desktop ? 'enabled' : 'disabled'}`);
    const executable = path.join(installRoot, '一键投递.exe');
    const originalAsarHash=await shaFile(path.join(installRoot,'resources','app.asar'));
    application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env: { ...process.env, YIJIAN_BACKGROUND_TEST: '0' } });
    const page = await application.firstWindow();
    await page.locator('#onboardingDialog[open]').waitFor();
    await page.locator('.onboarding-choice[data-recruit="social"]').click();
    await page.locator('#onboardingDialog[open]').waitFor({ state: 'hidden' });
    await page.locator('.sidebar [data-page="resume"]').click();
    await page.locator('[name="education.0.school"]').fill('升级保留验收大学');
    await page.locator('#saveResumeButton').click();
    await page.locator('.toast-text').filter({ hasText: '简历已安全保存在本机' }).waitFor();
    const before = await page.evaluate(() => window.oneClick.getState());
    assert.equal(before.resume.education[0].school, '升级保留验收大学');
    checks.push('Installed baseline opened visible UI, completed onboarding and saved resume through real UI');
    await application.evaluate(async ({ session }) => {
      await session.fromPartition('persist:delivery-upgrade-fixture').cookies.set({ url: 'https://delivery-upgrade.example.test', name: 'retention-fixture', value: 'local-fixture-only', expirationDate: Math.floor(Date.now() / 1000) + 86400 });
      await session.fromPartition('persist:delivery-upgrade-fixture').cookies.flushStore();
    });
    const attachment = path.join(profile, 'resumes', 'retention-fixture.pdf');
    fs.mkdirSync(path.dirname(attachment), { recursive: true }); fs.writeFileSync(attachment, '%PDF-1.4\nlocal retention fixture\n%%EOF');
    const attachmentHash = await shaFile(attachment);
    await application.evaluate(({ net }, data) => {
      const fs = process.getBuiltinModule('fs');
      const prefix = `https://github.com/lyzbcy/yijian-toudi/releases/download/v${data.version}/`;
      const name = `yijian-toudi-setup-${data.version}.exe`, checksum = name.replace('.exe', '.sha256');
      const release = { tag_name: `v${data.version}`, html_url: `https://github.com/lyzbcy/yijian-toudi/releases/tag/v${data.version}`, draft: false, prerelease: false, assets: [{ name, size: data.bytes, browser_download_url: prefix + name }, { name: checksum, size: 100, browser_download_url: prefix + checksum }] };
      net.fetch = async url => {
        if (url === 'https://api.github.com/repos/lyzbcy/yijian-toudi/releases/latest') return new Response(JSON.stringify(release), { status: 200 });
        if (url === prefix + checksum) return new Response(`${data.digest}  ${name}\n`, { status: 200 });
        if (url === prefix + name) return new Response(fs.readFileSync(data.file), { status: 200, headers: { 'content-length': String(data.bytes) } });
        throw Error('Unexpected network request in controlled upgrade');
      };
    }, { version, bytes, digest, file: newInstaller });
    const found = await page.evaluate(() => window.oneClick.checkUpdate({ manual: true }));
    assert.equal(found.canInstall, true); assert.equal(found.latest, version);
    const downloaded = await page.evaluate(version => window.oneClick.downloadUpdate({ version }), version);
    assert.equal(downloaded.ok, true); assert.equal(downloaded.shaOk, true); assert.equal(downloaded.canInstall, true);
    assert.equal(downloaded.sha256, digest);
    checks.push('Actual installed IPC updater selected candidate, downloaded real installer and checked SHA-256');
    if(helperTemplate)await application.evaluate(({app},templatePath)=>{const req=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/electron/main.cjs'),update=req('./windows-update.cjs'),launch=update.launchUpdateHelper;update.launchUpdateHelper=(payload,directory)=>launch(payload,directory,{templatePath});},helperTemplate);
    const closed = application.waitForEvent('close');
    let handoff;
    try { handoff = await page.evaluate(version => window.oneClick.installUpdate({ confirmed: true, version }), version); }
    catch (error) { if (!error.message.includes('has been closed')) throw error; }
    if (handoff) assert.equal(handoff.ok, true, handoff.message);
    await closed; application = null;
    const resultFile = path.join(profile, 'desktop-updates', 'install-result.json');
    const pending=JSON.parse(fs.readFileSync(path.join(profile,'desktop-updates','install-pending.json'),'utf8'));
    if(restartCase&&restartCase!=='confirmed'){
      const fixtureResult=restartCase==='live-unconfirmed'?path.join(pending.attempt,'withheld-result.json'):resultFile;
      const outcome=await until(()=>{try{const r=JSON.parse(fs.readFileSync(fixtureResult,'utf8').replace(/^\uFEFF/,''));return r.nonce===pending.nonce&&r.status===(restartCase==='baseline-no-process'?'installed':'failed')?r:false;}catch{return false;}});
      const ready=JSON.parse(fs.readFileSync(path.join(pending.attempt,'ready.json'),'utf8').replace(/^\uFEFF/,''));await until(()=>{try{process.kill(ready.pid,0);return false;}catch{return true;}});
      record=await readInstallation();const rootData={root:installRoot,executable};fs.writeFileSync(operationFile,JSON.stringify(rootData));
      const running=Number(ps(`$p=Get-Content -Raw -Encoding UTF8 -LiteralPath '${operationFile.replaceAll("'","''")}'|ConvertFrom-Json;@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $p.executable}).Count`));
      if(restartCase==='baseline-no-process'){assert.equal(running,0);assert.equal(record.version,version);assert(!fs.existsSync(path.join(pending.attempt,'completion.json')));assert.equal(await shaFile(path.join(outcome.backup,'resources','app.asar')),originalAsarHash);report.baselineGap={helperVersion:'0.5.41',sourceCommit:'b206eb5f0aa0b56098b219f0f4b95879a893d356',successfulLauncherResponseInjected:true,installedWithoutNewProcessOrRecovery:true};checks.push('Actual historical v41 IPC and worker installs genuine next candidate but exits installed with no process/recovery when launcher success without process is injected');}
      else if(restartCase==='no-process'){assert.equal(outcome.message,'updated-app-restart-not-confirmed');assert.equal(outcome.restored,true);assert.equal(outcome.restorationDeferred,false);assert.equal(record.version,oldVersion);assert.equal(await shaFile(path.join(installRoot,'resources','app.asar')),originalAsarHash);await until(()=>Number(ps(`$p=Get-Content -Raw -Encoding UTF8 -LiteralPath '${operationFile.replaceAll("'","''")}'|ConvertFrom-Json;@(Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq $p.executable}).Count`))>0);checks.push('Current worker detects no new process after shortened test deadline, restores original complete root/registration/shortcuts/cache and reopens old application');}
      else{assert.equal(outcome.message,'updated-app-restart-not-confirmed');assert.equal(outcome.restored,false);assert.equal(outcome.restorationDeferred,true);assert(running>0);assert.equal(record.version,version);assert.equal(await shaFile(path.join(outcome.backup,'resources','app.asar')),originalAsarHash);checks.push('Live next candidate with withheld confirmation remains running, current installation is not moved and complete old recovery copy is retained');}
      const retained=JSON.parse(fs.readFileSync(path.join(profile,'state.json'),'utf8'));assert.equal(retained.resume.education[0].school,before.resume.education[0].school);assert.ok(retained.settings.apiToken===before.settings.apiToken);assert.equal(await shaFile(attachment),attachmentHash);
      if(restartCase!=='baseline-no-process'){const actual=await until(async()=>{try{return await(await fetch(`http://127.0.0.1:${retained.settings.apiPort}/v1/status`,{headers:{Authorization:'Bearer '+retained.settings.apiToken}})).json();}catch{return false;}});assert.equal(actual.version,restartCase==='no-process'?oldVersion:version);}
      checks.push('Real profile, credential and attachment bytes retained; live or restored process authenticated version verified when applicable');report.ok=true;return;
    }
    const result = await until(() => {
      if (!fs.existsSync(resultFile)) return false;
      const item = JSON.parse(fs.readFileSync(resultFile, 'utf8').replace(/^\uFEFF/, ''));
      if (item.status === 'failed') throw Error(`Actual upgrade failed: ${item.message}; restored=${item.restored}`);
      return item.status === 'restarted' ? item : false;
    });
    assert.equal(result.version, version); assert.equal(result.runningVersion, version); assert.equal(path.resolve(result.runningExe), executable);
    if(restartCase==='confirmed'){await until(()=>fs.existsSync(path.join(pending.attempt,'completion.json')));const complete=JSON.parse(fs.readFileSync(path.join(pending.attempt,'completion.json'),'utf8'));assert.equal(complete.status,'restarted');assert.equal(complete.nonce,pending.nonce);checks.push('Current worker stays alive until real candidate confirms visible matching restart and then records completion');}
    record = await readInstallation(); assert.equal(record.version, version); assert.equal(record.desktop, desktop);
    checks.push('Ready/commit helper performed real NSIS cross-version upgrade and new visible app confirmed restart');
    const state = JSON.parse(fs.readFileSync(path.join(profile, 'state.json'), 'utf8'));
    assert.equal(state.resume.education[0].school, before.resume.education[0].school);
    assert.equal(state.settings.apiToken, before.settings.apiToken);
    assert.equal(await shaFile(attachment), attachmentHash);
    const headers = { Authorization: `Bearer ${state.settings.apiToken}` };
    const status = await (await fetch(`http://127.0.0.1:${state.settings.apiPort}/v1/status`, { headers })).json();
    assert.equal(status.version, version); assert.equal(status.ok, true);
    const resume = await (await fetch(`http://127.0.0.1:${state.settings.apiPort}/v1/resume`, { headers })).json();
    assert.equal(resume.resume.education[0].school, '升级保留验收大学');
    checks.push('Restarted actual candidate served retained resume over authenticated API; token and attachment preserved');
    // Stop only the test installation executable, then reopen through Playwright
    // to inspect persisted cookie and actual candidate DOM.
    ps(`$p=Get-Content -Raw -LiteralPath '${operationFile.replaceAll("'", "''")}'|ConvertFrom-Json;Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq '${executable.replaceAll("'", "''")}' -and $_.CommandLine -notlike '*--type=*'}|ForEach-Object {Stop-Process -Id $_.ProcessId -Force}`);
    await delay(1000);
    application = await electron.launch({ executablePath: executable, args: [`--user-data-dir=${profile}`], env: { ...process.env, YIJIAN_BACKGROUND_TEST: '0' } });
    const reopened = await application.firstWindow(); await reopened.locator('.hero-card').waitFor();
    assert.equal(await reopened.locator('#appVersion').textContent(), version);
    await reopened.locator('.sidebar [data-page="resume"]').click();
    assert.equal(await reopened.locator('[name="education.0.school"]').inputValue(), '升级保留验收大学');
    const cookie = await application.evaluate(({ session }) => session.fromPartition('persist:delivery-upgrade-fixture').cookies.get({ name: 'retention-fixture' }));
    assert.equal(cookie[0].value, 'local-fixture-only');
    checks.push('Candidate reopened with retained resume DOM and persistent cookie fixture');
    await application.close(); application = null;
    report.ok = true;
  } catch (error) { report.error = error.message; throw error; }
  finally {
    await application?.close().catch(() => {});
    const record = await readInstallation();
    if (record && path.resolve(record.root) === installRoot) {
      const executable = path.join(installRoot, '一键投递.exe');
      ps(`Get-CimInstance Win32_Process|Where-Object {$_.ExecutablePath -eq '${executable.replaceAll("'", "''")}' -and $_.CommandLine -notlike '*--type=*'}|ForEach-Object {Stop-Process -Id $_.ProcessId -Force}`);
      await delay(1000);
      assert.equal(operation({ exe: path.join(installRoot, 'Uninstall 一键投递.exe'), arguments: '/S /currentuser' }), '0');
      await until(async () => (await readInstallation()) === null, 30000);
      assert.ok(fs.existsSync(path.join(profile, 'state.json')), 'Uninstall must retain profile');
      checks.push('Real uninstaller removed registration and retained isolated user profile');
    }
    for (const item of preserved) {
      if (item.existed) { fs.mkdirSync(path.dirname(item.file), { recursive: true }); fs.writeFileSync(item.file, item.bytes); }
      else if (fs.existsSync(item.file)) fs.unlinkSync(item.file);
      assert.equal(fs.existsSync(item.file), item.existed);
      if (item.existed) assert.deepEqual(fs.readFileSync(item.file), item.bytes);
    }
    checks.push('Original shortcuts and updater cache restored byte-for-byte');
    fs.writeFileSync(path.join(base, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ ok: report.ok, checks: checks.length, report: path.join(base, 'report.json'), error: report.error }));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
