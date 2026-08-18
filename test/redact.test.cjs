const test = require('node:test');
const assert = require('node:assert/strict');
const { redactResume, createRedactedSnapshot } = require('../electron/redact.cjs');

test('Agent 默认简历读取会脱敏证件号、手机号、邮箱和家庭电话', () => {
  const result = redactResume({
    basic: { idNumber: '320123199001011234', phone: '13800138000', email: 'me@example.com', emergencyContact: '李四 13900139000' },
    family: [{ name: '李四', phone: '13900139000' }]
  });
  assert.doesNotMatch(JSON.stringify(result), /320123199001011234|13800138000|me@example\.com|13900139000/);
});

test('脱敏快照不包含 Token、邮箱授权密文和幂等记录', () => {
  const result = createRedactedSnapshot({
    resume: { basic: { name: '真实姓名', birthday: '1990-01-01', phone: '13800138000' }, family: [{ name: '亲属姓名', company: '亲属单位' }], compliance: { criminalRecord: 'true' } },
    settings: { apiToken: 'secret-token', email: { address: 'me@example.com', encryptedCode: 'cipher' } },
    idempotency: { x: { response: 'private' } },
    messages: [{ id: 'm1', stage: '面试', receivedAt: '2026-01-01', body: '邮件隐私正文' }]
  });
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /secret-token|cipher|me@example\.com|13800138000|private|真实姓名|1990-01-01|亲属姓名|亲属单位|criminalRecord|邮件隐私正文/);
});
