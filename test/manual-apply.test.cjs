const test = require('node:test');
const assert = require('node:assert/strict');
const { createManualPrepareApplication } = require('../electron/adapters/_manual-apply.cjs');
const { createManualFillResume, RESUME_URLS, isCampusRecruit } = require('../electron/adapters/_manual-fill.cjs');

test('createManualPrepareApplication 打开详情页并返回 manual-required', async () => {
  const opened = [];
  const workspace = {
    async openWorkspace(opts) { opened.push(opts); }
  };
  const steps = [];
  const prepare = createManualPrepareApplication('字节跳动');
  const result = await prepare(
    { id: 'bytedance-1', title: '前端', url: 'https://jobs.bytedance.com/experienced/position/1/detail' },
    { workspace, company: { id: 'bytedance', name: '字节跳动' }, onStep: (i) => steps.push(i) }
  );
  assert.equal(result.status, 'manual-required');
  assert.equal(result.ok, true);
  assert.match(result.message, /字节跳动岗位详情页/);
  assert.equal(opened[0].mode, 'application-review');
  assert.equal(opened[0].url, 'https://jobs.bytedance.com/experienced/position/1/detail');
});

test('createManualPrepareApplication 缺 url 时返回 manual-required 不打开', async () => {
  const opened = [];
  const workspace = { async openWorkspace(opts) { opened.push(opts); } };
  const prepare = createManualPrepareApplication('京东');
  const result = await prepare(
    { id: 'jd-1', title: 'X', url: '' },
    { workspace, company: { id: 'jd', name: '京东' } }
  );
  assert.equal(result.status, 'manual-required');
  assert.equal(result.ok, false);
  assert.equal(opened.length, 0);
});

test('createManualPrepareApplication 非法 url 拒绝打开', async () => {
  const prepare = createManualPrepareApplication('美团');
  const result = await prepare(
    { id: 'm-1', url: 'javascript:alert(1)' },
    { workspace: { async openWorkspace() {} }, company: { id: 'meituan', name: '美团' } }
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /缺少详情页链接/);
});

test('createManualPrepareApplication 拒绝把跨域 HTTPS 岗位页装进公司登录会话', async () => {
  let opened = false;
  const prepare = createManualPrepareApplication('字节跳动');
  const result = await prepare(
    { id: 'bytedance-evil', url: 'https://evil.example/phish' },
    { workspace: { async openWorkspace() { opened = true; } }, company: { id: 'bytedance', name: '字节跳动' } }
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /不属于字节跳动官网/);
  assert.equal(opened, false);
});

// 社招/校招简历页路由：2026-07-26 录制实测后接入。manual fill 按 recruitType 选页。
test('createManualFillResume 校招模式打开校招简历页', async () => {
  const opened = [];
  const workspace = { async openWorkspace(opts) { opened.push(opts); } };
  const fill = createManualFillResume('bytedance', '字节跳动');
  const result = await fill(
    { basic: { name: '张三' } },
    { workspace, company: { id: 'bytedance', name: '字节跳动' }, recruitType: 'campus' }
  );
  assert.equal(result.status, 'manual-required');
  assert.equal(opened[0].url, RESUME_URLS.campus.bytedance);
  assert.match(opened[0].title, /校招/);
  assert.equal(opened[0].context.recruitType, 'campus');
});

test('createManualFillResume 社招模式（默认）打开社招简历页', async () => {
  const opened = [];
  const workspace = { async openWorkspace(opts) { opened.push(opts); } };
  const fill = createManualFillResume('bytedance', '字节跳动');
  // 不传 recruitType，验证默认 social 不回归
  await fill(
    { basic: { name: '张三' } },
    { workspace, company: { id: 'bytedance', name: '字节跳动' } }
  );
  assert.equal(opened[0].url, RESUME_URLS.social.bytedance);
  assert.match(opened[0].title, /社招/);
});

test('isCampusRecruit 识别三种校招方向', () => {
  assert.equal(isCampusRecruit('campus'), true);
  assert.equal(isCampusRecruit('summer-intern'), true);
  assert.equal(isCampusRecruit('daily-intern'), true);
  assert.equal(isCampusRecruit('social'), false);
  assert.throws(() => isCampusRecruit('all'), /拆分/);
});
