function mergeJobSnapshot(existing, incoming, idPrefix) {
  if (!Array.isArray(incoming) || incoming.some((job) => !job || typeof job.id !== 'string' || !job.id.startsWith(idPrefix))) {
    throw new Error('岗位数据格式异常，已保留原有数据');
  }
  const favorites = new Set(existing.filter((job) => job.favorite).map((job) => job.id));
  const merged = new Map(existing
    .filter((job) => !job.id.startsWith(idPrefix) || job.favorite)
    .map((job) => [job.id, job]));
  for (const job of incoming) merged.set(job.id, { ...job, favorite: favorites.has(job.id) || Boolean(job.favorite) });
  return [...merged.values()];
}

function singleFlight(operation) {
  let pending;
  return (...args) => {
    if (!pending) pending = Promise.resolve().then(() => operation(...args)).finally(() => { pending = null; });
    return pending;
  };
}

function refreshResult(results, { at = new Date().toISOString(), daysBack, recruitType } = {}) {
  const providers = results.map(result => ({
    companyId: result.companyId, name: result.name, count: result.count,
    status: result.error ? 'failed' : 'done'
  }));
  const failed = providers.filter(provider => provider.status === 'failed');
  return {
    at, daysBack, recruitType, providers,
    status: failed.length === providers.length ? 'failed' : failed.length ? 'partial' : 'done',
    count: providers.reduce((total, provider) => total + provider.count, 0)
  };
}

function shouldAutoRefresh(settings, now = Date.now()) {
  if (!settings?.autoRefresh) return false;
  const times = [settings.lastRefreshAttemptAt, settings.lastRefreshAt]
    .map(value => value ? Date.parse(value) : NaN).filter(Number.isFinite);
  return !times.length || now - Math.max(...times) > 24 * 60 * 60 * 1000;
}

module.exports = { mergeJobSnapshot, singleFlight, refreshResult, shouldAutoRefresh };
