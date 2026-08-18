const test = require('node:test');
const assert = require('node:assert/strict');
const { manualApplicationOutcome } = require('../electron/workspace-outcome.cjs');

test('手动投递完成不冒充 submitted，仍保留未验证语义', () => {
  const result = manualApplicationOutcome('finish', 'job-1');
  assert.equal(result.status, 'manual-completed-unverified');
  assert.equal(result.taskStatus, 'done');
  assert.equal(result.toastType, 'warn');
  assert.match(result.message, /未验证/);
});

test('手动投递取消返回 cancelled', () => {
  const result = manualApplicationOutcome('cancel', 'job-1');
  assert.equal(result.status, 'cancelled');
  assert.equal(result.taskStatus, 'error');
  assert.equal(result.toastType, 'error');
});
