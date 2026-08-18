#!/usr/bin/env node
// 一键发布脚本：统一版本号、打包、生成 SHA256、提醒发布步骤。
// 用法：node scripts/release.cjs <新版本号>，如 node scripts/release.cjs 0.3.0
//
// 这个脚本解决「版本号散落在 4 处容易不一致」的问题（P2-5）：
// package.json / src/index.html / site/index.html / site/version.json

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+/.test(newVersion)) {
  console.error('用法: node scripts/release.cjs <版本号>，如 node scripts/release.cjs 0.3.0');
  process.exit(1);
}

const files = {
  'package.json': (content) => content.replace(/"version":\s*"[^"]+"/, `"version": "${newVersion}"`),
  'src/index.html': (content) => content
    .replace(/一键投递 v[\d.]+/g, `一键投递 v${newVersion}`)
    .replace(/<span id="appVersion">[\d.]+<\/span>/g, `<span id="appVersion">${newVersion}</span>`),
  'site/index.html': (content) => content
    .replace(/当前 v[\d.]+ /g, `当前 v${newVersion} `)
    .replace(/一键投递-[\d.]+-macOS-arm64\.zip/g, `一键投递-${newVersion}-macOS-arm64.zip`)
};

console.log(`\n📦 准备发布 v${newVersion}\n`);

// 1. 更新版本号
for (const [file, transform] of Object.entries(files)) {
  const filePath = path.join(root, file);
  const original = fs.readFileSync(filePath, 'utf8');
  const updated = transform(original);
  if (updated !== original) {
    fs.writeFileSync(filePath, updated);
    console.log(`  ✓ ${file} 版本号已更新`);
  }
}

// 2. version.json（site/version.json 的 v 字段 + updated 日期 + PAGE_V 递增）
const versionJsonPath = path.join(root, 'site/version.json');
const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
const oldV = versionJson.v || 1;
versionJson.v = oldV + 1;
versionJson.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(versionJsonPath, JSON.stringify(versionJson, null, 2) + '\n');
// site/index.html 的 PAGE_V 同步
const siteHtmlPath = path.join(root, 'site/index.html');
let siteHtml = fs.readFileSync(siteHtmlPath, 'utf8');
siteHtml = siteHtml.replace(/var PAGE_V\s*=\s*\d+/, `var PAGE_V=${versionJson.v}`);
fs.writeFileSync(siteHtmlPath, siteHtml);
console.log(`  ✓ site/version.json (v=${versionJson.v}) 和 PAGE_V 已同步`);

console.log(`\n📝 接下来手动执行（脚本不自动跑，避免误操作）：\n`);
console.log(`  1. pnpm dist:mac          # 打包 dmg + zip`);
console.log(`  2. 手算并写 release/一键投递-${newVersion}-SHA256.txt`);
console.log(`  3. git add -A && git commit -m "release: v${newVersion}"`);
console.log(`  4. 到 GitHub 创建 Release v${newVersion}，上传 zip + dmg + SHA256 + 安装说明`);
console.log(`  5. git push origin main   # 触发 GitHub Pages 更新介绍页`);
console.log(`\n✅ 版本号已统一为 ${newVersion}，打包前请先 npm test 确认全过。\n`);
