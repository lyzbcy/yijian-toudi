const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESUME_FORMAT,
  createResumeExport,
  parseResumeImport
} = require('../electron/resume-json.cjs');

const sampleResume = {
  basic: { name: '张三', email: 'zhang@example.com', phone: '13800138000' },
  profiles: [{ id: 'default', label: '默认', basic: {} }],
  activeProfileId: 'default'
};

test('导出为统一模板：format/version/exportedAt/resume 结构完整', () => {
  const payload = createResumeExport(sampleResume, '0.3.0');
  assert.equal(payload.format, RESUME_FORMAT);
  assert.equal(payload.version, 1);
  assert.ok(payload.exportedAt);
  assert.equal(payload.appVersion, '0.3.0');
  assert.deepEqual(payload.resume.basic.name, '张三');
});

test('导出会深拷贝，导出后修改原简历不影响导出结果', () => {
  const resume = JSON.parse(JSON.stringify(sampleResume));
  const payload = createResumeExport(resume, '0.3.0');
  resume.basic.name = '李四';
  assert.equal(payload.resume.basic.name, '张三');
});

test('简历数据为空或缺少 basic 字段时拒绝导出', () => {
  assert.throws(() => createResumeExport(null, '0.3.0'), /无法导出/);
  assert.throws(() => createResumeExport({}, '0.3.0'), /缺少 basic 字段/);
});

test('导入完整模板：通过校验并返回深拷贝的简历数据', () => {
  const payload = createResumeExport(sampleResume, '0.3.0');
  const imported = parseResumeImport(JSON.stringify(payload));
  assert.equal(imported.basic.email, 'zhang@example.com');
  imported.basic.name = '改了';
  assert.equal(payload.resume.basic.name, '张三');
});

test('导入裸简历对象（模板里的 resume 字段内容）同样接受', () => {
  const imported = parseResumeImport(JSON.stringify(sampleResume));
  assert.equal(imported.basic.name, '张三');
});

test('非法 JSON、非对象、格式标识不匹配、版本过高都给出明确错误', () => {
  assert.throws(() => parseResumeImport('not-json{'), /不是有效的 JSON/);
  assert.throws(() => parseResumeImport('[1,2]'), /不是对象/);
  assert.throws(() => parseResumeImport(JSON.stringify({ format: 'other-tool', resume: sampleResume })), /格式标识不匹配/);
  assert.throws(() => parseResumeImport(JSON.stringify({ format: RESUME_FORMAT, version: 99, resume: sampleResume })), /版本.*高于当前软件/);
});

test('模板声明了 format 但缺少 resume 字段时报错', () => {
  assert.throws(() => parseResumeImport(JSON.stringify({ format: RESUME_FORMAT, version: 1 })), /缺少 resume 字段/);
});

test('导入数据缺少 basic 字段时拒绝', () => {
  assert.throws(() => parseResumeImport(JSON.stringify({ intention: {} })), /缺少 basic 字段/);
});
