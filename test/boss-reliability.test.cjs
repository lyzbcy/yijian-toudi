const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { BossBatchRunner } = require(process.env.BOSS_RUNNER_FILE
  ? path.resolve(process.env.BOSS_RUNNER_FILE) : '../electron/boss-batch.cjs');
const link = { title: '前端开发实习生', company: '样本公司', ref: '@e1' };
const detail = { data: { tree: [{ name: '立即沟通', ref: '@e2' }] } };

test('P0: 详情等待期间停止后不再读页面或发送', async () => {
  const calls = [];
  const runner = new BossBatchRunner({ bridge: {
    click: async (ref) => { calls.push(ref); return { data: { success: true } }; },
    snapshot: async () => { calls.push('snapshot'); return detail; }
  }, noThrottle: true });
  runner.wait = async () => { runner.stop('user-stop'); };
  await runner.applyOne(link, '武汉');
  assert.deepEqual(calls, ['@e1']);
});

test('P0: 已停止的搜索等待不会再导航', async () => {
  let navigations = 0;
  const runner = new BossBatchRunner({ bridge: { navigate: async () => { navigations++; } } });
  runner.lastSearchAt = Date.now();
  runner.wait = async () => { runner.stop('user-stop'); };
  await runner.navigateSearch('https://www.zhipin.com/web/geek/jobs');
  assert.equal(navigations, 0);
});

test('P0: 发送点击抛错仍视作结果不明并停机', async () => {
  let clicks = 0;
  const runner = new BossBatchRunner({ bridge: {
    click: async () => { if (++clicks === 2) throw new Error('bridge-disconnected'); return { data: { success: true } }; },
    snapshot: async () => detail
  }, noThrottle: true });
  await assert.rejects(runner.applyOne(link, '武汉'), /bridge-disconnected/);
  assert.equal(runner.stopReason, 'send-unverified');
  assert.equal(runner.stopped, true);
});

test('P0: 用户停止后在途回执如实返回，但不再点留在此页', async () => {
  const clicks = [];
  let snapshots = 0;
  const runner = new BossBatchRunner({ bridge: {
    click: async (ref) => { clicks.push(ref); return { data: { success: true } }; },
    snapshot: async () => {
      if (++snapshots === 1) return detail;
      runner.stop('user-stop');
      return { data: { tree: [{ name: '已向BOSS发送消息' }, { name: '留在此页', ref: '@e3' }] } };
    }
  }, noThrottle: true });
  assert.deepEqual(await runner.applyOne(link, '武汉'), { company: '样本公司' });
  assert.deepEqual(clicks, ['@e1', '@e2']);
});
