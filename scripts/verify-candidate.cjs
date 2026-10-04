'use strict';
// Verify local review artifacts. This never publishes or declares readiness.
const fs = require('node:fs'), path = require('node:path');
const {auditAppAsar,sha:hash}=require('./audit-app-asar.cjs');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const archive = path.join(root, 'release/win-unpacked/resources/app.asar');
const audit=auditAppAsar(archive,root,version);
const artifacts = [`yijian-toudi-setup-${version}.exe`, `yijian-toudi-skill-${version}.tar.gz`, `yijian-toudi-feedback-server-${version}.tar.gz`].map(name => {
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
const report = { ok: true, ...audit, readiness: 'candidate-unpublished', artifacts, unmetGates: ['real-account-workflows', 'public-feedback-service', 'official-download-update', 'macOS-install-runtime', 'current-complete-demo', 'representative-bug-rate'] };
fs.writeFileSync(path.join(root, `verification/2026-10-04-recovery/candidate-manifest-v${version}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
