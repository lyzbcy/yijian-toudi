const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const failures = [];
const pass = (message) => console.log(`✓ ${message}`);
const fail = (message) => { failures.push(message); console.error(`✗ ${message}`); };

for (const file of ['electron/main.cjs', 'electron/preload.cjs', 'electron/store.cjs', 'electron/mail.cjs', 'electron/agent-server.cjs', 'src/app.js', 'scripts/site-preview.cjs']) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (result.status === 0) pass(`${file} 语法通过`);
  else fail(`${file} 语法错误：${result.stderr}`);
}

const appHtml = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
const siteHtml = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
// 介绍页与桌面界面共用 src/assets 这一份图片源
for (const [base, html, name] of [['src', appHtml, '桌面界面'], ['src', siteHtml, '介绍页']]) {
  const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/g)].map((match) => match[1]).filter((src) => !/^https?:/.test(src));
  for (const image of images) {
    if (!fs.existsSync(path.join(root, base, image))) fail(`${name} 图片缺失：${image}`);
  }
  if (!failures.some((item) => item.includes(`${name} 图片缺失`))) pass(`${name} 本地图片引用完整`);
}

const version = JSON.parse(fs.readFileSync(path.join(root, 'site/version.json'), 'utf8'));
const pageVersion = Number(siteHtml.match(/var PAGE_V\s*=\s*(\d+)/)?.[1]);
if (pageVersion === version.v) pass(`介绍页 PAGE_V 与 version.json 一致（${version.v}）`);
else fail(`介绍页版本不一致：PAGE_V=${pageVersion}, version.json=${version.v}`);

const formFields = [...appHtml.matchAll(/<(?:input|select|textarea)[^>]+name=["']([^"']+)["']/g)].map((match) => match[1]);
// 多段经历（教育/工作/项目）改成动态渲染后，HTML 里只剩全局字段；这三类的字段模板在 app.js 的 REPEATABLE_TEMPLATES。
// 静态检查改为：全局字段 ≥ 20 且三组「添加段」按钮都存在，即视为简历结构完整。
const addSegmentBtns = [...appHtml.matchAll(/data-add-segment=["']([^"']+)["']/g)].map((match) => match[1]);
const requiredGroups = ['education', 'experience', 'projects'];
const hasAllGroups = requiredGroups.every((g) => addSegmentBtns.includes(g));
if (formFields.length >= 20 && hasAllGroups) {
  pass(`统一简历表单包含 ${formFields.length} 个全局字段 + 3 组动态多段经历`);
} else {
  fail(`简历结构不完整：全局字段 ${formFields.length} 个，多段组 [${addSegmentBtns.join(',')}]`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (packageJson.build?.mac && packageJson.build?.win) pass('打包配置同时保留 macOS 与 Windows');
else fail('跨平台打包配置不完整');

if (failures.length) {
  console.error(`\n检查失败：${failures.length} 项`);
  process.exit(1);
}
console.log('\n项目静态检查全部通过。');
