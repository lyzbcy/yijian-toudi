'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const ledger = require('../electron/agent-applications.cjs');
const career = require('../electron/career-tracker.cjs');
const { JsonStore } = require('../electron/store.cjs');
const { AgentServer } = require('../electron/agent-server.cjs');
const SCOPE = { accountId: 'ACCOUNT', profileId: 'PROFILE' };
function evidence(extra = {}) { return { observed: true, observedAt: new Date().toISOString(), url: 'https://ats.example/applications?jobId=J1&token=PRIVATE', reference: 'SAMPLE_RECEIPT', text: 'SAMPLE J1 当前申请记录', ...extra }; }
function fixture(initial = {}) {
  let state = structuredClone(initial), n = 0;
  const write = (body, key = 'route92-' + ++n) => {
    const draft = structuredClone(state), result = ledger.mutate(draft, { ...SCOPE, ...body }, key);
    state = draft; return result;
  };
  const create = (applicationRoute, extra = {}) => write({ action: 'create', company: 'SAMPLE', role: '工程师', jobKey: 'J1', url: 'https://ats.example/J1', applicationRoute, ...extra });
  const next = (i, action, extra = {}, key) => write({ id: i.id, revision: i.revision, action, ...extra }, key);
  const ready = i => next(i, 'ready', { eligibilityConfirmed: true, factsConfirmed: true, fieldsReviewed: true, attachmentsReviewed: true, missingFields: [] });
  const begin = i => next(ready(i), 'begin-submit', { userAuthorized: true });
  const body = (i, routeObservation, extra = {}) => ({ action: 'receipt', id: i.id, revision: i.revision, attemptId: i.attemptId, outcome: 'submitted', routeObservation, evidence: evidence(), ...extra });
  return { write, create, next, ready, begin, body, state: () => state, read: () => ledger.read(state, SCOPE) };
}
const platform = () => ({ event: 'platform-delivered', observed: true });
const ats = () => ({ event: 'ats-submitted', observed: true, employerDesignated: true });

test('92 create classifies explicitly and preserves the old counts shape', () => {
  const f = fixture(); assert.equal(f.create().applicationRoute, 'unknown');
  assert.deepEqual(f.read().counts, { total: 1, submitted: 0, uniqueCompanies: 0, synced: 0, pending: 0 });
  assert.equal(f.read().routeCounts.total.unknown, 1);
  assert.throws(() => f.create('guess-from-domain', { jobKey: 'OTHER' }), /invalid-application-route/);
  assert.equal(f.read().counts.total, 1);
});

test('92 new campus tasks are tagged by explicit platform or exact validated HTTPS origin only', () => {
  for (const extra of [{ platform: 'zhilian-campus' }, { url: 'https://xiaoyuan.zhaopin.com/job?jobId=J1' }, { url: 'https://XIAOYUAN.ZHAOPIN.COM:443/job', platform: 'other' }]) {
    const f = fixture(), i = f.create(undefined, extra);
    assert.equal(i.platform, 'zhilian-campus'); assert.equal(i.applicationRoute, 'unknown');
  }
  for (const url of ['https://xiaoyuan.zhaopin.com.evil.example/job', 'https://other.example/xiaoyuan.zhaopin.com', 'http://xiaoyuan.zhaopin.com/job', 'https://xiaoyuan.zhaopin.com:444/job']) {
    assert.equal(fixture().create(undefined, { url }).platform, undefined);
  }
  for (const platform of ['', null, {}, [], 1]) assert.throws(() => fixture().create(undefined, { platform }), /invalid-platform/);
});

