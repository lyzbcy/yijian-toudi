'use strict';

// First-run direction selection must finish before any automatic job request.
// Manual refresh is deliberately independent of this startup-only policy.
function shouldAutoRefreshJobs(state, { backgroundTest = false, localPreview = false, now = Date.now() } = {}) {
  if (backgroundTest || localPreview || state?.meta?.onboardingSeen !== true) return false;
  const jobs = state?.settings?.jobs;
  if (!jobs?.autoRefresh) return false;
  const last = jobs.lastRefreshAt ? new Date(jobs.lastRefreshAt).getTime() : 0;
  return !(now - last < 24 * 3600 * 1000);
}

module.exports = { shouldAutoRefreshJobs };
