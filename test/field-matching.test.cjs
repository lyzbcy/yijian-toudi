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

// ===== 腾讯校招真实字段回归（2026-08-24 实测采样）=====
const tencentFields = [
  { index: 7, label: '请填写您的手机号码 off el-input__inner', placeholder: '请填写您的手机号码', type: 'input:text' },
  { index: 8, label: '请输入邮箱地址 off el-input__inner 邮箱* 建议填写常用的QQ邮箱', placeholder: '请输入邮箱地址', type: 'input:text' },
  { index: 3, label: '请输入姓名 off el-input__inner 姓名*', placeholder: '请输入姓名', type: 'input:text' },
  { index: 4, label: '男 off el-radio__original 男 男 女 性别*', type: 'input:radio', controlValue: '男', value: '' },
  { index: 5, label: '女 off el-radio__original 女 男 女 性别*', type: 'input:radio', controlValue: '女', value: '' },
  { index: 24, label: '请输入面试城市 off el-input__inner 远程面试 参加面试城市*', placeholder: '请输入面试城市', type: 'input:text' }
];

test('腾讯 el 组件：去前缀后 placeholder 全等按强信号匹配（手机/邮箱/姓名）', () => {
  const phone = matchField({ key: 'basic.phone', value: '138', keywords: ['手机号', '手机号码', '手机', '电话'] }, tencentFields);
  assert.equal(phone.status, 'matched');
  assert.equal(phone.field.index, 7);
  const email = matchField({ key: 'basic.email', value: 'a@b.c', keywords: ['邮箱', 'email', '电子邮件'] }, tencentFields);
  assert.equal(email.status, 'matched');
  assert.equal(email.field.index, 8);
  const name = matchField({ key: 'basic.name', value: '张三', keywords: ['姓名', 'name'] }, tencentFields);
  assert.equal(name.status, 'matched');
  assert.equal(name.field.index, 3);
});

test('radio：控件值与期望一致且含关键词才强匹配，「男」选项命中性别', () => {
  const gender = matchField({ key: 'basic.gender', value: '男', keywords: ['性别', 'gender'] }, tencentFields);
  assert.equal(gender.status, 'matched');
  assert.equal(gender.field.index, 4);
});

test('「面试城市」不会误匹配 basic.city（城市类歧义防护仍然生效）', () => {
  const city = matchField({ key: 'basic.city', value: '苏州市', keywords: ['城市', '现居城市', '所在城市'] }, tencentFields);
  assert.notEqual(city.status, 'matched');
});

test('file 输入框不参与文本字段匹配（照片/附件走专门上传流程）', () => {
  const avatar = matchField({ key: 'basic.avatarUrl', value: '/tmp/x.png', keywords: ['照片', '证件照', '头像'] }, [
    { index: 0, label: '点击上传 照片大小请控制在300KB以内', type: 'input:file' }
  ]);
  assert.equal(avatar.status, 'unmatched');
});