test('92 new campus unknown submitted receipts fail atomically; explicit typed correction succeeds', () => {
  for (const extra of [{ platform: 'zhilian-campus' }, { url: 'https://xiaoyuan.zhaopin.com/job' }]) {
    const f = fixture(), i = f.begin(f.create(undefined, extra)), before = structuredClone(f.state());
    for (const routeObservation of [undefined, ats(), platform()]) {
      assert.throws(() => f.write(f.body(i, routeObservation), 'campus-attempt'), e => e.status === 409 && e.message === 'zhilian-campus-typed-route-required');
      assert.deepEqual(f.state(), before);
    }
    const done = f.write(f.body(i, ats(), { applicationRoute: 'employer-ats' }), 'campus-attempt');
    assert.equal(done.status, 'submitted'); assert.equal(done.platform, 'zhilian-campus');
    assert.equal(done.routeAssessment.employerAtsReceived, true); assert.equal(f.state().careerApplications.length, 1);
  }
});

test('92 no platform migration is applied to 100 historical campus-origin tasks', () => {
  const items = Array.from({ length: 100 }, (_, k) => ({ id: 'historical-' + k, ...SCOPE, company: 'OLD' + k, companyKey: 'old' + k, role: '工程师', jobKey: 'old' + k, url: 'https://xiaoyuan.zhaopin.com/job', status: 'submitted', revision: 4, history: [], receipt: { source: 'agent-reported', observedAt: '2026-10-25T00:00:00Z' } }));
  const rows = items.map(i => ({ id: 'row-' + i.id, ...SCOPE, company: i.company, role: i.role, stage: '面试中', agentApplicationIds: [i.id] }));
  const before = JSON.stringify({ items, rows }), f = fixture({ agentApplications: { items, requests: {} }, careerApplications: rows });
  assert.equal(f.read().routeCounts.submitted.unknown, 100); f.create(undefined, { jobKey: 'new', url: 'https://xiaoyuan.zhaopin.com/new' });
  assert.equal(JSON.stringify({ items: f.state().agentApplications.items.slice(0, 100), rows: f.state().careerApplications }), before);
  const old = fixture(), i = old.begin(old.create());
  delete old.state().agentApplications.items[0].platform;
  assert.equal(old.write(old.body(i)).status, 'submitted');
});

test('92 career importer does not manage a campus-platform unknown success forged around the mutation gate', () => {
  const f = fixture(), i = f.begin(f.create()), legacy = f.write(f.body(i));
  const state = { agentApplications: { items: [{ ...legacy, platform: 'zhilian-campus' }] } };
  assert.equal(career.importAgentReceipts(state).created, 0); assert.equal(state.careerApplications.length, 0);
});

test('92 chat is an evidenced interaction, never submitted or managed', () => {
  const f = fixture(), i = f.create('chat-only');
  const chatted = f.next(i, 'interaction', { event: 'chat-started', evidence: evidence() });
  assert.equal(chatted.status, 'queued'); assert.equal(chatted.revision, i.revision + 1);
  assert.equal(chatted.interactions[0].event, 'chat-started'); assert.equal(chatted.interactions[0].evidence.source, 'agent-reported');
  assert.equal(f.read().interactionCounts['chat-started'], 1); assert.equal(f.read().counts.submitted, 0);
  assert.equal(f.state().careerApplications.length, 0);
  assert.throws(() => f.next(f.ready(chatted), 'begin-submit', { userAuthorized: true }), /chat-is-not-application/);
});

test('92 interaction cannot skip evidence, scope or optimistic concurrency', () => {
  const f = fixture(), i = f.create('chat-only'), before = f.state();
  for (const extra of [{}, { evidence: evidence({ observed: false }) }, { evidence: evidence({ observedAt: '2099-01-01' }) }, { evidence: evidence({ observedAt: '2000-01-01' }) }, { evidence: evidence({ url: 'javascript:alert(1)' }) }, { evidence: evidence(), accountId: 'OTHER' }, { evidence: evidence(), revision: 999 }]) {
    assert.throws(() => f.next(i, 'interaction', { event: 'chat-started', ...extra }));
    assert.deepEqual(f.state(), before);
  }
});

