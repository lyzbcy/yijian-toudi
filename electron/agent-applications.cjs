'use strict';
// Durable coordination only. Browser actions and receipt inspection belong to the
// user's browser-capable Agent; never infer a submission from an HTTP ledger write.
const crypto = require('node:crypto');
const routes = require('./application-route.cjs');
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(value, name, max = 300) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('invalid-' + name);
  return value.trim();
}
function web(value) {
  let u; try { u = new URL(text(value, 'url', 2048)); } catch { fail('invalid-url'); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) fail('invalid-url');
  // Keep common ATS job identifiers, not authentication or tracking parameters.
  const safe = new URLSearchParams();
  for (const [key, value] of u.searchParams) {
    if (/^(id|jobid|positionid|postid|requisitionid|job|position|requisition)$/i.test(key) && /^[\w.-]{1,160}$/.test(value)) safe.append(key, value);
  }
  u.search = safe.toString(); u.hash = ''; return u.href;
}
function scope(body) { return { accountId: text(body.accountId, 'accountId', 100), profileId: text(body.profileId, 'profileId', 100) }; }
function same(a, b) { return a.accountId === b.accountId && a.profileId === b.profileId; }
function receiptEvidence(evidence, startedAt) {
  if (!evidence || evidence.observed !== true) fail('receipt-evidence-required', 409);
  const observedAt = text(evidence.observedAt, 'observedAt', 40);
  const date = Date.parse(observedAt), started = Date.parse(startedAt);
  if (!Number.isFinite(date) || !Number.isFinite(started) || date < started || date > Date.now() + 60000) fail('invalid-evidence-time');
  return { url: web(evidence.url), reference: text(evidence.reference, 'reference', 500),
    text: text(evidence.text, 'receipt-text', 500), observedAt, source: 'agent-reported', observed: true };
}
function read(state, filter) {
  const selected = scope(filter);
  const items = (state.agentApplications?.items || []).filter(i => same(i, selected));
  const submitted = items.filter(i => i.status === 'submitted');
  return { items, counts: { total: items.length, submitted: submitted.length,
    uniqueCompanies: new Set(submitted.map(i => i.companyKey)).size,
    synced: submitted.filter(i => i.sync?.status === 'synced').length,
    pending: items.filter(i => i.status.startsWith('waiting-')).length },
    nextCandidates: items.filter(i => ['queued', 'in-progress', 'ready'].includes(i.status))
      .sort((a, b) => ({ short: 0, standard: 1, complex: 2 }[a.effort || 'standard'] -
        { short: 0, standard: 1, complex: 2 }[b.effort || 'standard']))
      .map(i => ({ id: i.id, revision: i.revision, effort: i.effort || 'standard', timeBudgetSeconds: i.timeBudgetSeconds || 180 })),
    routeCounts: routes.summarizeRoutes(items),
    interactionCounts: Object.fromEntries(['chat-started', 'redirected', 'draft-saved'].map(event =>
      [event, items.filter(i => (i.interactions || []).some(e => e.event === event)).length])),
    evidenceSource: 'agent-reported; ledger does not independently verify websites',
    coverage: { targetPercent: 99, measuredPercent: null } };
}
function mutate(state, body, key) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid-body');
  const s = scope(body), action = text(body.action, 'action', 40);
  if (!key) fail('Idempotency-Key-required');
  const ledger = state.agentApplications ||= { items: [], requests: {} };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  if (Object.hasOwn(ledger.requests, key)) {
    const old = ledger.requests[key];
    if (old.fingerprint !== fingerprint) fail('idempotency-conflict', 409);
    require('./career-tracker.cjs').importAgentReceipts(state);
    return old.result;
  }
  if (Object.keys(ledger.requests).length >= 10000) fail('ledger-request-limit', 409);
  const now = new Date().toISOString();
  let item;
  if (action === 'create') {
    const company = text(body.company, 'company'), role = text(body.role, 'role');
    const companyKey = company.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
    const jobKey = text(body.jobKey, 'jobKey', 200);
    const effort = body.effort ?? 'standard', timeBudgetSeconds = body.timeBudgetSeconds ?? 180;
    if (!['short', 'standard', 'complex'].includes(effort) || !Number.isInteger(timeBudgetSeconds) || timeBudgetSeconds < 30 || timeBudgetSeconds > 1800) fail('invalid-effort-budget');
    if (ledger.items.some(i => same(i, s) && i.companyKey === companyKey && i.jobKey === jobKey)) fail('duplicate-application', 409);
    if (ledger.items.length >= 5000) fail('ledger-item-limit', 409);
    const applicationRoute = routes.normalizeRoute(body.applicationRoute);
    const url = web(body.url);
    let platform = body.platform === undefined ? undefined : text(body.platform, 'platform', 80);
    // Source tagging applies only to newly created tasks; it does not classify the submission path.
    if (new URL(url).origin === 'https://xiaoyuan.zhaopin.com') platform = 'zhilian-campus';
    item = { id: crypto.randomUUID(), ...s, company, companyKey, role, jobKey, applicationRoute,
      ...(platform ? { platform } : {}), url, effort, timeBudgetSeconds, status: 'queued', revision: 1, missingFields: [],
      createdAt: now, updatedAt: now, history: [] };
    ledger.items.push(item);
  } else {
    item = ledger.items.find(i => i.id === body.id && same(i, s));
    if (!item) fail('application-not-found', 404);
    if (body.revision !== item.revision) fail('revision-conflict', 409);
    const uncertain = ['submitting', 'submission-unknown'].includes(item.status);
    if (action === 'checkpoint') {
      if (uncertain || item.status === 'submitted') fail('receipt-query-required', 409);
      if (!['in-progress', 'waiting-login', 'waiting-verification', 'waiting-materials', 'waiting-review', 'skipped'].includes(body.status)) fail('invalid-checkpoint');
      item.status = body.status;
      item.reason = text(body.reason, 'reason', 500);
      if (body.tabId !== undefined) item.tabId = text(body.tabId, 'tabId', 100);
      if (body.missingFields !== undefined) {
        if (!Array.isArray(body.missingFields) || body.missingFields.length > 100) fail('invalid-missingFields');
        item.missingFields = body.missingFields.map(f => {
          if (!f || typeof f !== 'object' || Array.isArray(f)) fail('invalid-missingFields');
          return { field: text(f.field, 'field', 100), reason: text(f.reason, 'reason', 300) };
        });
      }
      // No answers/passwords/verification codes are accepted into this schema.
    } else if (action === 'ready') {
      if (uncertain || item.status === 'submitted') fail('receipt-query-required', 409);
      if (body.eligibilityConfirmed !== true || body.factsConfirmed !== true || body.fieldsReviewed !== true || body.attachmentsReviewed !== true) fail('review-required', 409);
      if (!Array.isArray(body.missingFields) || body.missingFields.length) fail('unresolved-materials', 409);
      item.missingFields = []; item.status = 'ready';
    } else if (action === 'begin-submit') {
      if (item.status !== 'ready' || body.userAuthorized !== true) fail('submission-not-ready', 409);
      routes.assertSubmissionRoute(item.applicationRoute, 'submitted');
      item.status = 'submitting'; item.attemptId = crypto.randomUUID(); item.attemptStartedAt = now;
    } else if (action === 'interaction') {
      if (uncertain || item.status === 'submitted') fail('receipt-query-required', 409);
      if (!['chat-started', 'redirected', 'draft-saved'].includes(body.event)) fail('invalid-interaction-event');
      const applicationRoute = routes.resolveReceiptRoute(item.applicationRoute, body.applicationRoute);
      const evidence = receiptEvidence(body.evidence, item.createdAt);
      const event = { event: body.event, applicationRoute, evidence };
      item.applicationRoute = applicationRoute;
      item.interactions = [...(item.interactions || []), event].slice(-100);
    } else if (action === 'receipt') {
      if (!uncertain || body.attemptId !== item.attemptId) fail('attempt-mismatch', 409);
      if (!['submitted', 'submission-unknown', 'not-submitted'].includes(body.outcome)) fail('invalid-outcome');
      const prepared = routes.prepareReceiptRoute(item.applicationRoute, {
        applicationRoute: body.applicationRoute, outcome: body.outcome, observation: body.routeObservation
      });
      if (item.platform === 'zhilian-campus' && body.outcome === 'submitted' && prepared.applicationRoute === 'unknown') fail('zhilian-campus-typed-route-required', 409);
      let receipt;
      if (body.outcome !== 'submission-unknown') {
        receipt = receiptEvidence(body.evidence, item.attemptStartedAt);
        if (prepared.assessment) receipt.routeObservation = {
          event: prepared.assessment.reason === 'platform-resume-delivered' ? 'platform-delivered' :
            prepared.assessment.reason === 'employer-ats-submitted' ? 'ats-submitted' : 'unknown',
          observed: body.routeObservation?.observed === true,
          employerDesignated: body.routeObservation?.employerDesignated === true
        };
      }
      item.applicationRoute = prepared.applicationRoute;
      item.routeAssessment = prepared.assessment;
      if (receipt) item.receipt = receipt;
      item.status = body.outcome === 'not-submitted' ? 'waiting-review' : body.outcome;
    } else if (action === 'sync') {
      if (item.status !== 'submitted') fail('submission-receipt-required', 409);
      if (!['pending', 'synced', 'failed'].includes(body.status)) fail('invalid-sync-status');
      item.sync = { status: body.status, destination: text(body.destination, 'destination', 100),
        reference: text(body.reference, 'sync-reference', 500), updatedAt: now };
    } else fail('invalid-action');
    item.revision++;
  }
  item.updatedAt = now;
  item.history.push({ action, status: item.status, at: now });
  item.history = item.history.slice(-100);
  require('./career-tracker.cjs').importAgentReceipts(state);
  const result = structuredClone(item);
  Object.defineProperty(ledger.requests, key, { value: { fingerprint, result }, enumerable: true, writable: true, configurable: true });
  return result;
}
module.exports = { read, mutate };
