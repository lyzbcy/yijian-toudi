'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { normalizeOfferBiu, importOfferBiu, link } = require('../electron/job-sources.cjs');
const { inspectGuopin } = require('../electron/iguopin-flow.cjs');
const { JsonStore } = require('../electron/store.cjs'), { AgentServer } = require('../electron/agent-server.cjs');
function sample() { return { sourceUrl: 'https://offerbiu.com/companies/', capturedAt: new Date().toISOString(), observedPage: 0,
  payload: { success: true, code: 'OK', data: { page: 0, size: 9, totalItems: 100, previewLimited: true,
    items: [{ id: 'rec-2027-sample', companyName: 'SAMPLE 招聘企业', positionsText: '电气工程师、设备工程师等 7 项',
      locations: ['上海', '新疆'], targetYears: [2027], companyNature: '央国企', sourceUpdatedAt: '2026-10-22T00:00:00Z',
      applyUrl: 'https://app.mokahr.com/campus-recruitment/sample/123?locale=zh-CN&token=SECRET#/jobs?page=1&sessionid=SECRET',
      announcementUrl: 'https://example.com/notice', deadlineType: 'ASAP', deadlineText: '尽快投递', deadlineAt: null, status: 'ACTIVE' }] } } }; }
test('observed source is announcement not invented individual jobs, unknown qualifications, bounded preview', () => {
  const r = normalizeOfferBiu(sample()); assert.equal(r.jobs.length, 1); assert.equal(r.jobs[0].recordKind, 'recruitment-announcement');
  assert.equal(r.jobs[0].deadlineAt, null); assert.equal(r.jobs[0].requiresReview, true); assert.equal(r.previewLimited, true); assert.equal(r.complete, false);
  assert.equal(r.jobs[0].education, '待原招聘页核验'); assert.equal(r.jobs[0].reviewFlags.length, 2);
  assert(!r.jobs[0].url.includes('SECRET')); assert(r.jobs[0].url.includes('#/jobs?page=1'));
});
test('source rejects wrong page, failed response, fake domain, credential URLs and malformed years', () => {
  for (const mutate of [s => s.observedPage++, s => s.payload.success = false, s => s.sourceUrl = 'https://offerbiu.com.evil.test/companies/',
    s => s.payload.data.items[0].applyUrl = 'https://user:pw@example.com/', s => s.payload.data.items[0].targetYears = ['2027'],
    s => s.payload.data.items.push(s.payload.data.items[0])]) { const s = sample(); mutate(s); assert.throws(() => normalizeOfferBiu(s)); }
  assert.throws(() => link('javascript:alert(1)'));
});
test('import upserts own observations only, preserves other sources, edits, favorites and application ledger', () => {
  const s = { jobs: [{ id: 'tencent-J1', favorite: true }], companies: [{ id: 'tencent' }], applied: [{ id: 'SAMPLE' }] };
  const b = sample(); importOfferBiu(s, b); const j = s.jobs[1]; j.favorite = true; j.title = '人工核验后的标题';
  const before = JSON.stringify(s.applied); const r = importOfferBiu(s, b);
  assert.equal(s.jobs.length, 2); assert.equal(s.jobs[1].favorite, true); assert.equal(s.jobs[1].title, '人工核验后的标题');
  assert(r.preservedEdits > 0); assert.equal(JSON.stringify(s.applied), before); assert.equal(s.jobs[0].id, 'tencent-J1');
  assert.equal(s.companies[1].capabilities.apply, 'unsupported');
  const future = sample(); future.capturedAt = new Date(Date.now() + 5000).toISOString(); importOfferBiu(s, future);
  assert.equal(importOfferBiu(s, b).stale, 1);
});
test('Guopin observation does not turn loading, old application, or text mentioning success into new submission', () => {
  const o = { url: 'https://www.iguopin.com/job/detail?id=123456789', text: '申请职位', buttons: ['申请职位'] };
  assert.equal(inspectGuopin(o).status, 'job-detail'); assert.equal(inspectGuopin({ ...o, text: '提示申请成功', buttons: [] }).status, 'unknown');
  assert.equal(inspectGuopin({ ...o, buttons: ['已申请'] }).status, 'already-applied');
  assert.equal(inspectGuopin({ ...o, successDialogVisible: true, successDialogText: '申请成功' }).status, 'success-visible');
  assert.equal(inspectGuopin({ ...o, text: '附件信息缺失' }).status, 'waiting-materials');
  assert.equal(inspectGuopin({ ...o, url: 'https://c.iguopin.com/apply?job_id=123456789&template_id=31456' }).status, 'custom-template');
  assert.equal(inspectGuopin(o).submittedByInspection, false);
  assert.throws(() => inspectGuopin({ ...o, url: 'https://evil.test/job?id=123456789' }));
});
test('production import HTTP authenticates, dry-runs, persists and reopens without replacing other sources', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-sources85-')); const store = new JsonStore(dir); store.init();
  store.update(s => { s.jobs = [{ id: 'existing-J1', title: '已存在来源', favorite: true }]; return s; });
  let calls = 0; const api = new AgentServer({ store, onStateChange: () => calls++ });
  try {
    const base = 'http://127.0.0.1:' + await api.start();
    const headers = { Authorization: 'Bearer ' + store.get().settings.apiToken, 'Content-Type': 'application/json' };
    const post = (route, body, h = headers) => fetch(base + route, { method: 'POST', headers: h, body: JSON.stringify(body) });
    assert.equal((await post('/v1/job-sources/offerbiu/import', sample(), {})).status, 401);
    const before = fs.readFileSync(store.file, 'utf8');
    const dry = await post('/v1/job-sources/offerbiu/import', { ...sample(), dryRun: true }); assert.equal(dry.status, 200);
    assert.equal(fs.readFileSync(store.file, 'utf8'), before);
    assert.equal((await post('/v1/job-sources/offerbiu/import', sample())).status, 200);
    assert.equal((await post('/v1/job-sources/offerbiu/import', sample())).status, 200);
    assert.equal(calls, 2); assert.equal(store.get().jobs.length, 2);
    const inspection = await post('/v1/applications/iguopin/inspect', { url: 'https://www.iguopin.com/job/detail?id=123456789', text: '', buttons: ['已申请'] });
    assert.equal(inspection.status, 200); assert.equal((await inspection.json()).status, 'already-applied');
    assert.equal(store.get().agentApplications, undefined);
    await api.stop(); const reopened = new JsonStore(dir); reopened.init(); assert.equal(reopened.get().jobs.length, 2);
  } finally { await api.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
});
