'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROUTES, EVENTS, normalizeRoute, resolveReceiptRoute, assertSubmissionRoute, assessObservation, prepareReceiptRoute, summarizeRoutes } = require('../electron/application-route.cjs');

test('route is explicit; missing legacy fields stay unknown, never inferred from URL or text', () => {
  for (const v of [undefined, null]) assert.equal(normalizeRoute(v), 'unknown');
  for (const v of ['unknown', 'chat-only', 'platform-resume', 'employer-ats']) assert.equal(normalizeRoute(v), v);
  for (const v of ['', 'https://campus.example', '申请成功', {}, [], true, 1, '__proto__', 'toString', 'EMPLOYER-ATS']) {
    assert.throws(() => normalizeRoute(v), e => e.message === 'invalid-application-route' && e.status === 400);
  }
});

test('receipt may classify unknown but cannot silently replace a known path', () => {
  assert.equal(resolveReceiptRoute(undefined, undefined), 'unknown');
  assert.equal(resolveReceiptRoute(undefined, 'employer-ats'), 'employer-ats');
  assert.equal(resolveReceiptRoute('unknown', 'platform-resume'), 'platform-resume');
  for (const v of ['chat-only', 'platform-resume', 'employer-ats']) {
    assert.equal(resolveReceiptRoute(v, undefined), v);
    assert.equal(resolveReceiptRoute(v, 'unknown'), v);
    assert.equal(resolveReceiptRoute(v, v), v);
  }
  for (const a of ['chat-only', 'platform-resume', 'employer-ats']) {
    for (const b of ['chat-only', 'platform-resume', 'employer-ats'].filter(b => a !== b)) {
      assert.throws(() => resolveReceiptRoute(a, b), e => e.message === 'application-route-conflict' && e.status === 409);
    }
  }
});

test('a chat action is not a submitted application; legacy unknown remains compatible', () => {
  assert.throws(() => assertSubmissionRoute('chat-only', 'submitted'), e => e.message === 'chat-is-not-application' && e.status === 409);
  for (const v of ['unknown', 'platform-resume', 'employer-ats', undefined]) assert.doesNotThrow(() => assertSubmissionRoute(v, 'submitted'));
  for (const outcome of ['not-submitted', 'submission-unknown']) assert.doesNotThrow(() => assertSubmissionRoute('chat-only', outcome));
  assert.throws(() => assertSubmissionRoute('employer-ats', 'success'), /invalid-outcome/);
  assert.throws(() => assertSubmissionRoute('bad', 'submitted'), /invalid-application-route/);
});

test('summary splits platform, ATS, chat and legacy without changing old records or success counts', () => {
  const items = [
    { id: 'legacy', status: 'submitted', url: 'https://campus.example', receipt: { text: '网申成功' } },
    { applicationRoute: 'employer-ats', status: 'submitted' },
    { applicationRoute: 'platform-resume', status: 'submitted' },
    { applicationRoute: 'chat-only', status: 'submitted' },
    { applicationRoute: 'employer-ats', status: 'submission-unknown' },
    { applicationRoute: 'platform-resume', status: 'queued' },
    { applicationRoute: 'bad-old-value', status: 'submitted' },
    { applicationRoute: 'chat-only', status: 'waiting-review' }
  ];
  const before = structuredClone(items);
  assert.deepEqual(summarizeRoutes(items), {
    total: { 'chat-only': 2, 'platform-resume': 2, 'employer-ats': 2, unknown: 2 },
    submitted: { 'chat-only': 1, 'platform-resume': 1, 'employer-ats': 1, unknown: 2 }
  });
  assert.deepEqual(items, before);
});

test('summary handles empty and malformed legacy records without mutation or prototype keys', () => {
  assert.deepEqual(summarizeRoutes([]), { total: { 'chat-only': 0, 'platform-resume': 0, 'employer-ats': 0, unknown: 0 }, submitted: { 'chat-only': 0, 'platform-resume': 0, 'employer-ats': 0, unknown: 0 } });
  const r = summarizeRoutes([null, 3, {}, { applicationRoute: '__proto__', status: 'submitted' }]);
  assert.equal(r.total.unknown, 4); assert.equal(r.submitted.unknown, 1);
  assert.equal(Object.getPrototypeOf(r.total), Object.prototype);
});

test('chat, redirect and draft cannot become a success, even with explicit ATS route', () => {
  for (const applicationRoute of ROUTES) for (const event of ['chat-started', 'redirected', 'draft-saved', 'unknown']) {
    const r = assessObservation({ applicationRoute, event, observed: true, employerDesignated: true });
    assert.equal(r.applicationSubmitted, false); assert.equal(r.employerAtsReceived, false);
  }
});

test('platform delivery is a platform success, not an employer ATS receipt', () => {
  assert.deepEqual(assessObservation({ applicationRoute: 'platform-resume', event: 'platform-delivered', observed: true }), {
    applicationRoute: 'platform-resume', applicationSubmitted: true, employerAtsReceived: false, reason: 'platform-resume-delivered'
  });
  for (const applicationRoute of ['chat-only', 'employer-ats', 'unknown']) {
    const r = assessObservation({ applicationRoute, event: 'platform-delivered', observed: true });
    assert.equal(r.applicationSubmitted, false); assert.equal(r.employerAtsReceived, false);
  }
});

