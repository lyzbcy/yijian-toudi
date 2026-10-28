(() => {
  const $ = id => document.getElementById(id);
  const errorText = error => String(error?.message || '操作尚未完成，请核对当前页面').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  const escape = text => String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const labels = { queued: '排队中', running: '正在填写', 'login-required': '等待登录',
    'review-required': '等待核对', 'manual-required': '需手动填写', failed: '失败',
    'user-confirmed': '用户确认已保存（未自动验收）', cancelled: '已停止', interrupted: '上轮中断', verified: '字段已回读（未确认保存）', saved: '官网保存已确认', 'saved-verified': '官网存储已核验' };
  const date = value => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '暂无';
  let active = false;
  let starting = false;
  // Catalog responses can arrive out of order; a reopened picker owns a new epoch.
  let historyReadEpoch = 0;
  let currentBatch = {entries:[]};
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
    document.querySelectorAll('[data-catalog-verify]').forEach(e=>{e.disabled=locked;});
  }
  function progress(batch) {
    currentBatch=batch;active = batch.active;
    $('resumeBatchStop').disabled = !active;
    $('resumeBatchProgress').innerHTML = (batch.entries || []).map(e => {
      const pending=(e.widgetJob&&['running','unknown'].includes(e.widgetJob.status))||e.projectReview?.state==='unknown'||e.saveCheck?.status==='running',jobLabels={running:'字段任务运行中',unknown:'字段任务状态待查询',completed:e.status==='saved-verified'?'字段任务历史记录（官网存储已核验）':'字段任务已结束（未保存）',failed:'字段任务失败',lost:'字段任务已丢失'};
      const queryPersistence=e.saveCheck?.status==='running'||e.saveCheck?.status==='verified'&&e.status==='manual-required';
      return `<section class="resume-batch-result"><div><b>${escape(e.name)} · ${escape(e.id.split(':')[1])}</b><span>${escape(labels[e.status] || e.status)}</span><small>${escape(e.message)}</small>${e.projectReview?.canReplace===false?`<small>官网项目：${e.projectReview.existingNames.map(n=>escape(n||'空白卡片')).join('；')}<br>本机项目：${e.projectReview.desiredNames.map(n=>escape(n)).join('；')}<br>请先在官网对齐项目数量、名称和顺序，再点重新核对续填。</small>`:''}${e.widgetJob?`<small data-widget-status="${escape(e.id)}">${escape(jobLabels[e.widgetJob.status]||'任务待核对')} · 已记录 ${Number(e.widgetJob.recordCount)||0} 项</small>`:''}</div><div class="settings-actions">${e.id==='meituan:campus'?`<button data-batch-action="${queryPersistence?'query-saved':'verify-saved'}" data-id="${escape(e.id)}" ${e.busy||e.projectReview||(pending&&e.saveCheck?.status!=='running')?'disabled':''}>${queryPersistence?'查询存储核验':'核验官网存储（只读）'}</button>`:''}${e.open&&e.projectReview?`${e.projectReview.canReplace===false?'':`<button data-batch-action="replace-projects" data-id="${escape(e.id)}" data-plan-id="${escape(e.projectReview.id)}" ${e.busy||pending?'disabled':''}>查看差异并替换项目</button>`}${e.projectReview.canRefresh?`<button data-batch-action="refresh-projects" data-id="${escape(e.id)}" data-plan-id="${escape(e.projectReview.id)}" ${e.busy?'disabled':''}>重新核对差异 / 对齐后续填</button>`:''}<button data-batch-action="query-projects" data-id="${escape(e.id)}" data-plan-id="${escape(e.projectReview.id)}" ${e.busy?'disabled':''}>核对项目操作</button>`:''}${e.open&&e.widgetJob?`<button data-batch-action="query-widget" data-id="${escape(e.id)}" ${e.busy?'disabled':''}>查询进度</button>`:''}${e.open&&e.widgetJob?.status==='completed'&&!e.widgetJob.continuationCompleted&&['review-required','manual-required'].includes(e.status)?`<button data-batch-action="continue" data-id="${escape(e.id)}" ${e.busy?'disabled':''}>继续填写</button>`:''}${e.id.startsWith('meituan:')&&e.open&&e.widgetJob?.status==='completed'&&e.widgetJob.failedCount>0&&!e.projectReview?`<button data-batch-action="retry-widget" data-id="${escape(e.id)}" ${e.busy?'disabled':''}>补齐失败控件</button>`:''}${e.open && !e.busy&&!pending &&!e.projectReview && ['review-required', 'manual-required', 'verified'].includes(e.status) ? `<button data-batch-action="confirm-saved" data-id="${escape(e.id)}">我已在官网保存</button>` : ''}${e.open ? `<button data-batch-action="focus" data-id="${escape(e.id)}">查看窗口</button><button data-batch-action="close" data-id="${escape(e.id)}">关闭 / 继续队列</button>` : ''}${!e.busy && e.status !== 'queued' ? `<button data-batch-action="retry" data-id="${escape(e.id)}" ${pending?'disabled':''}>重试</button>` : ''}</div></section>`;
    }).join('');
    updateSelection();
  }
  async function refreshHistory() {
    const epoch = ++historyReadEpoch;
    const { targets } = await window.oneClick.resumeBatchCatalog();
    if (epoch !== historyReadEpoch) return;
    for (const target of targets) {
      const node = [...document.querySelectorAll('[data-resume-history]')].find(e => e.dataset.resumeHistory === target.id);
      if (node) node.textContent = historyText(target);
    }
  }
  function historyText(t) {
    const h = t.history;
    return `上次更新：${h?.lastUpdatedAt ? date(h.lastUpdatedAt) + '（官网证据）' : h?.lastUserConfirmedAt ? date(h.lastUserConfirmedAt) + '（用户确认，未自动验收）' : h?.lastPersistedVerifiedAt ? '官网存储已核验（保存时间未知）' : '尚未确认保存'}${h?.lastPersistedVerifiedAt ? ' · 官网存储核验：' + date(h.lastPersistedVerifiedAt) + '（只读核验时间，非保存时间）' : ''} · 上次尝试：${date(h?.lastAttemptAt)}${h?.status ? ' · ' + (labels[h.status] || h.status) : ''}${t.resumeChanged ? ' · 本地简历已变更' : ''}`;
  }
  window.ResumeBatchUI = { open(catalog) {
    ++historyReadEpoch;
    $('resumeBatchTargets').innerHTML = catalog.targets.map(t => `<div class="resume-batch-target"><label><input type="checkbox" data-resume-target value="${escape(t.id)}" ${catalog.selected.includes(t.id) ? 'checked' : ''}><div><b>${escape(t.name)} · ${t.track === 'social' ? '社招' : '校招/实习'}</b><small data-resume-history="${escape(t.id)}">${escape(historyText(t))}</small></div></label>${t.id==='meituan:campus'?`<button type="button" data-catalog-verify data-id="${escape(t.id)}">核验官网存储（只读）</button>`:''}</div>`).join('');
    $('resumeBatchMessage').textContent = '';
    progress(catalog.batch);
    if (!$('resumeBatchDialog').open) $('resumeBatchDialog').showModal();
  } };
  $('resumeBatchDialog').querySelector('.dialog-close').onclick = () => $('resumeBatchDialog').close();
  $('resumeBatchAll').onchange = event => {
    document.querySelectorAll('[data-resume-target]').forEach(e => { e.checked = event.target.checked; }); updateSelection();
  };
  $('resumeBatchTargets').onchange = updateSelection;
  $('resumeBatchTargets').onclick = async event => {
    const button=event.target.closest('[data-catalog-verify]');if(!button||active||starting)return;
    button.disabled=true;starting=true;updateSelection();
    try { progress(await window.oneClick.resumeBatchAction({action:'verify-saved',id:button.dataset.id}));await refreshHistory(); }
    catch(error){$('resumeBatchMessage').textContent=errorText(error);}
    finally{starting=false;updateSelection();}
  };
  $('resumeBatchStart').onclick = async () => {
    if(active||starting)return;
    starting=true;updateSelection();
    try {
      progress(await window.oneClick.resumeBatchStart({ targetIds: selection(), concurrency: Number($('resumeBatchConcurrency').value) }));
      $('resumeBatchMessage').textContent = '窗口已启动；可最大化任一窗口。关闭面板不会停止本轮。';
    } catch (error) { $('resumeBatchMessage').textContent = errorText(error); }
    finally { starting=false;updateSelection(); }
  };
  $('resumeBatchStop').onclick = async () => {
    try { progress(await window.oneClick.resumeBatchAction({ action: 'stop' })); }
    catch (error) { $('resumeBatchMessage').textContent = errorText(error); }
  };
  $('resumeBatchProgress').onclick = async event => {
    const button = event.target.closest('[data-batch-action]');
    if (!button) return;
    if (button.dataset.batchAction === 'confirm-saved' && !window.confirm('请确认你已在该平台官网完成保存。软件将记录“用户确认”时间，不作为官网自动验收证据，也不会点击投递。')) return;
    const replacement=button.dataset.batchAction==='replace-projects',review=currentBatch.entries.find(e=>e.id===button.dataset.id)?.projectReview;
    if(replacement){if(!review||review.id!==button.dataset.planId)return;const message=(review.removed||review.added?'继续原项目替换：已核验删除 '+review.removed+' 段、新增 '+review.added+' 段，只处理剩余步骤。\n':'')+'将删除当前 '+review.existingNames.length+' 段项目并重建为本机 '+review.desiredNames.length+' 段。先保存本机备份，不点击官网保存/投递。\n\n当前项目：\n'+review.existingNames.map((n,i)=>(i+1)+'. '+(n||'空白卡片')).join('\n')+'\n\n本机项目：\n'+review.desiredNames.map((n,i)=>(i+1)+'. '+n).join('\n')+'\n\n确认替换？';if(!window.confirm(message))return;}
    button.disabled = true;
    try { await window.oneClick.resumeBatchAction({ action: button.dataset.batchAction, id: button.dataset.id,planId:button.dataset.planId,confirmed:replacement?true:undefined }); }
    catch (error) { $('resumeBatchMessage').textContent = errorText(error); button.disabled = false; }
    finally { if(button.isConnected)button.disabled=false; }
  };
  window.oneClick.onResumeBatchChanged(batch => { progress(batch); void refreshHistory().catch(() => {}); });
})();
