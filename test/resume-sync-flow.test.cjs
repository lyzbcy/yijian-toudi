const test = require('node:test');
const assert = require('node:assert/strict');

const {
  decideResumeSyncContinuation,
  mergeResumeSyncStage,
  summarizeResumeSyncRun
} = require('../src/resume-sync-flow.js');

test('登录暂停完成后继续同一个同步目标', () => {
  assert.deepEqual(decideResumeSyncContinuation({
    resumeSyncDecision: 'advance',
    session: { completed: false, continueCompanyId: 'tencent:social' }
  }), { type: 'continue', companyId: 'tencent:social' });
});

test('核对暂停完成后推进到下一个同步目标', () => {
  assert.deepEqual(decideResumeSyncContinuation({
    resumeSyncDecision: 'advance',
    session: { completed: false, continueCompanyId: 'tencent:campus' }
  }), { type: 'continue', companyId: 'tencent:campus' });
});

test('队列完成后停止继续同步', () => {
  assert.deepEqual(decideResumeSyncContinuation({
    resumeSyncDecision: 'advance',
    session: { completed: true, continueCompanyId: null }
  }), { type: 'complete' });
});

test('workspace-active 阶段保留已有暂停元数据', () => {
  const pausedStages = [{
    pausedCompanyId: 'tencent:social',
    nextCompanyId: 'tencent:campus',
    pauseStatus: 'login-required',
    atEnd: false
  }, {
    pausedCompanyId: 'meituan:campus',
    nextCompanyId: null,
    pauseStatus: 'manual-required',
    atEnd: true
  }];

  for (const previous of pausedStages) {
    assert.deepEqual(mergeResumeSyncStage(previous, {
      status: 'workspace-active',
      currentCompanyId: null,
      nextCompanyId: null,
      atEnd: false,
      results: []
    }), {
      ...previous,
      changed: false
    });
  }
});

test('汇总已核验、需人工和失败的同步结果', () => {
  assert.deepEqual(summarizeResumeSyncRun([
    { companyId: 'tencent:social', status: 'verified' },
    { companyId: 'tencent:campus', status: 'saved' },
    { companyId: 'bytedance:social', status: 'review-required' },
    { companyId: 'alibaba:social', status: 'manual-required' },
    { companyId: 'baidu:social', status: 'login-required' },
    { companyId: 'xiaomi:social', status: 'failed' }
  ]), {
    verified: 2,
    needsUser: 3,
    failed: 1
  });
});
