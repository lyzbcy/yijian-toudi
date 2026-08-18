const test = require('node:test');
const assert = require('node:assert/strict');

const {
  runResumeSync,
  summarizeResumeSync,
  ResumeSyncSession,
  expandResumeSyncTargets,
  createResumeSyncExecutionQueue,
  isWorkspaceGenerationStale,
  createResumeSyncGenerationRegistry
} = require('../electron/resume-sync.cjs');

function company(id, name = id) {
  return { id, name, capabilities: { resume: 'verified' } };
}

test('一键更新遇到 review-required 会暂停且不打开下一家公司', async () => {
  const calls = [];
  const adapters = new Map([
    ['tencent', { fillResume: async () => { calls.push('tencent'); return { ok: true, status: 'review-required', message: '请核对' }; } }],
    ['bytedance', { fillResume: async () => { calls.push('bytedance'); return { ok: true, status: 'review-required' }; } }]
  ]);

  const result = await runResumeSync({
    resume: {},
    companies: [company('tencent', '腾讯'), company('bytedance', '字节跳动')],
    getAdapter: (id) => adapters.get(id)
  });

  assert.deepEqual(calls, ['tencent']);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'review-required');
  assert.equal(result.nextCompanyId, 'bytedance');
  assert.equal(result.continueCompanyId, 'bytedance');
  assert.equal(result.currentCompanyId, 'tencent');
  assert.equal(result.completed, false);
  assert.equal(result.partial.length, 1);
});

test('最后一个平台暂停时明确标记流程到尾，完成核对后不会误提示还有下一家', async () => {
  const result = await runResumeSync({
    resume: {},
    companies: [company('alibaba', '阿里巴巴')],
    getAdapter: () => ({ fillResume: async () => ({ status: 'review-required', ok: true }) })
  });
  assert.equal(result.currentCompanyId, 'alibaba');
  assert.equal(result.nextCompanyId, null);
  assert.equal(result.continueCompanyId, null);
  assert.equal(result.completed, false);
  assert.equal(result.atEnd, true);
});

test('login-required 继续时重试当前公司，manual-required 则继续下一家', async () => {
  const loginResult = await runResumeSync({
    resume: {},
    companies: [company('tencent'), company('bytedance')],
    getAdapter: () => ({ fillResume: async () => ({ ok: false, status: 'login-required' }) })
  });
  assert.equal(loginResult.continueCompanyId, 'tencent');

  const manualResult = await runResumeSync({
    resume: {},
    companies: [company('boss'), company('tencent')],
    getAdapter: () => ({ fillResume: async () => ({ ok: false, status: 'manual-required' }) })
  });
  assert.equal(manualResult.continueCompanyId, 'tencent');
});

test('反爬或登录失败只记录该平台，不阻止其他平台更新', async () => {
  const calls = [];
  const adapters = new Map([
    ['baidu', { fillResume: async () => { calls.push('baidu'); return { ok: false, status: 'manual-required', antiBot: true }; } }],
    ['tencent', { fillResume: async () => { calls.push('tencent'); return { ok: true, status: 'verified', report: { verified: ['姓名'] } }; } }]
  ]);

  const result = await runResumeSync({
    resume: {},
    companies: [company('baidu', '百度'), company('tencent', '腾讯')],
    getAdapter: (id) => adapters.get(id),
    pauseOnReview: false
  });

  assert.deepEqual(calls, ['baidu', 'tencent']);
  assert.equal(result.results.length, 2);
  assert.equal(result.ok, false);
  assert.equal(result.summary.verifiedPlatforms, 1);
  assert.equal(result.summary.needsUserPlatforms, 1);
});

test('平台全部失败时总结果不得谎报成功', async () => {
  const result = await runResumeSync({
    resume: {},
    companies: [company('a'), company('b')],
    getAdapter: () => ({ fillResume: async () => ({ ok: false, status: 'failed' }) }),
    pauseOnReview: false
  });
  assert.equal(result.ok, false);
  assert.equal(result.summary.failedPlatforms, 2);
});

test('adapter 缺少合法 status 时按失败处理，且 taskId 会传入当前 adapter', async () => {
  let receivedTaskId;
  const result = await runResumeSync({
    resume: {},
    companies: [company('tencent')],
    getAdapter: () => ({ fillResume: async (_resume, options) => {
      receivedTaskId = options.taskId;
      return { ok: true };
    } }),
    onCompanyStart: () => 'task-tencent',
    pauseOnReview: false
  });
  assert.equal(receivedTaskId, 'task-tencent');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'failed');
  assert.equal(result.results[0].status, 'failed');
});

