const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('v0.2.0 在应用、介绍页和缓存版本中保持一致', () => {
  const pkg = require('../package.json');
  const appHtml = fs.readFileSync(path.join(root, 'src/index.html'), 'utf8');
  const siteHtml = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  const siteVersion = JSON.parse(
    fs.readFileSync(path.join(root, 'site/version.json'), 'utf8')
  );

  assert.equal(pkg.version, '0.2.0');
  assert.match(appHtml, /一键投递 v0\.2\.0/);
  assert.equal(siteVersion.v, 2);
  assert.match(siteHtml, /var PAGE_V=2;/);
  assert.equal(siteVersion.updated, '2026-07-25');
});

test('介绍页不把待适配能力描述成全平台已完成', () => {
  const siteHtml = fs.readFileSync(path.join(root, 'site/index.html'), 'utf8');
  assert.equal(siteHtml.includes('确认后一键更新全平台'), false);
  assert.match(siteHtml, /腾讯.*用户确认/);
  assert.match(siteHtml, /六家.*岗位/);
});