test('92 interaction idempotency never duplicates events; a conflicting key remains 409', () => {
  const f = fixture(), i = f.create('chat-only');
  const b = { action: 'interaction', id: i.id, revision: i.revision, event: 'chat-started', evidence: evidence() };
  const r = f.write(b, 'chat-key'); assert.deepEqual(f.write(b, 'chat-key'), r);
  assert.equal(f.state().agentApplications.items[0].interactions.length, 1);
  assert.throws(() => f.write({ ...b, event: 'draft-saved' }, 'chat-key'), /idempotency-conflict/);
  assert.throws(() => f.next(r, 'interaction', { event: 'platform-delivered', evidence: evidence() }), /invalid-interaction-event/);
});

test('92 redirect/draft evidence never becomes a formal application success', () => {
  const f = fixture(); let i = f.create('employer-ats');
  for (const event of ['redirected', 'draft-saved']) i = f.next(i, 'interaction', { event, evidence: evidence() });
  assert.equal(i.status, 'queued'); assert.equal(f.state().careerApplications.length, 0);
  assert.deepEqual(f.read().interactionCounts, { 'chat-started': 0, redirected: 1, 'draft-saved': 1 });
});

test('92 platform receipt is submitted, scoped and managed without claiming employer ATS', () => {
  const f = fixture(), i = f.begin(f.create('platform-resume'));
  const b = f.body(i, platform()), done = f.write(b, 'platform-receipt');
  assert.equal(done.status, 'submitted'); assert.equal(done.routeAssessment.employerAtsReceived, false);
  assert.equal(done.receipt.routeObservation.event, 'platform-delivered'); assert(!done.receipt.url.includes('PRIVATE'));
  const r = f.state().careerApplications[0]; assert.equal(r.applicationRoute, 'platform-resume'); assert.equal(r.stage, '已投递'); assert.match(r.note, /不代表企业ATS/);
  assert.deepEqual(f.write(b, 'platform-receipt'), done); assert.equal(f.state().careerApplications.length, 1);
  assert.equal(f.read().routeCounts.submitted['platform-resume'], 1); assert.equal(f.read().routeCounts.submitted['employer-ats'], 0);
});

test('92 designated third-party ATS formal receipt is managed with distinct semantics', () => {
  const f = fixture(), i = f.begin(f.create('employer-ats'));
  const done = f.write(f.body(i, ats())); assert.equal(done.routeAssessment.employerAtsReceived, true);
  const r = f.state().careerApplications[0]; assert.equal(r.applicationRoute, 'employer-ats'); assert.equal(r.routeAssessment.employerAtsReceived, true);
  assert.equal(f.read().routeCounts.submitted['employer-ats'], 1);
});

test('92 typed success needs matching observed events plus the complete original receipt gate', () => {
  for (const route of ['platform-resume', 'employer-ats']) {
    const f = fixture(), i = f.begin(f.create(route)), before = f.state();
    const bad = [undefined, { event: 'redirected', observed: true }, { event: 'draft-saved', observed: true }, { event: 'chat-started', observed: true }, { ...ats(), observed: false }, { event: 'ats-submitted', observed: true }, { event: 'platform-delivered', observed: 'true' }];
    for (const observation of bad) {
      assert.throws(() => f.write(f.body(i, observation))); assert.deepEqual(f.state(), before);
    }
    const good = route === 'employer-ats' ? ats() : platform();
    for (const extra of [{ evidence: undefined }, { evidence: evidence({ reference: '' }) }, { evidence: evidence({ text: '' }) }, { evidence: evidence({ observed: false }) }, { evidence: evidence({ observedAt: '2000-01-01' }) }, { attemptId: 'wrong' }, { revision: 999 }, { accountId: 'OTHER' }]) {
      assert.throws(() => f.write(f.body(i, good, extra))); assert.deepEqual(f.state(), before);
    }
  }
});