test('汇总只把 verified/saved 算作真正更新，manual 不算成功', () => {
  const summary = summarizeResumeSync([
    { status: 'verified' },
    { status: 'saved' },
    { status: 'manual-required', ok: true },
    { status: 'failed', ok: false }
  ]);
  assert.deepEqual(summary, {
    totalPlatforms: 4,
    verifiedPlatforms: 2,
    needsUserPlatforms: 1,
    failedPlatforms: 1
  });
});

test('后端同步会话只在完成核对后推进，取消重试当前，最后一家完成后终止', () => {
  const session = new ResumeSyncSession(['tencent', 'bytedance']);
  assert.equal(session.startCompanyId(), 'tencent');
  session.acceptStage({
    status: 'review-required', currentCompanyId: 'tencent', nextCompanyId: 'bytedance', atEnd: false,
    results: [{ companyId: 'tencent', status: 'review-required' }]
  });
  assert.equal(session.cancel('tencent').continueCompanyId, 'tencent');
  session.acceptStage({
    status: 'review-required', currentCompanyId: 'tencent', nextCompanyId: 'bytedance', atEnd: false,
    results: [{ companyId: 'tencent', status: 'review-required' }]
  });
  assert.equal(session.finish('tencent').continueCompanyId, 'bytedance');
  session.acceptStage({
    status: 'manual-required', currentCompanyId: 'bytedance', nextCompanyId: null, atEnd: true,
    results: [{ companyId: 'bytedance', status: 'manual-required' }]
  });
  const done = session.finish('bytedance');
  assert.equal(done.completed, true);
  assert.equal(done.continueCompanyId, null);
  assert.equal(done.results.length, 2);
});

test('取消事件与当前暂停目标不一致时不清空会话', () => {
  const session = new ResumeSyncSession(['tencent', 'bytedance']);
  session.acceptStage({
    status: 'review-required', currentCompanyId: 'tencent', nextCompanyId: 'bytedance', atEnd: false,
    results: [{ companyId: 'tencent', status: 'review-required' }]
  });
  const snapshot = session.cancel('bytedance');
  assert.equal(snapshot.currentCompanyId, 'tencent');
  assert.equal(snapshot.continueCompanyId, 'tencent');
});

test('“全部都要”按每家公司社招、校招双轨展开且各自有稳定游标', () => {
  const targets = expandResumeSyncTargets([company('tencent'), company('bytedance')], 'all');
  assert.deepEqual(targets.map((item) => [item.syncTargetId, item.resumeRecruitType]), [
    ['tencent:social', 'social'],
    ['tencent:campus', 'campus'],
    ['bytedance:social', 'social'],
    ['bytedance:campus', 'campus']
  ]);
});

test('双轨队列把正确招聘方向传给 adapter，结果不会互相覆盖', async () => {
  const calls = [];
  const companies = expandResumeSyncTargets([company('tencent')], 'all');
  const result = await runResumeSync({
    resume: {}, companies, pauseOnReview: false,
    getAdapter: () => ({ fillResume: async (_resume, options) => {
      calls.push(options.recruitType);
      return { ok: true, status: 'verified' };
    } })
  });
  assert.deepEqual(calls, ['social', 'campus']);
  assert.deepEqual(result.results.map((item) => item.companyId), ['tencent:social', 'tencent:campus']);
});

test('登录暂停点完成只重试当前公司，不误推进', () => {
  const session = new ResumeSyncSession(['tencent', 'bytedance']);
  session.acceptStage({
    status: 'login-required', currentCompanyId: 'tencent', nextCompanyId: 'bytedance', atEnd: false,
    results: [{ companyId: 'tencent', status: 'login-required' }]
  });
  assert.equal(session.finish('tencent').continueCompanyId, 'tencent');
  assert.equal(session.snapshot().completed, false);
});

test('并发调用遇到活跃工作区时不得关闭正在核对的页面', async () => {
  let closed = 0;
  const error = new Error('已有页面'); error.code = 'WORKSPACE_ACTIVE';
  const result = await runResumeSync({
    resume: {}, companies: [company('tencent')], pauseOnReview: false,
    workspace: { closeWorkspaceIfOpen: async () => { closed += 1; } },
    getAdapter: () => ({ fillResume: async () => { throw error; } })
  });
  assert.equal(closed, 0);
  assert.equal(result.results[0].status, 'failed');
});

