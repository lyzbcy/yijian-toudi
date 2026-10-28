#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { REQUIRED, unpack, sha } = require('../skill/yijian-toudi/scripts/package-files.cjs');
const { checksumFor } = require('../skill/yijian-toudi/scripts/release-source.cjs');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const skill = path.join(root, 'skill', 'yijian-toudi');
const skillVersion = require(path.join(skill, 'version.json')).version;
if (version !== skillVersion) throw new Error(`App ${version} != Skill ${skillVersion}`);
if (process.argv[2] === '--verify') {
  const [archive, checksum, expectedVersion] = process.argv.slice(3);
  if (expectedVersion !== version || fs.statSync(archive).size > 8*1024*1024 || fs.statSync(checksum).size > 4096) throw new Error('release-verification-input');
  const data = fs.readFileSync(archive), expected = checksumFor(fs.readFileSync(checksum), `yijian-toudi-skill-${version}.tar.gz`);
  if (sha(data) !== expected) throw new Error('release-verification-sha');
  const files = unpack(data, version);
  console.log(JSON.stringify({ verified:true, version, sha256:expected, files:files.size }));
  process.exit(0);
}
for (const file of REQUIRED) {
  if (!fs.statSync(path.join(skill, file)).isFile()) throw new Error(`Missing ${file}`);
}
const output = path.join(root, 'release');
fs.mkdirSync(output, { recursive: true });
const archive = path.join(output, `yijian-toudi-skill-${version}.tar.gz`);
if (fs.existsSync(archive)) throw new Error(`Immutable archive already exists: ${archive}`);
// Relative paths also work with Git Bash GNU tar on Windows: an absolute E:
// archive is otherwise interpreted as a remote host, not a local output file.
const result = spawnSync('tar', ['-czf', path.basename(archive), '-C', path.relative(output, path.join(root, 'skill')).split(path.sep).join('/'), 'yijian-toudi'], { cwd: output, encoding: 'utf8' });
if (result.status !== 0) throw new Error(`tar failed: ${result.stderr || result.error?.message || result.status}`);
const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
unpack(fs.readFileSync(archive), version);
const checksum = path.join(output, `yijian-toudi-skill-${version}.sha256`);
fs.writeFileSync(checksum, `${hash}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({ version, archive, checksum, sha256: hash }));