test('92 ready, authorization, route conflicts and identity gates remain mandatory', () => {
  const f = fixture(), i = f.create('platform-resume');
  assert.throws(() => f.next(i, 'begin-submit', { userAuthorized: true }), /submission-not-ready/);
  assert.throws(() => f.next(i, 'ready', { factsConfirmed: true }), /review-required/);
  const ready = f.ready(i); assert.throws(() => f.next(ready, 'begin-submit'), /submission-not-ready/);
  const begun = f.next(ready, 'begin-submit', { userAuthorized: true });
  assert.throws(() => f.write(f.body(begun, ats(), { applicationRoute: 'employer-ats' })), /application-route-conflict/);
  assert.equal(f.read().counts.submitted, 0);
});

test('92 an unknown attempt stays locked, then resolves once without blind resubmission', () => {
  const f = fixture(), begun = f.begin(f.create('employer-ats'));
  const unknown = f.next(begun, 'receipt', { attemptId: begun.attemptId, outcome: 'submission-unknown' });
  assert.equal(unknown.status, 'submission-unknown'); assert.equal(unknown.applicationRoute, 'employer-ats');
  for (const action of ['ready', 'checkpoint', 'interaction']) assert.throws(() => f.next(unknown, action, { status: 'in-progress', reason: 'retry', event: 'chat-started', evidence: evidence() }), /receipt-query-required/);
  assert.equal(f.state().careerApplications.length, 0);
  const b = f.body(unknown, ats()), done = f.write(b, 'resolve');
  assert.equal(done.attemptId, begun.attemptId); assert.deepEqual(f.write(b, 'resolve'), done);
  assert.equal(f.state().careerApplications.length, 1);
  assert.throws(() => f.next(done, 'interaction', { event: 'chat-started', evidence: evidence() }), /receipt-query-required/);
});

test('92 route and interaction counters are isolated by account and profile', () => {
  const f = fixture(); const one = f.begin(f.create('employer-ats')); f.write(f.body(one, ats()));
  const other = f.create('chat-only', { accountId: 'OTHER', profileId: 'OTHER_PROFILE' });
  f.next(other, 'interaction', { accountId: 'OTHER', profileId: 'OTHER_PROFILE', event: 'chat-started', evidence: evidence() });
  assert.equal(f.read().counts.total, 1); assert.equal(f.read().interactionCounts['chat-started'], 0);
  const read = ledger.read(f.state(), { accountId: 'OTHER', profileId: 'OTHER_PROFILE' });
  assert.equal(read.routeCounts.total['chat-only'], 1); assert.equal(read.routeCounts.submitted['employer-ats'], 0); assert.equal(read.interactionCounts['chat-started'], 1);
});

test('92 100 legacy successes and their existing managed records remain byte-for-byte unchanged', () => {
  const items = Array.from({ length: 100 }, (_, k) => ({ id: 'old-' + k, ...SCOPE, company: 'OLD' + k, companyKey: 'old' + k, role: '工程师', jobKey: 'old' + k, status: 'submitted', revision: 4, history: [], receipt: { source: 'agent-reported', observedAt: '2026-10-25T00:00:00Z' } }));
  const rows = items.map(i => ({ id: 'row-' + i.id, ...SCOPE, company: i.company, role: i.role, stage: '面试中', agentApplicationIds: [i.id], note: 'old retained' }));
  const original = JSON.stringify({ items, rows });
  const f = fixture({ agentApplications: { items, requests: {} }, careerApplications: rows });
  assert.equal(f.read().routeCounts.submitted.unknown, 100); f.create('chat-only', { jobKey: 'NEW' });
  assert.equal(JSON.stringify({ items: f.state().agentApplications.items.slice(0, 100), rows: f.state().careerApplications }), original);
});

