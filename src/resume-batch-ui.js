(() => {
  const $ = id => document.getElementById(id);
  const escape = text => String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const labels = { queued: '排队中', running: '正在填写', 'login-required': '等待登录',
    'review-required': '等待核对', 'manual-required': '需手动填写', failed: '失败',
    'user-confirmed': '用户确认已保存（未自动验收）', cancelled: '已停止', interrupted: '上轮中断', verified: '字段已回读（未确认保存）', saved: '官网保存已确认' };
  const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无';
  let active = false;
  let starting = false;
  function selection() { return [...document.querySelectorAll('[data-resume-target]:checked')].map(e => e.value); }
  function updateSelection() {
    const all = [...document.querySelectorAll('[data-resume-target]')], selected = selection();
    $('resumeBatchAll').checked = all.length > 0 && all.length === selected.length;
    $('resumeBatchAll').indeterminate = selected.length > 0 && selected.length < all.length;
    $('resumeBatchCount').textContent = `已选 ${selected.length} / ${all.length}`;
    const locked=active||starting;
    $('resumeBatchStart').disabled = locked || !selected.length;
    $('resumeBatchConcurrency').disabled = locked;
    $('resumeBatchAll').disabled = locked;
    all.forEach(e=>{e.disabled=locked;});
  }
  function progress(batch) {
    active = batch.active;
    $('resumeBatchStop').disabled = !active;
    $('resumeBatchProgress').innerHTML = (batch.entries || []).map(e => `<section class="resume-batch-result"><div><b>${escape(e.name)} · ${escape(e.id.split(':')[1])}</b><span>${escape(labels[e.status] || e.status)}</span><small>${escape(e.message)}</small></div><div class="settings-actions">${e.open && !e.busy && ['review-required', 'manual-required', 'verified'].includes(e.status) ? `<button data-batch-action="confirm-saved" data-id="${escape(e.id)}">我已在官网保存</button>` : ''}${e.open ? `<button data-batch-action="focus" data-id="${escape(e.id)}">查看窗口</button><button data-batch-action="close" data-id="${escape(e.id)}">关闭 / 继续队列</button>` : ''}${!e.busy && e.status !== 'queued' ? `<button data-batch-action="retry" data-id="${escape(e.id)}">重试</button>` : ''}</div></section>`).join('');
    updateSelection();
  }
  async function refreshHistory() {
    const { targets } = await window.oneClick.resumeBatchCatalog();
    for (const target of targets) {
      const node = [...document.querySelectorAll('[data-resume-history]')].find(e => e.dataset.resumeHistory === target.id);
      if (node) node.textContent = historyText(target);
    }
  }
  function historyText(t) {
    const h = t.history;
    return `上次更新：${h?.lastUpdatedAt ? date(h.lastUpdatedAt) + '（官网证据）' : h?.lastUserConfirmedAt ? date(h.lastUserConfirmedAt) + '（用户确认，未自动验收）' : '尚未确认保存'} · 上次尝试：${date(h?.lastAttemptAt)}${h?.status ? ' · ' + (labels[h.status] || h.status) : ''}${t.resumeChanged ? ' · 本地简历已变更' : ''}`;
  }
  window.ResumeBatchUI = { open(catalog) {
    $('resumeBatchTargets').innerHTML = catalog.targets.map(t => `<label class="resume-batch-target"><input type="checkbox" data-resume-target value="${escape(t.id)}" ${catalog.selected.includes(t.id) ? 'checked' : ''}><div><b>${escape(t.name)} · ${t.track === 'social' ? '社招' : '校招/实习'}</b><small data-resume-history="${escape(t.id)}">${escape(historyText(t))}</small></div></label>`).join('');
    $('resumeBatchMessage').textContent = '';
    progress(catalog.batch);
    if (!$('resumeBatchDialog').open) $('resumeBatchDialog').showModal();
  } };
  $('resumeBatchDialog').querySelector('.dialog-close').onclick = () => $('resumeBatchDialog').close();
  $('resumeBatchAll').onchange = event => {
    document.querySelectorAll('[data-resume-target]').forEach(e => { e.checked = event.target.checked; }); updateSelection();
  };
  $('resumeBatchTargets').onchange = updateSelection;
  $('resumeBatchStart').onclick = async () => {
    if(active||starting)return;
    starting=true;updateSelection();
    try {
      progress(await window.oneClick.resumeBatchStart({ targetIds: selection(), concurrency: Number($('resumeBatchConcurrency').value) }));
      $('resumeBatchMessage').textContent = '窗口已启动；可最大化任一窗口。关闭面板不会停止本轮。';
    } catch (error) { $('resumeBatchMessage').textContent = error.message; }
    finally { starting=false;updateSelection(); }
  };
  $('resumeBatchStop').onclick = async () => {
    try { progress(await window.oneClick.resumeBatchAction({ action: 'stop' })); }
    catch (error) { $('resumeBatchMessage').textContent = error.message; }
  };
  $('resumeBatchProgress').onclick = async event => {
    const button = event.target.closest('[data-batch-action]');
    if (!button) return;
    if (button.dataset.batchAction === 'confirm-saved' && !window.confirm('请确认你已在该平台官网完成保存。软件将记录“用户确认”时间，不作为官网自动验收证据，也不会点击投递。')) return;
    button.disabled = true;
    try { await window.oneClick.resumeBatchAction({ action: button.dataset.batchAction, id: button.dataset.id }); }
    catch (error) { $('resumeBatchMessage').textContent = error.message; button.disabled = false; }
    finally { if(button.isConnected)button.disabled=false; }
  };
  window.oneClick.onResumeBatchChanged(batch => { progress(batch); void refreshHistory().catch(() => {}); });
})();
