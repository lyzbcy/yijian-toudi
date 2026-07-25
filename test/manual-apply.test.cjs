const test = require('node:test');
const assert = require('node:assert/strict');
const { createManualPrepareApplication } = require('../electron/adapters/_manual-apply.cjs');

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
