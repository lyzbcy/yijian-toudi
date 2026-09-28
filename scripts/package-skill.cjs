#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const version = require(path.join(root, 'package.json')).version;
const skill = path.join(root, 'skill', 'yijian-toudi');
const skillVersion = require(path.join(skill, 'version.json')).version;
if (version !== skillVersion) throw new Error(`App ${version} != Skill ${skillVersion}`);
for (const file of ['SKILL.md', 'version.json', 'references/deploy.md', 'scripts/daily-boss.cjs']) {
  if (!fs.statSync(path.join(skill, file)).isFile()) throw new Error(`Missing ${file}`);
}
const output = path.join(root, 'release');
fs.mkdirSync(output, { recursive: true });
const archive = path.join(output, `yijian-toudi-skill-${version}.tar.gz`);
const result = spawnSync('tar', ['-czf', archive, '-C', path.join(root, 'skill'), 'yijian-toudi'], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(`tar failed: ${result.stderr || result.error?.message || result.status}`);
const hash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
const checksum = path.join(output, `yijian-toudi-skill-${version}.sha256`);
fs.writeFileSync(checksum, `${hash}  ${path.basename(archive)}\n`);
console.log(JSON.stringify({ version, archive, checksum, sha256: hash }));
