#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { REQUIRED, unpack } = require('../skill/yijian-toudi/scripts/package-files.cjs');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const skill = path.join(root, 'skill', 'yijian-toudi');
const skillVersion = require(path.join(skill, 'version.json')).version;
if (version !== skillVersion) throw new Error(`App ${version} != Skill ${skillVersion}`);
for (const file of REQUIRED) {
  if (!fs.statSync(path.join(skill, file)).isFile()) throw new Error(`Missing ${file}`);
}
const output = path.join(root, 'release');
fs.mkdirSync(output, { recursive: true });
const archive = path.join(output, `yijian-toudi-skill-${version}.tar.gz`);
const checksum = path.join(output, `yijian-toudi-skill-${version}.sha256`);
const verify = (file, expectedVersion) => unpack(fs.readFileSync(file), expectedVersion);
if (process.argv[2] === '--verify') {
  const [, , , file, hashFile, expectedVersion] = process.argv;
  if (!file || !hashFile || !expectedVersion) throw new Error('Usage: --verify ARCHIVE CHECKSUM VERSION');
  const bytes = fs.readFileSync(file);
  const actual = crypto.createHash('sha256').update(bytes).digest('hex');
  const expected = fs.readFileSync(hashFile, 'utf8').trim().split(/\s+/)[0];
  if (actual !== expected) throw new Error('Skill archive checksum mismatch');
  const files = verify(file, expectedVersion);
  console.log(JSON.stringify({ verified: true, version: expectedVersion, sha256: actual, files: files.size }));
  process.exit(0);
}
if (process.argv.length > 2) throw new Error('Unknown packaging arguments');
if (fs.existsSync(archive)) {
  const previous = verify(archive, version);
  if (previous.size !== REQUIRED.length || REQUIRED.some(file => !previous.get(file)?.equals(fs.readFileSync(path.join(skill, file))))) {
    throw new Error('Existing version has different contents; increase the version before packaging');
  }
} else {
  const temporary = `${path.basename(archive)}.part-${process.pid}`;
  // Relative ASCII arguments also work with Windows tar and Git Bash tar.
  const result = spawnSync('tar', ['--format=ustar', '-czf', temporary, '-C', '../skill', ...REQUIRED.map(file => `yijian-toudi/${file}`)], { cwd: output, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`tar failed: ${result.stderr || result.error?.message || result.status}`);
  verify(path.join(output, temporary), version);
  fs.renameSync(path.join(output, temporary), archive);
}
const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const checksumText = `${hash}  ${path.basename(archive)}\n`;
if (fs.existsSync(checksum) && fs.readFileSync(checksum, 'utf8') !== checksumText) throw new Error('Existing checksum conflicts with immutable archive');
if (!fs.existsSync(checksum)) fs.writeFileSync(checksum, checksumText, { flag: 'wx' });
console.log(JSON.stringify({ version, archive, checksum, sha256: hash }));