test('92 legacy untyped receipts stay compatible and unknown, never retroactively ATS', () => {
  const f = fixture(), i = f.begin(f.create()); const done = f.write(f.body(i));
  assert.equal(done.status, 'submitted'); assert.equal(done.applicationRoute, 'unknown');
  assert.equal(done.routeAssessment.employerAtsReceived, false); assert.equal(f.read().routeCounts.submitted.unknown, 1);
  assert.equal(f.state().careerApplications[0].applicationRoute, 'unknown');
});

test('92 unknown routes can be explicitly classified at receipt, known routes cannot be disguised', () => {
  const f = fixture(), i = f.begin(f.create());
  const done = f.write(f.body(i, ats(), { applicationRoute: 'employer-ats' })); assert.equal(done.applicationRoute, 'employer-ats');
  assert.equal(f.state().careerApplications[0].applicationRoute, 'employer-ats');
  const g = fixture(), j = g.begin(g.create('platform-resume'));
  assert.throws(() => g.write(g.body(j, { ...ats(), applicationRoute: 'employer-ats' })), /application-route-conflict/);
});

test('92 career importer independently rejects typed chat, draft and incomplete forged receipts', () => {
  const f = fixture(), i = f.begin(f.create('employer-ats')); const good = f.write(f.body(i, ats()));
  for (const extra of [{ applicationRoute: 'chat-only' }, { applicationRoute: 'bad' }, { receipt: { ...good.receipt, routeObservation: { event: 'draft-saved', observed: true } } }, { receipt: { ...good.receipt, observed: false } }, { receipt: { ...good.receipt, reference: '' } }, { receipt: { ...good.receipt, observedAt: '2000-01-01' } }, { attemptId: '' }, { receipt: { ...good.receipt, url: 'javascript:alert(1)' } }]) {
    const state = { agentApplications: { items: [{ ...good, ...extra, routeAssessment: { employerAtsReceived: true } }] } };
    assert.equal(career.importAgentReceipts(state).created, 0); assert.equal(state.careerApplications.length, 0);
  }
});

test('92 linking new typed success preserves manual stage, title, todo and history', () => {
  const row = { id: 'manual', ...SCOPE, company: 'SAMPLE', role: '工程师', stage: '面试中', todo: { status: 'done' }, history: [{ stage: '面试中' }], note: 'manual' };
  const f = fixture({ careerApplications: [row] }), i = f.begin(f.create('platform-resume')); const done = f.write(f.body(i, platform()));
  const r = f.state().careerApplications[0]; for (const key of Object.keys(row)) assert.deepEqual(r[key], row[key]);
  assert.equal(r.agentSubmissionRoutes[done.id].applicationRoute, 'platform-resume'); assert.equal(r.applicationRoute, undefined);
});

test('92 interactions retain at most 100 observations and counters count tasks, not clicks', () => {
  const f = fixture(); let i = f.create('chat-only');
  for (let n = 0; n < 105; n++) i = f.next(i, 'interaction', { event: 'chat-started', evidence: evidence() });
  assert.equal(i.interactions.length, 100); assert.equal(f.read().interactionCounts['chat-started'], 1);
  assert.equal(f.read().counts.submitted, 0); assert.equal(f.state().careerApplications.length, 0);
});

