const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isUnsafeField,
  matchField,
  normalizeComparableValue
} = require('../electron/field-matching.cjs');

test('密码、验证码、提交和投递控件永远禁止自动填写', () => {
  for (const label of ['登录密码', '短信验证码', '提交申请', '立即投递', '申请职位']) {
    assert.equal(isUnsafeField({ label, type: 'text' }), true, label);
  }
  assert.equal(isUnsafeField({ label: '姓名', type: 'text' }), false);
});

test('精确 label 优先于模糊祖先文本', () => {
  const fields = [
    { index: 0, label: '联系信息 姓名 手机 邮箱', placeholder: '请输入', name: '', id: '', type: 'text' },
    { index: 1, label: '姓名', placeholder: '请输入姓名', name: 'name', id: 'name', type: 'text' }
  ];
  const result = matchField({ key: 'basic.name', keywords: ['姓名'], value: '张三' }, fields);
  assert.equal(result.status, 'matched');
  assert.equal(result.field.index, 1);
  assert.ok(result.confidence >= 0.72);
});

test('最高候选同分歧义时转人工，不凭 DOM 顺序乱填', () => {
  const fields = [
    { index: 0, label: '姓名', placeholder: '姓名', name: '', id: '', type: 'text' },
    { index: 1, label: '姓名', placeholder: '姓名', name: '', id: '', type: 'text' }
  ];
  const result = matchField({ key: 'basic.name', keywords: ['姓名'], value: '张三' }, fields);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.field, null);
});

test('弱相关候选低于阈值时转人工', () => {
  const fields = [{ index: 0, label: '个人信息', placeholder: '请输入内容', name: '', id: '', type: 'text' }];
  const result = matchField({ key: 'basic.email', keywords: ['邮箱', 'email'], value: 'a@example.com' }, fields);
  assert.equal(result.status, 'unmatched');
});

test('相近但语义不同的城市字段不允许靠包含关系自动填写', () => {
  const fields = [{ index: 0, label: '期望工作城市', placeholder: '请选择城市', type: 'select' }];
  const result = matchField({ key: 'basic.city', keywords: ['城市', '现居城市'], value: '杭州' }, fields);
  assert.equal(result.status, 'unmatched');
});

test('回读比较规范化空白和布尔值，但不允许前缀误判相等', () => {
  assert.equal(normalizeComparableValue('  张三\n') === normalizeComparableValue('张三'), true);
  assert.equal(normalizeComparableValue(true), '是');
  assert.notEqual(normalizeComparableValue('张三丰'), normalizeComparableValue('张三'));
});
