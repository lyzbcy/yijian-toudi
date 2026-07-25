const test = require('node:test');
const assert = require('node:assert/strict');
const { settleCart } = require('../electron/review-state.cjs');

test('只有明确提交成功的岗位移入已投递', () => {
  const cart = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const results = [
    { id: 'a', status: 'submitted', message: '成功' },
    { id: 'b', status: 'review-required', message: '待确认' },
    { id: 'c', status: 'failed', message: '失败' }
  ];

  const next = settleCart({
    cart,
    applied: [],
    results,
    today: '2026-07-25'
  });

  assert.deepEqual(next.cart.map((job) => job.id), ['b', 'c']);
  assert.deepEqual(next.applied.map((job) => job.id), ['a']);
  assert.equal(next.cart[0].applyStatus, '待确认');
  assert.equal(next.cart[1].applyStatus, '失败');
});

test('没有执行结果的岗位按失败保留，已有投递记录不丢失', () => {
  const next = settleCart({
    cart: [{ id: 'a' }, { id: 'b' }],
    applied: [{ id: 'old' }],
    results: [{ id: 'a', status: 'submitted', message: '成功' }],
    today: '2026-07-25'
  });

  assert.deepEqual(next.cart.map((job) => job.id), ['b']);
  assert.equal(next.cart[0].applyStatus, '失败');
  assert.deepEqual(next.applied.map((job) => job.id), ['a', 'old']);
});