test('92 production HTTP persists typed successes/interactions, reopens and rejects fake receipts atomically', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yjt-route92-')), store = new JsonStore(dir); store.init();
  let server; let n = 0;
  try {
    server = new AgentServer({ store }); const port = await server.start(0), base = 'http://127.0.0.1:' + port;
    const headers = { Authorization: 'Bearer ' + store.get().settings.apiToken, 'Content-Type': 'application/json' };
    const post = async (body, key = 'http92-' + ++n) => {
      const r = await fetch(base + '/v1/applications', { method: 'POST', headers: { ...headers, 'Idempotency-Key': key }, body: JSON.stringify({ ...SCOPE, ...body }) });
      return { status: r.status, json: await r.json() };
    };
    const created = await post({ action: 'create', applicationRoute: 'employer-ats', company: 'SAMPLE', role: '工程师', jobKey: 'J1', url: 'https://ats.example/J1' }); assert.equal(created.status, 200);
    let i = created.json.item;
    i = (await post({ action: 'ready', id: i.id, revision: i.revision, eligibilityConfirmed: true, factsConfirmed: true, fieldsReviewed: true, attachmentsReviewed: true, missingFields: [] })).json.item;
    i = (await post({ action: 'begin-submit', id: i.id, revision: i.revision, userAuthorized: true })).json.item;
    const bad = { action: 'receipt', id: i.id, revision: i.revision, attemptId: i.attemptId, outcome: 'submitted', evidence: evidence(), routeObservation: { event: 'draft-saved', observed: true } };
    const before = fs.readFileSync(store.file, 'utf8'); assert.equal((await post(bad)).status, 409); assert.equal(fs.readFileSync(store.file, 'utf8'), before);
    const good = { ...bad, routeObservation: ats() }; const done = await post(good, 'HTTP-RECEIPT'); assert.equal(done.status, 200);
    assert.deepEqual(await post(good, 'HTTP-RECEIPT'), done);
    const chat = (await post({ action: 'create', applicationRoute: 'chat-only', company: 'CHAT', role: '工程师', jobKey: 'C1', url: 'https://chat.example/C1' })).json.item;
    assert.equal((await post({ action: 'interaction', id: chat.id, revision: chat.revision, event: 'chat-started', evidence: evidence() })).status, 200);
    const unauthorized = await fetch(base + '/v1/applications?accountId=ACCOUNT&profileId=PROFILE'); assert.equal(unauthorized.status, 401);
    let campus = (await post({ action: 'create', platform: 'zhilian-campus', company: 'CAMPUS', role: '工程师', jobKey: 'Z1', url: 'https://xiaoyuan.zhaopin.com/job?jobId=Z1' })).json.item;
    assert.equal(campus.applicationRoute, 'unknown'); assert.equal(campus.platform, 'zhilian-campus');
    campus = (await post({ action: 'ready', id: campus.id, revision: campus.revision, eligibilityConfirmed: true, factsConfirmed: true, fieldsReviewed: true, attachmentsReviewed: true, missingFields: [] })).json.item;
    campus = (await post({ action: 'begin-submit', id: campus.id, revision: campus.revision, userAuthorized: true })).json.item;
    const untyped = { action: 'receipt', id: campus.id, revision: campus.revision, attemptId: campus.attemptId, outcome: 'submitted', evidence: evidence() };
    const beforeCampus = fs.readFileSync(store.file, 'utf8');
    const rejected = await post(untyped, 'HTTP-CAMPUS'); assert.equal(rejected.status, 409); assert.equal(fs.readFileSync(store.file, 'utf8'), beforeCampus);
    assert.equal((await post({ ...untyped, applicationRoute: 'platform-resume', routeObservation: platform() }, 'HTTP-CAMPUS')).status, 200);
    await server.stop(); const reopened = new JsonStore(dir); reopened.init(); const read = ledger.read(reopened.get(), SCOPE);
    assert.equal(read.routeCounts.submitted['employer-ats'], 1); assert.equal(read.routeCounts.submitted['platform-resume'], 1); assert.equal(read.interactionCounts['chat-started'], 1); assert.equal(read.counts.submitted, 2);
    const managed = reopened.get().careerApplications.filter(r => r.accountId === SCOPE.accountId && r.profileId === SCOPE.profileId);
    assert.equal(managed.length, 2); assert.equal(managed[0].applicationRoute, 'employer-ats'); assert.equal(managed[1].applicationRoute, 'platform-resume');
  } finally {
    await server?.stop();
    const resolved = fs.realpathSync(dir), tmp = fs.realpathSync(os.tmpdir());
    assert(resolved.startsWith(tmp + path.sep) && path.basename(resolved).startsWith('yjt-route92-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
