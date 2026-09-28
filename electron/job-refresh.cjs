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

module.exports = { mergeJobSnapshot, singleFlight };
