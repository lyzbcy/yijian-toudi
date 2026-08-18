(function exposeResumeSyncFlow(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ResumeSyncFlow = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  const VERIFIED_STATUSES = new Set(['verified', 'saved']);
  const NEEDS_USER_STATUSES = new Set(['review-required', 'login-required', 'manual-required']);

  function decideResumeSyncContinuation(result = {}) {
    if (result.resumeSyncDecision !== 'advance') return { type: 'none' };
    if (result.session?.completed) return { type: 'complete' };
    if (result.session?.continueCompanyId) {
      return { type: 'continue', companyId: result.session.continueCompanyId };
    }
    return { type: 'none' };
  }

  function mergeResumeSyncStage(previous = {}, result = {}) {
    if (result.status === 'workspace-active') return { ...previous, changed: false };
    return {
      ...previous,
      pausedCompanyId: result.currentCompanyId || null,
      nextCompanyId: result.nextCompanyId || null,
      pauseStatus: result.status || null,
      atEnd: Boolean(result.atEnd),
      changed: true
    };
  }

  function summarizeResumeSyncRun(results = []) {
    const summary = { verified: 0, needsUser: 0, failed: 0 };
    for (const result of results) {
      if (VERIFIED_STATUSES.has(result?.status)) summary.verified += 1;
      else if (NEEDS_USER_STATUSES.has(result?.status)) summary.needsUser += 1;
      else summary.failed += 1;
    }
    return summary;
  }

  return { decideResumeSyncContinuation, mergeResumeSyncStage, summarizeResumeSyncRun };
}));