test('后端同步会话只认领已 accept 的当前暂停目标', () => {
  const session = new ResumeSyncSession(['tencent', 'bytedance']);
  assert.equal(session.hasPending('tencent'), false);

  session.acceptStage({
    status: 'review-required', currentCompanyId: 'tencent', nextCompanyId: 'bytedance', atEnd: false,
    results: [{ companyId: 'tencent', status: 'review-required' }]
  });

  assert.equal(session.hasPending('tencent'), true);
  assert.equal(session.hasPending('bytedance'), false);
});

test('adapter 返回前取消会立即终止旧一代，不打开下一家也不吸收结果', async () => {
  let releaseFirst;
  let aborted = false;
  let closed = 0;
  const calls = [];
  const firstResult = new Promise((resolve) => { releaseFirst = resolve; });

  const running = runResumeSync({
    resume: {},
    companies: [company('tencent'), company('bytedance')],
    getAdapter: (companyId) => ({
      fillResume: async () => {
        calls.push(companyId);
        if (companyId === 'tencent') return firstResult;
        return { ok: true, status: 'verified' };
      }
    }),
    workspace: { closeWorkspaceIfOpen: async () => { closed += 1; } },
    shouldAbort: () => aborted,
    pauseOnReview: false
  });

  await new Promise((resolve) => setImmediate(resolve));
  aborted = true;
  releaseFirst({ ok: true, status: 'verified' });
  const result = await running;

  assert.equal(result.status, 'cancelled');
  assert.equal(result.completed, false);
  assert.deepEqual(result.results, []);
  assert.deepEqual(calls, ['tencent']);
  assert.equal(closed, 1);
});

test('新 generation 会等旧 generation 的 loadURL 清理结束后再开始', async () => {
  let releaseFirst;
  const calls = [];
  const queue = createResumeSyncExecutionQueue();
  const first = queue.run(async () => {
    calls.push('old-start');
    await new Promise((resolve) => { releaseFirst = resolve; });
    calls.push('old-cleaned');
  });
  const second = queue.run(async () => { calls.push('new-start'); });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['old-start']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ['old-start', 'old-cleaned', 'new-start']);
});

test('独立工作区可以等待旧同步 generation 完全清理', async () => {
  let releaseSync;
  let idle = false;
  const queue = createResumeSyncExecutionQueue();
  const sync = queue.run(() => new Promise((resolve) => { releaseSync = resolve; }));
  const waiting = queue.waitForIdle().then(() => { idle = true; });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(idle, false);
  releaseSync();
  await Promise.all([sync, waiting]);
  assert.equal(idle, true);
});

test('旧 adapter 丢失双轨参数时，stage workspace 仍注入当前 target 和招聘方向', async () => {
  let opened;
  const target = expandResumeSyncTargets([company('tencent')], 'all')[0];
  const result = await runResumeSync({
    resume: {},
    companies: [target],
    workspace: {
      openWorkspace: async (options) => { opened = options; },
      closeWorkspaceIfOpen: async () => {}
    },
    getAdapter: () => ({
      fillResume: async (_resume, options) => {
        await options.workspace.openWorkspace({
          company: options.company,
          context: {
            action: 'fill-resume',
            companyId: 'tencent',
            taskId: options.taskId,
            resumeSyncGeneration: 7
          }
        });
        return { ok: true, status: 'review-required' };
      }
    }),
    onCompanyStart: () => 'task-tencent-social'
  });

  assert.equal(result.currentCompanyId, 'tencent:social');
  assert.deepEqual(opened.context, {
    action: 'fill-resume',
    companyId: 'tencent',
    taskId: 'task-tencent-social',
    resumeSyncGeneration: 7,
    syncTargetId: 'tencent:social',
    recruitType: 'social'
  });
});

test('批量工作区只有请求 generation 与活跃 generation 一致时才可操作', () => {
  assert.equal(isWorkspaceGenerationStale(3, undefined), true);
  assert.equal(isWorkspaceGenerationStale(3, 2), true);
  assert.equal(isWorkspaceGenerationStale(3, 3), false);
  assert.equal(isWorkspaceGenerationStale(undefined, undefined), false);
  assert.equal(isWorkspaceGenerationStale(null, 3), false);
});

test('取消 token 淘汰不得移除仍在执行的 generation', () => {
  const registry = createResumeSyncGenerationRegistry({ limit: 2 });
  registry.start(1);
  registry.cancel(1);
  registry.cancel(2);
  registry.cancel(3);

  assert.equal(registry.isCancelled(1), true);
  assert.ok(registry.cancelledSize() <= 2);

  registry.finish(1);
  assert.equal(registry.isCancelled(1), false);
  assert.ok(registry.cancelledSize() <= 2);
});
