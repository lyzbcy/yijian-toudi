'use strict';
// Verify local review artifacts. This never publishes or declares readiness.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const builder = path.dirname(require.resolve('electron-builder'));
const lib = path.dirname(require.resolve('app-builder-lib', { paths: [builder] }));
const asar = require(require.resolve('@electron/asar', { paths: [lib] }));
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const version = require('../package.json').version;
const archive = path.join(root, 'release/win-unpacked/resources/app.asar');
const packaged = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(packaged.version, version);
const entries = asar.listPackage(archive).map(name => name.replaceAll('\\', '/'));
assert.deepEqual(entries.filter(name => !/^\/(electron|src|node_modules)(\/|$)/.test(name) && name !== '/package.json'), []);
assert.deepEqual(entries.filter(name => /(^|\/)(state\.json|feedback-outbox\.json|\.env|test-output|verification|\.git)(\/|$)/.test(name)), []);
let ownFiles = 0;
const embeddedSecrets = /sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[a-f0-9-]{15,}/;
for (const entry of entries.filter(name => /^\/(electron|src)\//.test(name))) {
  const relative = entry.slice(1), original = path.join(root, relative);
  if (!fs.existsSync(original) || !fs.statSync(original).isFile()) continue;
  const bytes = asar.extractFile(archive, path.normalize(relative));
  assert.equal(hash(bytes), hash(fs.readFileSync(original)), `Packaged source mismatch: ${relative}`);
  if (/\.(cjs|js|json|ps1|html|css)$/.test(relative)) assert.equal(embeddedSecrets.test(bytes.toString('utf8')), false, `Embedded private key pattern: ${relative}`);
  ownFiles++;
}
const artifacts = [`yijian-toudi-setup-${version}.exe`, `yijian-toudi-skill-${version}.tar.gz`].map(name => {
  const bytes = fs.readFileSync(path.join(root, 'release', name));
  return { name, bytes: bytes.length, sha256: hash(bytes) };
});
const setup = artifacts[0];
fs.writeFileSync(path.join(root, 'release', setup.name.replace('.exe', '.sha256')), `${setup.sha256}  ${setup.name}\n`);
const launcherFile = path.join(root, 'launcher-adapter.json');
const launcher = JSON.parse(fs.readFileSync(launcherFile));
launcher.version = version;
launcher.summary = '本地求职工作台；Windows 交付候选，完整验收仍在进行。';
launcher.package = { type: 'installer', path: `release/${setup.name}`, url: null, sha256: setup.sha256 };
launcher.releaseStatus = 'candidate-unpublished';
launcher.notes = '当前包已本机校验；公网URL须在真实上传并下载回读后填写。历史视频不计为当前完整演示。';
fs.writeFileSync(launcherFile, JSON.stringify(launcher, null, 2) + '\n');
const report = { ok: true, version, readiness: 'candidate-unpublished', ownFilesMatched: ownFiles, asarEntries: entries.length, noPrivateDataFiles: true, noKnownKeyPatterns: true, artifacts, unmetGates: ['real-account-workflows', 'public-feedback-service', 'official-download-update', 'macOS-install-runtime', 'current-complete-demo', 'representative-bug-rate'] };
fs.writeFileSync(path.join(root, 'verification/2026-10-04-recovery/candidate-manifest.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
