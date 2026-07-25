const test = require('node:test');
const assert = require('node:assert/strict');
const {
  settleCart,
  applyResultToCart,
  isSubmissionSuccess,
  validateCartRules
} = require('../electron/review-state.cjs');

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

test('单个岗位待确认时保留整个队列，只更新当前岗位', () => {
  const next = applyResultToCart({
    cart: [{ id: 'a' }, { id: 'b' }],
    applied: [],
    result: {
      id: 'a',
      status: 'review-required',
      message: '等待用户确认'
    },
    today: '2026-07-25'
  });

  assert.deepEqual(next.cart.map((job) => job.id), ['a', 'b']);
  assert.equal(next.cart[0].applyStatus, '待确认');
  assert.deepEqual(next.applied, []);
});

test('单个岗位明确成功后才从购物车移入已投递', () => {
  const next = applyResultToCart({
    cart: [{ id: 'a' }, { id: 'b' }],
    applied: [],
    result: {
      id: 'a',
      status: 'submitted',
      message: '提交成功'
    },
    today: '2026-07-25'
  });

  assert.deepEqual(next.cart.map((job) => job.id), ['b']);
  assert.deepEqual(next.applied.map((job) => job.id), ['a']);
});

test('只有明确的页面成功文案才判定为已提交', () => {
  assert.equal(isSubmissionSuccess({ text: '申请成功，感谢您的投递' }), true);
  assert.equal(isSubmissionSuccess({ text: '请确认信息后提交申请' }), false);
  assert.equal(isSubmissionSuccess({ text: '提交失败，请稍后重试' }), false);
});

test('购物车超过公司的投递上限时阻止启动', () => {
  const companies = [{
    id: 'tencent',
    name: '腾讯',
    applyRule: {
      maxActive: 3,
      note: '腾讯 7 天内最多投递 3 个岗位'
    }
  }];
  const blocked = validateCartRules({
    cart: ['1', '2', '3', '4'].map((id) => ({ id, companyId: 'tencent' })),
    companies
  });
  const allowed = validateCartRules({
    cart: ['1', '2', '3'].map((id) => ({ id, companyId: 'tencent' })),
    companies
  });

  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /最多投递 3 个/);
  assert.deepEqual(allowed, { ok: true });
});
