(() => {
  const revision = state => Number.isSafeInteger(state?.meta?.stateRevision) && state.meta.stateRevision >= 0 ? state.meta.stateRevision : 0;
  const shouldAccept = (current, next) => Boolean(next) && (!current || revision(next) >= revision(current));
  const api = { revision, shouldAccept };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.StateRevision = api;
})();
