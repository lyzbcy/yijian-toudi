(function (root) {
  function view(state) {
    const settings = state.settings?.jobs || {}, result = settings.lastRefreshResult;
    const date = value => {
      const parsed = new Date(value);
      return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN') : null;
    };
    const attempt = date(settings.lastRefreshAttemptAt), complete = date(settings.lastRefreshAt);
    const lastRefreshText = [attempt ? `最近尝试：${attempt}` : null,
      complete ? `上次完整抓取：${complete}` : attempt || state.jobs?.length ? '尚无完整成功记录' : '还没有抓取过岗位。'
    ].filter(Boolean).join('；');
    if (result && ['done', 'partial', 'failed'].includes(result.status)) {
      const providers = Array.isArray(result.providers) ? result.providers : [];
      const failed = providers.filter(provider => provider?.status === 'failed').map(provider => String(provider.name || provider.companyId || '未标注公司'));
      const count = Number.isFinite(Number(result.count)) && Number(result.count) >= 0 ? Number(result.count) : 0;
      if (result.status === 'partial') return { status: 'partial', lastRefreshText,
        title: '上次刷新部分完成', detail: `本次取得 ${count} 个岗位；${failed.join('、')}刷新失败，已有岗位仍可查看。` };
      if (result.status === 'failed') return { status: 'failed', lastRefreshText,
        title: '上次刷新失败', detail: `本次没有更新岗位，已保留原有数据。失败公司：${failed.join('、')}。` };
      return { status: 'done', lastRefreshText, title: '上次刷新完成',
        detail: count ? `本次取得 ${count} 个岗位。` : '当前筛选条件下没有岗位，查询已完成。' };
    }
    // Old versions recorded attempts separately from full successes. Keep those
    // facts without inferring specific failed providers from free-form text.
    if (attempt && (!complete || new Date(settings.lastRefreshAttemptAt) > new Date(settings.lastRefreshAt))) {
      const task = state.tasks?.find(task => task.type === 'jobs' && ['done', 'error'].includes(task.status));
      return { status: 'partial', title: '最近刷新未全部成功',
        detail: task?.detail || '请查看自动化中心的刷新结果；已有岗位仍可查看。', lastRefreshText };
    }
    return { status: null, title: '', detail: '', lastRefreshText };
  }
  function render(state, document) {
    const result = view(state), notice = document.querySelector('#jobsRefreshResult');
    document.querySelector('#jobsLastRefresh').textContent = result.lastRefreshText;
    notice.hidden = !result.status;
    notice.dataset.status = result.status || '';
    document.querySelector('#jobsRefreshResultTitle').textContent = result.title;
    document.querySelector('#jobsRefreshResultDetail').textContent = result.detail;
  }
  const api = { view, render };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JobRefreshStatus = api;
})(typeof window === 'object' ? window : globalThis);
