#!/usr/bin/env node
// 一键发布脚本：统一版本号、打包、生成 SHA256、提醒发布步骤。
// 用法：node scripts/release.cjs <新版本号>，如 node scripts/release.cjs 0.3.0
//
// 这个脚本解决「版本号散落在 4 处容易不一致」的问题（P2-5）：
// package.json / src/index.html / site/index.html / site/version.json

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('用法: node scripts/release.cjs <版本号>，如 node scripts/release.cjs 0.3.0');
  process.exit(1);
}

const files = {
  'package.json': (content) => content.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`),
  'skill/yijian-toudi/version.json': (content) => content.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`),
  'src/index.html': (content) => content
    .replace(/一键投递 v[\d.]+/g, `一键投递 v${newVersion}`)
    .replace(/<span id="(appVersion|aboutAppVersion)">[\d.]+<\/span>/g, (_,id) => `<span id="${id}">${newVersion}</span>`),
  'site/index.html': (content) => content
    .replace(/当前 v[\d.]+ /g, `当前 v${newVersion} `)
    .replace(/源码 v[\d.]+/g, `源码 v${newVersion}`)
};

console.log(`\n📦 准备发布 v${newVersion}\n`);

// Candidate preparation may be unconfigured; malformed/public-private mixed
// defaults must fail before any version write. Public publication is a separate
// required --check-public gate and is not inferred from this source bump.
const publicDefaultsPath = path.join(root, 'electron/public-defaults.json');
if (fs.existsSync(publicDefaultsPath)) require('../electron/public-defaults.cjs').readPublicDefaults(publicDefaultsPath);

// Prepare and validate every transformation before the first file write.
// A malformed optional log must not leave package/HTML/cache versions divergent.
const pending = new Map();
// 1. 更新版本号
for (const [file, transform] of Object.entries(files)) {
  const filePath = path.join(root, file);
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = transform(original);
  if (updated !== original) {
    pending.set(filePath, updated);
  }
}

// 2. version.json（site/version.json 的 v 字段 + updated 日期 + PAGE_V 递增）
const versionJsonPath = path.join(root, 'site/version.json');
const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
if (!Number.isSafeInteger(versionJson.v) || versionJson.v < 1) throw new Error('site page version is invalid');
const oldV = versionJson.v || 1;
versionJson.v = oldV + 1;
versionJson.updated = new Date().toISOString().slice(0, 10);
pending.set(versionJsonPath, JSON.stringify(versionJson, null, 2) + '\n');
// Keep the site's candidate log aligned, without rewriting historical facts or
// describing a source bump as a tested/public release. Older minimal projects
// may not have the log controller.
const logPath = path.join(root, 'site/page-state.js');
if (fs.existsSync(logPath)) {
  let code = fs.readFileSync(logPath, 'utf8');
  const match = code.match(/var logs\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!match) throw new Error('site candidate log structure changed');
  // Read the literal array only, not the controller or comments elsewhere in
  // the file. Existing log data remains byte-identical after insertion.
  const logs = vm.runInNewContext(`(${match[1]})`, Object.create(null), { timeout: 100 });
  if (!Array.isArray(logs) || logs.some(row => !row || typeof row.version !== 'string')) throw new Error('site candidate log data changed');
  const hasVersion = logs.some(row => row.version === newVersion);
  if (!hasVersion) {
    const entry = `{ version: '${newVersion}', date: '${versionJson.updated}', status: '源码开发候选，尚未公开', text: '源码版本已同步；功能与验收结果以项目文档为准，不代表已公开发布。' },`;
    code = code.replace(/var logs\s*=\s*\[/, `var logs = [\n    ${entry}`);
    pending.set(logPath, code);
  }
}
// site/index.html 的 PAGE_V 同步
const siteHtmlPath = path.join(root, 'site/index.html');
let siteHtml = pending.get(siteHtmlPath) || fs.readFileSync(siteHtmlPath, 'utf8');
siteHtml = siteHtml.replace(/var PAGE_V\s*=\s*\d+/, `var PAGE_V=${versionJson.v}`);
siteHtml = siteHtml.replace(/data-page-v="\d+"/, `data-page-v="${versionJson.v}"`);
pending.set(siteHtmlPath, siteHtml);
for (const [filePath, content] of pending) {
  fs.writeFileSync(filePath, content);
  console.log(`  ✓ ${path.relative(root, filePath)} 已同步`);
}
console.log(`  ✓ site/version.json (v=${versionJson.v}) 和 PAGE_V 已同步`);

console.log(`\n📝 接下来手动执行（脚本不自动跑，避免误操作）：\n`);
console.log(`  1. pnpm dist:win / pnpm dist:mac  # 按目标平台构建并实际安装验收`);
console.log(`  2. pnpm pack:skill       # 打包同版本 Skill + SHA256`);
console.log(`  3. 计算并写 release/一键投递-${newVersion}-SHA256.txt`);
console.log(`     公开前配置并构建反馈默认地址；node scripts/configure-feedback.cjs --check-public（不代替公网回执实测）`);
console.log(`  4. 核对工作树后提交、推送、打 v${newVersion} tag`);
console.log(`  5. 创建 draft Release v${newVersion}；手动工作流为已有 draft 准备 Skill`);
console.log(`  6. 上传桌面包 + Skill + SHA256 + 安装说明，下载回读校验后再 publish；published 工作流仅审计`);
console.log(`\n✅ 版本号已统一为 ${newVersion}，打包前请先 npm test 确认全过。\n`);
