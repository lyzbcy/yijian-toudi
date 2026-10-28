'use strict';
// Explicit Agent observations only. No domain/text inference or website verification.
const ROUTES = Object.freeze(['chat-only', 'platform-resume', 'employer-ats', 'unknown']);
const EVENTS = Object.freeze(['chat-started', 'redirected', 'draft-saved', 'platform-delivered', 'ats-submitted', 'unknown']);
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function normalizeRoute(value) {
  if (value == null) return 'unknown';
  if (!ROUTES.includes(value)) fail('invalid-application-route');
  return value;
}
function resolveReceiptRoute(current, incoming) {
  const a = normalizeRoute(current), b = normalizeRoute(incoming);
  if (a !== 'unknown' && b !== 'unknown' && a !== b) fail('application-route-conflict', 409);
  return b === 'unknown' ? a : b;
}
function assertSubmissionRoute(route, outcome) {
  route = normalizeRoute(route);
  if (!['submitted', 'submission-unknown', 'not-submitted'].includes(outcome)) fail('invalid-outcome');
  if (route === 'chat-only' && outcome === 'submitted') fail('chat-is-not-application', 409);
  // Compatibility: old receipts remain submitted, but unknown is never an ATS claim.
}
function assessObservation(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-route-observation');
  const applicationRoute = normalizeRoute(input.applicationRoute);
  const event = input.event ?? 'unknown';
  if (!EVENTS.includes(event)) fail('invalid-route-event');
  if (input.observed !== undefined && typeof input.observed !== 'boolean') fail('invalid-route-observed');
  if (input.employerDesignated !== undefined && typeof input.employerDesignated !== 'boolean') fail('invalid-employer-designated');
  const result = { applicationRoute, applicationSubmitted: false, employerAtsReceived: false, reason: 'not-a-submission' };
  if (input.observed !== true) return { ...result, reason: 'observation-required' };
  if (['chat-started', 'redirected', 'draft-saved', 'unknown'].includes(event)) return result;
  if (applicationRoute === 'unknown') return { ...result, reason: 'unknown-route' };
  if (event === 'platform-delivered') {
    if (applicationRoute !== 'platform-resume') return { ...result, reason: 'route-event-conflict' };
    return { ...result, applicationSubmitted: true, reason: 'platform-resume-delivered' };
  }
  if (applicationRoute !== 'employer-ats') return { ...result, reason: 'route-event-conflict' };
  if (input.employerDesignated !== true) return { ...result, reason: 'employer-designation-required' };
  return { ...result, applicationSubmitted: true, employerAtsReceived: true, reason: 'employer-ats-submitted' };
}
function prepareReceiptRoute(currentRoute, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-route-receipt');
  const applicationRoute = resolveReceiptRoute(currentRoute, input.applicationRoute);
  assertSubmissionRoute(applicationRoute, input.outcome);
  if (input.outcome !== 'submitted') return { applicationRoute, assessment: null };
  // The original ledger still validates attempt, time and receipt evidence separately.
  // New typed successes need matching observations; legacy untyped successes stay unknown.
  if (input.observation != null && (typeof input.observation !== 'object' || Array.isArray(input.observation))) fail('invalid-route-observation');
  if (input.observation?.applicationRoute !== undefined) resolveReceiptRoute(applicationRoute, input.observation.applicationRoute);
  const assessment = assessObservation({ ...input.observation, applicationRoute });
  if (applicationRoute !== 'unknown' && !assessment.applicationSubmitted) fail('route-receipt-not-submitted', 409);
  return { applicationRoute, assessment };
}
function summarizeRoutes(items) {
  if (!Array.isArray(items)) fail('invalid-application-items');
  const counts = () => ({ 'chat-only': 0, 'platform-resume': 0, 'employer-ats': 0, unknown: 0 });
  const total = counts(), submitted = counts();
  for (const item of items) {
    const route = ROUTES.includes(item?.applicationRoute) ? item.applicationRoute : 'unknown';
    total[route]++;
    if (item?.status === 'submitted') submitted[route]++;
  }
  return { total, submitted };
}
module.exports = { ROUTES, EVENTS, normalizeRoute, resolveReceiptRoute, assertSubmissionRoute, assessObservation, prepareReceiptRoute, summarizeRoutes };
