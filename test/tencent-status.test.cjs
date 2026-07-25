const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeTencentApplicationStatus } = require('../electron/adapters/tencent-status.cjs');

test('mergeTencentApplicationStatus 按 postId 匹配并更新状态', () => {
  const applied = [
    { id: 'tencent-123', companyId: 'tencent', title: '前端 A', applyStatus: '已投递' },
    { id: 'tencent-456', companyId: 'tencent', title: '后端 B', applyStatus: '已投递' },
    { id: 'tencent-campus-789', companyId: 'tencent', title: '校招 C', applyStatus: '已投递' },
    { id: 'baidu-001', companyId: 'baidu', title: '百度岗', applyStatus: '已投递' }
  ];
  const records = [
    { postId: '123', title: '前端 A', status: '面试中', lastUpdate: '2026-07-25' },
    { postId: '789', title: '校招 C', status: 'Offer', lastUpdate: '2026-07-24' }
  ];
  const result = mergeTencentApplicationStatus(applied, records);
  const a = result.find((j) => j.id === 'tencent-123');
  const b = result.find((j) => j.id === 'tencent-456');
  const c = result.find((j) => j.id === 'tencent-campus-789');
  const d = result.find((j) => j.id === 'baidu-001');
  assert.equal(a.applyStatus, '面试中');
  assert.equal(a.lastStatusUpdate, '2026-07-25');
  assert.equal(a.statusSource, 'tencent');
  assert.equal(c.applyStatus, 'Offer'); // 校招前缀 tencent-campus- 也要正确提取 postId
  // 没匹配到的保持原状
  assert.equal(b.applyStatus, '已投递');
  assert.equal(b.statusSource, undefined);
  assert.equal(d.applyStatus, '已投递'); // 非腾讯的不受影响
});

test('mergeTencentApplicationStatus 空 records 不改变 applied', () => {
  const applied = [{ id: 'tencent-1', applyStatus: '已投递' }];
  const result = mergeTencentApplicationStatus(applied, []);
  assert.equal(result[0].applyStatus, '已投递');
});