test('explicit employer-designated ATS allows a third party host, not domain guessing', () => {
  for (const url of ['https://employer.example/jobs/1', 'https://ats.example/employer/1']) {
    const input = { applicationRoute: 'employer-ats', event: 'ats-submitted', observed: true, employerDesignated: true, url };
    const original = structuredClone(input);
    assert.deepEqual(assessObservation(input), { applicationRoute: 'employer-ats', applicationSubmitted: true, employerAtsReceived: true, reason: 'employer-ats-submitted' });
    assert.deepEqual(input, original);
  }
  for (const employerDesignated of [undefined, false]) assert.equal(assessObservation({ applicationRoute: 'employer-ats', event: 'ats-submitted', observed: true, employerDesignated }).reason, 'employer-designation-required');
});

test('unobserved, unknown or mismatched receipts never become ATS receipts', () => {
  for (const applicationRoute of ROUTES) for (const event of EVENTS) {
    for (const observed of [undefined, false]) {
      const r = assessObservation({ applicationRoute, event, observed, employerDesignated: true });
      assert.equal(r.applicationSubmitted, false); assert.equal(r.reason, 'observation-required');
    }
  }
  for (const applicationRoute of ['chat-only', 'platform-resume', 'unknown']) {
    assert.equal(assessObservation({ applicationRoute, event: 'ats-submitted', observed: true, employerDesignated: true }).employerAtsReceived, false);
  }
  assert.equal(assessObservation({ event: 'ats-submitted', observed: true, employerDesignated: true, url: 'https://employer.example', text: '申请成功' }).reason, 'unknown-route');
});

test('observation validates typed fields and does not accept truthy strings or foreign events', () => {
  for (const input of [null, undefined, [], 1, true, 'submitted']) assert.throws(() => assessObservation(input), /invalid-route-observation/);
  for (const event of ['submitted', '申请成功', {}, '__proto__']) assert.throws(() => assessObservation({ event }), /invalid-route-event/);
  for (const observed of ['true', 1, null, {}]) assert.throws(() => assessObservation({ observed }), /invalid-route-observed/);
  for (const employerDesignated of ['true', 1, null, {}]) assert.throws(() => assessObservation({ employerDesignated }), /invalid-employer-designated/);
  assert.throws(() => summarizeRoutes({}), /invalid-application-items/);
  assert(Object.isFrozen(ROUTES)); assert(Object.isFrozen(EVENTS));
});

test('single integration gate rejects typed submitted receipts for chat, redirects and drafts', () => {
  for (const route of ROUTES.filter(x => x !== 'unknown')) {
    for (const event of ['chat-started', 'redirected', 'draft-saved', 'unknown']) {
      assert.throws(() => prepareReceiptRoute(route, { outcome: 'submitted', observation: { observed: true, event, employerDesignated: true } }), e => e.status === 409);
    }
    assert.throws(() => prepareReceiptRoute(route, { outcome: 'submitted' }), e => e.status === 409);
  }
});

test('integration gate accepts classified platform/ATS receipts and never upgrades old successes', () => {
  const a = prepareReceiptRoute('unknown', { applicationRoute: 'platform-resume', outcome: 'submitted', observation: { event: 'platform-delivered', observed: true } });
  assert.equal(a.applicationRoute, 'platform-resume'); assert.equal(a.assessment.employerAtsReceived, false);
  const b = prepareReceiptRoute('employer-ats', { outcome: 'submitted', observation: { event: 'ats-submitted', observed: true, employerDesignated: true } });
  assert.equal(b.assessment.employerAtsReceived, true);
  const c = prepareReceiptRoute(undefined, { outcome: 'submitted' });
  assert.equal(c.applicationRoute, 'unknown'); assert.equal(c.assessment.employerAtsReceived, false);
  assert.equal(c.assessment.applicationSubmitted, false);
});

test('integration gate preserves unknown attempts without inviting retries and rejects conflicts', () => {
  assert.deepEqual(prepareReceiptRoute('employer-ats', { outcome: 'submission-unknown' }), { applicationRoute: 'employer-ats', assessment: null });
  assert.deepEqual(prepareReceiptRoute('chat-only', { outcome: 'not-submitted' }), { applicationRoute: 'chat-only', assessment: null });
  assert.throws(() => prepareReceiptRoute('platform-resume', { applicationRoute: 'employer-ats', outcome: 'submitted' }), /application-route-conflict/);
  assert.throws(() => prepareReceiptRoute('employer-ats', { outcome: 'submitted', observation: { applicationRoute: 'platform-resume', event: 'ats-submitted', observed: true, employerDesignated: true } }), /application-route-conflict/);
});

test('integration gate is pure and validates before returning any classification', () => {
  const input = { applicationRoute: 'employer-ats', outcome: 'submitted', observation: { event: 'ats-submitted', observed: true, employerDesignated: true } };
  const before = structuredClone(input); prepareReceiptRoute(undefined, input); assert.deepEqual(input, before);
  for (const v of [null, undefined, [], 1, true]) assert.throws(() => prepareReceiptRoute(undefined, v), /invalid-route-receipt/);
  for (const v of [[], 1, true, 'ats-submitted']) assert.throws(() => prepareReceiptRoute('employer-ats', { outcome: 'submitted', observation: v }), /invalid-route-observation/);
});
