'use strict';
// Real packaged IPC/files/state round trip. Native file selection and warning
// responses are explicit fixtures; this does not verify native dialog clicking.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright-core');
const { JsonStore } = require('../electron/store.cjs');
const { auditAppAsar } = require('../scripts/audit-app-asar.cjs');

const root = path.resolve(__dirname, '..'), version = require('../package.json').version;
const output = fs.mkdtempSync(path.join(root, '.local-data', 'backup-ui-' + version + '-'));
const profile = path.join(output, 'profile'), exported = path.join(output, '备份样本.json');
const store = new JsonStore(profile); store.init();
store.update(state => {
  state.settings.kimiBridgeEnabled = false;
  state.settings.autoCheckUpdates = false;
  state.settings.jobs.autoRefresh = false;
  state.settings.apiEnabled = false;
  state.settings.email.encryptedCode = 'fixture-encrypted-value';
  state.meta.onboardingSeen = true;
  return state;
});
const executable = process.env.YJT_PACKAGED_EXECUTABLE || path.join(root, 'release', 'win-unpacked', '一键投递.exe');
const report = { ok: false, version, platform: process.platform, packaged: true,
  nativeDialogResponsesFixture: true, nativeDialogClicksVerified: false,
  realRecruitment: false, externalMessages: 0, checks: [], at: new Date().toISOString() };
let application, page;
const errors = [];
async function launch() {
  application = await electron.launch({ executablePath: executable, args: ['--user-data-dir=' + profile],
    env: { ...process.env, YIJIAN_BACKGROUND_TEST: '0' } });
  page = await application.firstWindow(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.hero-card').waitFor();
  assert.equal(await page.locator('#appVersion').textContent(), version);
}
async function close() { if (application) { await application.close(); application = null; } }
const state = () => page.evaluate(() => window.oneClick.getState());
async function school(value) {
  await page.locator('.sidebar [data-page="resume"]').click();
  await page.locator('[name="education.0.school"]').fill(value);
  await page.locator('#saveResumeButton').click();
  await page.waitForFunction(async expected => (await window.oneClick.getState()).resume.education[0].school === expected, value);
}
async function selectFile(file, confirmation, canceled = false) {
  await application.evaluate(({ dialog }, options) => {
    dialog.showSaveDialog = async () => ({ canceled: options.canceled, filePath: options.file });
    dialog.showOpenDialog = async () => ({ canceled: options.canceled, filePaths: options.canceled ? [] : [options.file] });
    dialog.showMessageBox = async (_window, message) => {
      if (message.title !== '确认恢复备份' || !message.detail.includes('自动保存')) throw Error('Unexpected native confirmation');
      return { response: options.confirmation };
    };
  }, { file, confirmation, canceled });
}

(async () => {
  report.asar = auditAppAsar(path.join(path.dirname(executable), 'resources', 'app.asar'), root, version);
  await launch();
  await school('备份大学（样本）');
  const original = await state();
  await selectFile(exported, 0);
  await page.locator('.sidebar [data-page="settings"]').click();
  await page.locator('#backupExportButton').click();
  await page.waitForFunction(() => !document.querySelector('#backupExportButton').disabled);
  const backup = JSON.parse(fs.readFileSync(exported, 'utf8'));
  assert.equal(backup.appVersion, version);
  assert.equal(backup.data.resume.education[0].school, '备份大学（样本）');
  assert.equal(backup.data.settings.apiToken, undefined);
  assert.equal(backup.data.settings.email.encryptedCode, undefined);
  assert.equal(backup.data.idempotency, undefined);
  report.checks.push('Actual visible export button writes versioned JSON through packaged IPC and excludes Agent Token/email encrypted authorization/idempotency');

  await school('恢复前大学（样本）');
  const changed = await state();
  await page.locator('.sidebar [data-page="settings"]').click();
  await selectFile(exported, 0, true);
  assert.equal((await page.evaluate(() => window.oneClick.restoreBackup())).canceled, true);
  await selectFile(exported, 0);
  assert.equal((await page.evaluate(() => window.oneClick.restoreBackup())).canceled, true);
  assert.deepEqual(await state(), changed);
  assert.equal(fs.existsSync(path.join(profile, 'backups')), false);
  report.checks.push('Actual restore IPC canceled at file selection or confirmation preserves all state and creates no automatic backup');

  const broken = path.join(output, '损坏样本.json'); fs.writeFileSync(broken, '{');
  await selectFile(broken, 1);
  const rejection = await page.evaluate(() => window.oneClick.restoreBackup().then(() => false, () => true));
  assert.equal(rejection, true);
  assert.deepEqual(await state(), changed);
  assert.equal(fs.existsSync(path.join(profile, 'backups')), false);
  report.checks.push('Malformed selected JSON is rejected by actual packaged IPC before replacing state or creating a restore backup');

  // Attempt to import credentials: the restore handler must keep local values.
  backup.data.settings.apiToken = 'fixture-import-token';
  backup.data.settings.email.encryptedCode = 'fixture-import-code';
  const imported = path.join(output, '恢复样本.json'); fs.writeFileSync(imported, JSON.stringify(backup));
  await selectFile(imported, 1);
  await page.locator('#backupRestoreButton').click();
  await page.waitForFunction(async () => (await window.oneClick.getState()).resume.education[0].school === '备份大学（样本）');
  await page.waitForFunction(() => !document.querySelector('#backupRestoreButton').disabled);
  const restored = await state();
  assert.equal(restored.settings.apiToken, original.settings.apiToken);
  assert.equal(restored.settings.email.encryptedCode, original.settings.email.encryptedCode);
  const automatic = fs.readdirSync(path.join(profile, 'backups'));
  assert.equal(automatic.length, 1);
  const prior = JSON.parse(fs.readFileSync(path.join(profile, 'backups', automatic[0]), 'utf8'));
  assert.equal(prior.data.resume.education[0].school, '恢复前大学（样本）');
  assert.equal(prior.data.settings.apiToken, undefined);
  assert.equal(prior.data.settings.email.encryptedCode, undefined);
  await page.locator('.sidebar [data-page="resume"]').click();
  assert.equal(await page.locator('[name="education.0.school"]').inputValue(), '备份大学（样本）');
  report.checks.push('Actual visible restore button replaces resume, preserves local credentials despite imported values and writes one credential-free automatic pre-restore backup with original data');

  await close(); await launch();
  await page.locator('.sidebar [data-page="resume"]').click();
  assert.equal(await page.locator('[name="education.0.school"]').inputValue(), '备份大学（样本）');
  assert.equal((await state()).settings.apiToken, original.settings.apiToken);
  assert.equal((await state()).settings.email.encryptedCode, original.settings.email.encryptedCode);
  await page.screenshot({ path: path.join(output, 'restored-reopened.png') });
  assert.deepEqual(errors, []);
  report.checks.push('Real process cold reopen keeps restored resume and original private credential values with zero renderer errors');
  report.ok = true;
})().catch(error => { report.error = error.message; process.exitCode = 1; }).finally(async () => {
  await close(); report.pageErrors = errors;
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, ok: report.ok, checks: report.checks.length, error: report.error }));
});
