const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('应用版本号在应用、介绍页和缓存版本中保持一致', () => {
  const pkg = require('../package.json');
  const appHtml = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const siteHtml = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  const siteVersion = JSON.parse(
    fs.readFileSync(path.join(root, 'site/version.json'), 'utf8')
  );

  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.match(appHtml, new RegExp(`一键投递 v(?:<span[^>]+>)?${pkg.version.replace(/\./g, '\\.')}`));
  assert.ok(Number.isInteger(siteVersion.v) && siteVersion.v >= 3);
  assert.match(siteHtml, new RegExp(`var PAGE_V=${siteVersion.v};`));
  assert.ok(siteVersion.updated, 'version.json 应有 updated 日期');
});

test('介绍页不把待适配能力描述成全平台已完成', () => {
  const siteHtml = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  assert.equal(siteHtml.includes('确认后一键更新全平台'), false);
  assert.match(siteHtml, /腾讯.*用户确认/);
  assert.match(siteHtml, /多平台岗位筛选/);
  assert.match(siteHtml, /上方卡片为界面示例/);
  assert.equal((siteHtml.match(/<em>演示<\/em>/g)||[]).length,3);
  assert.doesNotMatch(siteHtml, /<em>真实<\/em>|六家岗位已验证/);
});

test('介绍页首屏与安装说明的源码版本均来自当前开发候选', () => {
  const current = require('../package.json').version;
  const html = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  const versions = [...html.matchAll(/源码\s+v(\d+\.\d+\.\d+)/g)].map(m => m[1]);
  assert.deepEqual(versions, [current, current]);
});
