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
  assert.match(appHtml, new RegExp(`一键投递 v${pkg.version.replace(/\./g, '\\.')}`));
  assert.ok(Number.isInteger(siteVersion.v) && siteVersion.v >= 3);
  assert.match(siteHtml, new RegExp(`var PAGE_V=${siteVersion.v};`));
  assert.ok(siteVersion.updated, 'version.json 应有 updated 日期');
});

test('介绍页不把待适配能力描述成全平台已完成', () => {
  const siteHtml = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  assert.equal(siteHtml.includes('确认后一键更新全平台'), false);
  assert.match(siteHtml, /腾讯.*用户确认/);
  assert.match(siteHtml, /六家.*岗位/);
});
