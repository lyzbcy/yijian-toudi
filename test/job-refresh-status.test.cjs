const test = require('node:test'), assert = require('node:assert/strict');
const { refreshResult, shouldAutoRefresh } = require('../electron/job-refresh.cjs');
const { view } = require('../src/job-refresh-status.js');
const at = '2026-10-04T12:22:28.754Z';
const provider = (name, count, error = null) => ({ companyId: name, name, count, error });
const state = (lastRefreshResult, extra = {}) => ({ jobs: [], tasks: [], settings: { jobs: {
  lastRefreshAttemptAt: at, lastRefreshAt: null, lastRefreshResult, ...extra
} } });

test('partial refresh retains explicit successful/failed provider facts without treating an attempt as full success', () => {
  const result = refreshResult([provider('腾讯', 10), provider('百度', 0, 'timeout')], { at, daysBack: 30, recruitType: 'social' });
  assert.equal(result.status, 'partial'); assert.equal(result.count, 10);
  assert.deepEqual(result.providers.map(p => p.status), ['done', 'failed']);
  const display = view(state(result));
  assert.match(display.title, /部分完成/); assert.match(display.detail, /10 个岗位；百度刷新失败/);
  assert.match(display.lastRefreshText, /最近尝试/); assert.match(display.lastRefreshText, /尚无完整成功记录/);
  assert(!display.lastRefreshText.includes('还没有抓取过岗位'));
});
test('every failed provider is failed; zero matching jobs from successful providers is done', () => {
  const failed = refreshResult([provider('腾讯', 0, 'offline'), provider('百度', 0, 'timeout')], { at });
  assert.equal(failed.status, 'failed'); assert.match(view(state(failed)).detail, /已保留原有数据/);
  const empty = refreshResult([provider('腾讯', 0), provider('百度', 0)], { at });
  assert.equal(empty.status, 'done'); assert.match(view(state(empty)).detail, /查询已完成/);
});
test('failed latest attempt keeps the independently recorded previous full-success time visible', () => {
  const result = refreshResult([provider('腾讯', 0, 'offline')], { at });
  const display = view(state(result, { lastRefreshAt: '2026-10-03T12:00:00.000Z' }));
  assert.match(display.title, /失败/); assert.match(display.lastRefreshText, /最近尝试/);
  assert.match(display.lastRefreshText, /上次完整抓取/);
});
test('legacy partial snapshot with actual jobs and only attempt time never claims it has never fetched jobs', () => {
  const legacy = state(undefined); legacy.jobs = Array(3694).fill({});
  legacy.tasks = [{ type: 'jobs', status: 'done', detail: '百度、字节失败，四家成功' }];
  const display = view(legacy);
  assert.equal(display.status, 'partial'); assert.match(display.detail, /四家成功/);
  assert(!display.lastRefreshText.includes('还没有抓取过岗位'));
});
test('first launch remains unattempted and legacy success does not invent a partial failure', () => {
  assert.equal(view({ jobs: [], settings: {}, tasks: [] }).lastRefreshText, '还没有抓取过岗位。');
  assert.equal(view(state(undefined, { lastRefreshAt: at })).status, null);
});
test('recent failed/partial attempt prevents automatic refresh on reopen without marking a full success', () => {
  const now = Date.parse(at);
  assert.equal(shouldAutoRefresh({ autoRefresh: true, lastRefreshAt: null, lastRefreshAttemptAt: at }, now + 1000), false);
  assert.equal(shouldAutoRefresh({ autoRefresh: true, lastRefreshAt: '2026-10-01T12:00:00Z', lastRefreshAttemptAt: at }, now + 86400001), true);
  assert.equal(shouldAutoRefresh({ autoRefresh: false }, now), false);
  assert.equal(shouldAutoRefresh({ autoRefresh: true }, now), true);
  assert.equal(shouldAutoRefresh({ autoRefresh: true, lastRefreshAt: at }, now + 1000), false);
});
