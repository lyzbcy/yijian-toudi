const test = require('node:test');
const assert = require('node:assert/strict');

const {
  planGenericResumeFields,
  buildExecuteFieldPlanScript,
  summarizeGenericVerification,
  mergeExecutionWithInspection,
  createGenericResumeFill
} = require('../electron/adapters/generic-resume-fill.cjs');

test('通用填表只执行高置信唯一匹配，歧义字段进入 manual', () => {
  const plan = [
    { key: 'basic.name', value: '张三', keywords: ['姓名'] },
    { key: 'basic.email', value: 'a@example.com', keywords: ['邮箱', 'email'] }
  ];
  const fields = [
    { index: 0, label: '姓名', placeholder: '请输入姓名', name: 'name', type: 'input:text' },
    { index: 1, label: '邮箱', placeholder: '邮箱', name: 'email1', type: 'input:text' },
    { index: 2, label: '邮箱', placeholder: '邮箱', name: 'email2', type: 'input:text' }
  ];
  const result = planGenericResumeFields(plan, fields);
  // 两个「邮箱」是同构槽位（多段经历的相同字段），高置信时取第一个而非转人工
  assert.deepEqual(result.writable.map((item) => item.key), ['basic.name', 'basic.email']);
  assert.deepEqual(result.manual.map((item) => item.key), []);
  // 真歧义（同分但占位符不同的两个字段）仍然转人工
  const ambiguous = planGenericResumeFields(
    [{ key: 'basic.email', value: 'a@b.c', keywords: ['邮箱'] }],
    [
      { index: 0, label: '邮箱 常用', placeholder: '常用邮箱', type: 'input:text' },
      { index: 1, label: '邮箱 备用', placeholder: '备用邮箱', type: 'input:text' }
    ]
  );
  assert.equal(ambiguous.manual[0]?.reason, 'ambiguous');
});

test('执行脚本禁止 submit/apply/click 且文本写入前会清空旧值', () => {
  const script = buildExecuteFieldPlanScript([
    { key: 'basic.name', value: '张三', fieldIndex: 0, fieldType: 'input:text' }
  ]);
  assert.doesNotMatch(script, /\.click\s*\(/);
  assert.doesNotMatch(script, /\.submit\s*\(/);
  assert.doesNotMatch(script, /apply\s*\(/i);
  assert.match(script, /setter\.call\(control, ''\)/);
  assert.match(script, /setter\.call\(control, value\)/);
  assert.doesNotMatch(script, /controls\[item\.fieldIndex\]/);
});

test('无 id/name 但标签精确的控件用同页序号定位（美团 mtd / 腾讯 el 组件），回读核验兜底', () => {
  const result = planGenericResumeFields(
    [{ key: 'basic.name', value: '张三', keywords: ['姓名'] }],
    [{ index: 0, label: '姓名', type: 'input:text' }]
  );
  assert.equal(result.writable.length, 1);
  assert.deepEqual(result.writable[0].locator, { kind: 'index', value: 0 });
  // 序号定位脚本必须复刻 INSPECT_FORM_FIELDS 的控件筛选，保证序号对齐
  const script = buildExecuteFieldPlanScript(result.writable);
  assert.match(script, /inspectControls/);
});

test('复选框按 checked 语义写入，不当文本 value 处理', () => {
  const script = buildExecuteFieldPlanScript([
    { key: 'intention.acceptAdjustment', value: '是', fieldIndex: 3, fieldType: 'input:checkbox' }
  ]);
  assert.match(script, /checkedSetter/);
  assert.match(script, /normalized === '是'/);
});

test('单选题选择与答案相符的选项并勾选，绝不把“否”实现成取消勾选', () => {
  const plan = [{ key: 'compliance.previouslyInterviewed', value: '否', keywords: ['曾被面试'] }];
  const fields = [
    { index: 0, id: 'interviewed-yes', label: '曾被面试 是', name: 'interviewed', type: 'input:radio', controlValue: '是' },
    { index: 1, id: 'interviewed-no', label: '曾被面试 否', name: 'interviewed', type: 'input:radio', controlValue: '否' }
  ];
  const result = planGenericResumeFields(plan, fields);
  assert.equal(result.writable[0].fieldIndex, 1);
  const script = buildExecuteFieldPlanScript(result.writable);
  assert.match(script, /checkedSetter\.call\(control, true\)/);
  assert.doesNotMatch(script, /checkedSetter\.call\(control, checked\)/);
  assert.match(script, /control\.value \|\| value/);
});

test('写入前再次发现页面切到登录态时立即停止，不扫描或写入登录框', async () => {
  const scripts = [];
  const workspace = {
    async openWorkspace() {},
    async run(script) {
      scripts.push(script);
      if (scripts.length === 1) return { loginRequired: false, isNotFound: false, inputCount: 2 };
      if (scripts.length === 2) return { loginRequired: true, isNotFound: false, inputCount: 1 };
      throw new Error('登录态出现后不应继续扫描或写入');
    }
  };
  const fill = createGenericResumeFill('bytedance', '字节跳动');
  const result = await fill(
    { basic: { name: '张三' } },
    { workspace, company: { id: 'bytedance', name: '字节跳动' } }
  );
  assert.equal(result.status, 'login-required');
  assert.equal(scripts.length, 2);
});

test('逐字段汇总只把写后回读一致算 verified', () => {
  const result = summarizeGenericVerification([
    { key: 'basic.name', expected: '张三', observed: '张三', written: true },
    { key: 'basic.email', expected: 'a@example.com', observed: 'wrong@example.com', written: true },
    { key: 'basic.phone', expected: '13800000000', observed: '', written: false }
  ]);
  assert.deepEqual(result.verified, ['basic.name']);
  assert.deepEqual(result.mismatched, ['basic.email']);
  assert.deepEqual(result.failed, ['basic.phone']);
});

test('写入结果必须等待页面事件完成后按原控件索引重新读取，不能用写入瞬间值自证', () => {
  const merged = mergeExecutionWithInspection([
    { key: 'basic.name', fieldIndex: 1, locator: { kind: 'id', value: 'name' }, expected: '张三', observed: '张三', written: true }
  ], [
    { index: 0, value: '无关字段' },
    { index: 1, id: 'name', value: '页面框架回滚后的旧值' }
  ]);
  assert.equal(merged[0].observed, '页面框架回滚后的旧值');
  assert.equal(merged[0].observedImmediately, '张三');
});
