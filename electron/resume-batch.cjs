const {resolveResumeForCompany}=require('./resume-context.cjs');
const crypto = require('node:crypto');
const {widgetJobMeta,jobNeedsQuery,retryFailedWidgets}=require('./resume-widget-review.cjs');
const {planMeituanWidgets}=require('./meituan-widget-fill.cjs');
const {guardResumeWorkspace}=require('./resume-target-guard.cjs');
const {resolvePlatformUrl}=require('./platform-manifests.cjs');
const {readMeituanWidgetJob}=require('./meituan-widget-job.cjs');
const {readByteDateJob}=require('./bytedance-date-job.cjs');
const {planByteDates}=require('./bytedance-date-fill.cjs');
const {replaceProjects,queryProjectReplacement,projectReview,inspectProjectDifference}=require('./meituan-project-reconcile.cjs');
const {inspectByteProjectDifference}=require('./bytedance-project-review.cjs');
const {replaceByteProjects,queryByteProjectReplacement}=require('./bytedance-project-replace.cjs');

function resumeFingerprint(resume) {
  const { updatedAt, completion, profiles, ...content } = resume || {};
  const stable = value => Array.isArray(value) ? value.map(stable)
    : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
  return crypto.createHash('sha256').update(JSON.stringify(stable(content))).digest('hex');
}

function tileBounds(area, count, index) {
  const columns = count === 6 ? 3 : 2;
  const rows = 2;
  const col = index % columns, row = Math.floor(index / columns);
  const x = Math.floor(col * area.width / columns), y = Math.floor(row * area.height / rows);
  return { x: area.x + x, y: area.y + y,
    width: Math.floor((col + 1) * area.width / columns) - x,
    height: Math.floor((row + 1) * area.height / rows) - y };
}

// A review/login page owns its slot until explicitly closed. Different tracks of
// the same company never run together because they share a persisted login session.
class ResumeBatch {
  constructor({ store, getTargets, getAdapter, createWorkspace, createPersistenceProbe, attachmentPath, backupProjects, onChange = () => {} }) {
    Object.assign(this, { store, getTargets, getAdapter, createWorkspace, createPersistenceProbe, attachmentPath, backupProjects, onChange });
    this.persistenceChecks=new Map();
    this.entries = []; this.slots = new Map(); this.stopped = false; this.stopEpoch = 0;
    // No auto-resume after a process exit. An interrupted attempt is not a save.
    store.update(s => {
      for (const h of Object.values(s.resumeSyncHistory || {})) {
        if (['queued', 'running'].includes(h.status)) h.status = 'interrupted';
        if(jobNeedsQuery(h.widgetJob))h.widgetJob={...h.widgetJob,status:'lost',reason:'widget-job-lost',pendingKey:null};
      }
      return s;
    });
  }
  workspaces() { return [...this.slots.values()].filter(s=>!s.closed&&s.workspace).map(s=>s.workspace); }
  isActive() { return this.slots.size > 0 || this.entries.some(e => e.status === 'queued') || [...this.persistenceChecks.values()].some(c=>c.probe?.snapshot().status==='running'); }
  snapshot() {
    return { active: this.isActive(), concurrency: this.concurrency || 4,
      entries: this.entries.map(({ target, status, message, lastAttemptAt,widgetJob,projectPlan,saveCheck }) => ({
        id: target.syncTargetId, name: target.name, status, message, lastAttemptAt,
        widgetJob:widgetJob?{...widgetJob}:null, saveCheck:saveCheck?{...saveCheck}:null, projectReview:projectReview(projectPlan),
        open: this.slots.has(target.syncTargetId), busy: Boolean(this.slots.get(target.syncTargetId)?.busy||this.slots.get(target.syncTargetId)?.querying)
      })) };
  }
  catalog() {
    const s = this.store.get(), fingerprint = resumeFingerprint(s.resume);
    return { targets: this.getTargets().map(t => ({ id: t.syncTargetId, name: t.name,
      track: t.resumeRecruitType, history: s.resumeSyncHistory?.[t.syncTargetId] || null,
      resumeChanged: (() => { const h = s.resumeSyncHistory?.[t.syncTargetId]; const saved = h?.persistedVerifiedFingerprint || h?.userConfirmedFingerprint || h?.savedFingerprint || h?.fingerprint; return Boolean(saved && saved !== fingerprint); })()
    })), selected: s.settings.resumeSyncSelection || [], batch: this.snapshot() };
  }
  emit() { this.onChange(this.snapshot()); }
  record(entry) {
    const attempt = entry.attempt;
    this.store.update(s => {
      s.resumeSyncHistory ||= {};
      const old = s.resumeSyncHistory[entry.target.syncTargetId] || {};
      s.resumeSyncHistory[entry.target.syncTargetId] = { ...old, status: entry.status,
        lastAttemptAt: entry.lastAttemptAt, fingerprint: attempt.fingerprint,
        profileId: attempt.resume.activeProfileId || 'default',
        widgetJob:entry.widgetJob?{...entry.widgetJob}:null,
        // Field read-back, manual closing and user claims are not server persistence evidence.
        ...(entry.status === 'saved' && entry.saveEvidence ? { lastUpdatedAt: new Date().toISOString(), savedFingerprint: attempt.fingerprint, saveEvidence: entry.saveEvidence } : {}) };
      return s;
    });
  }
  captureResume() {
    const resume = structuredClone(this.store.get().resume);
    return { resume, fingerprint: resumeFingerprint(resume), file: this.attachmentPath?.(resume) || null };
  }
  applyPersistenceState(id,check,info) {
    if(this.persistenceChecks.get(id)!==check)return;
    const e=check.entry;
    if(check.epoch!==this.stopEpoch)return;
    e.saveCheck={id:info.id,status:info.status,reason:info.reason,expected:Number(info.expected)||0,matched:Number(info.matched)||0,receiptVerified:info.receiptVerified===true,httpStatus:info.httpStatus||null,businessStatus:info.businessStatus??null,serverExpected:info.serverExpected||0,serverMatched:info.serverMatched||0,blockedRequest:info.blockedRequest?{method:info.blockedRequest.method,path:info.blockedRequest.path}:null};
    if(info.status==='verified'&&resumeFingerprint(this.store.get().resume)!==check.attempt.fingerprint){e.status='review-required';e.saveCheck.status='failed';e.saveCheck.reason='resume-changed';e.message='核验对应的本机档案已改变，当前档案尚未核验；历史核验时间保留';this.emit();return;}
    if(info.status==='verified'&&!check.recorded){
      if(resumeFingerprint(this.store.get().resume)!==check.attempt.fingerprint){e.status='review-required';e.saveCheck.status='failed';e.saveCheck.reason='resume-changed';e.message='核验期间本机档案已改变，未登记官网存储成功；请核对当前档案';}
      else if(info.receiptVerified!==true||info.serverVerified!==true||info.readOnly!==true||info.phoneMatchesLocal!==true||info.groupCountsMatch!==true||info.criticalVerified!==true||!Number.isSafeInteger(info.expected)||info.expected<=0||info.matched!==info.expected){e.status='review-required';e.saveCheck.status='failed';e.saveCheck.reason='incomplete-proof';e.message='官网存储证据不完整，未登记成功';}
      else {try{const at=new Date().toISOString();this.store.update(s=>{if(resumeFingerprint(s.resume)!==check.attempt.fingerprint)throw Error('stale');s.resumeSyncHistory||={};const old=s.resumeSyncHistory[id]||{};s.resumeSyncHistory[id]={...old,status:'saved-verified',lastPersistedVerifiedAt:at,persistedVerifiedFingerprint:check.attempt.fingerprint,persistedVerification:{source:'fresh-meituan-resume-get-and-native-readback',scope:'observed-meituan-campus-fields-v1',httpStatus:info.httpStatus||null,businessStatus:info.businessStatus??null,serverExpected:info.serverExpected||0,serverMatched:info.serverMatched||0,expected:info.expected,matched:info.matched,phoneMatchesLocal:true,groupCountsMatch:true,receiptVerified:true,serverVerified:true,readOnly:true}};return s;});check.recorded=true;e.status='saved-verified';e.message=`官网存储只读核验通过：${info.matched}个适用字段一致。记录的是核验时间，不是新的保存时间；未投递`;}catch{e.status='manual-required';e.message='官网存储核验结果尚未成功落盘，请保留本次结果后查询；不重发保存';}}
    }else if(info.status==='running'){e.message='正在同一登录会话只读核验官网存储；不填写、不保存、不投递';}
    else if(['failed','lost','cancelled'].includes(info.status)){e.message=info.blockedRequest?`官网读取请求被只读保护拦截：${info.blockedRequest.method} ${info.blockedRequest.path}；未发送写请求，原页面保留`:'官网存储核验未通过或已停止；原填写页面未改动，请核对登录、当前档案或失败原因';}
    this.emit();
  }
  verifySaved(id) {
    const existing=this.persistenceChecks.get(id);
    if(existing?.probe?.snapshot().status==='running')return this.querySaved(id);
    const target=this.getTargets().find(t=>t.syncTargetId===id),slot=this.slots.get(id);
    if(!this.createPersistenceProbe||target?.id!=='meituan'||target.resumeRecruitType!=='campus')throw Error('该平台尚无官网存储自动核验');
    if(this.entries.find(e=>e.target.syncTargetId===id)?.status==='queued'||[...this.slots.values()].some(s=>s.entry.target.id===target.id&&s.entry.target.syncTargetId!==id))throw Error('请先完成同平台当前批次，保留排队顺序和同会话工作区');
    if(slot&&(slot.busy||slot.querying||jobNeedsQuery(slot.entry.widgetJob)||slot.entry.projectPlan))throw Error('请先完成当前字段任务与项目核对');
    const attempt=this.captureResume();if(slot&&slot.entry.attempt.fingerprint!==attempt.fingerprint)throw Error('本机档案已改变，请先核对当前页与档案再核验');
    let entry=this.entries.find(e=>e.target.syncTargetId===id);if(!entry){entry={target,status:'review-required',attempt,message:''};this.entries.push(entry);}
    entry.attempt=attempt;
    const check={entry,attempt,epoch:this.stopEpoch,recorded:false,probe:null};this.persistenceChecks.set(id,check);
    try{check.probe=this.createPersistenceProbe(target,resolveResumeForCompany(attempt.resume,target.id),info=>this.applyPersistenceState(id,check,info));this.applyPersistenceState(id,check,check.probe.snapshot());}catch{this.persistenceChecks.delete(id);entry.message='官网存储核验启动未完成，原页面和档案均保留';this.emit();throw Error(entry.message);}
    return this.snapshot();
  }
  async querySaved(id) {const check=this.persistenceChecks.get(id);if(!check?.probe)throw Error('尚无本次存储核验任务');this.applyPersistenceState(id,check,await check.probe.query());return this.snapshot();}
  start({ targetIds, concurrency = 4 } = {}) {
    if (this.isActive()) throw new Error('已有简历批次，请先关闭窗口或停止本轮');
    if (![4, 6].includes(concurrency)) throw new Error('请选择 4 或 6 个并行窗口');
    const targets = this.getTargets();
    if (!Array.isArray(targetIds) || !targetIds.length || targetIds.some(id => !targets.some(t => t.syncTargetId === id))) throw new Error('请至少选择一个有效平台');
    const attempt = this.captureResume();
    this.resume = attempt.resume;
    this.fingerprint = attempt.fingerprint;
    this.file = attempt.file;
    this.store.update(s => { s.settings.resumeSyncSelection = [...new Set(targetIds)]; return s; });
    this.persistenceChecks.clear();
    this.concurrency = concurrency; this.stopped = false;
    this.entries = [...new Set(targetIds)].map(id => ({ target: targets.find(t => t.syncTargetId === id), status: 'queued', attempt }));
    this.pump(); return this.snapshot();
  }
  pump() {
    if (this.stopped) return;
    for (const entry of this.entries) {
      if (this.slots.size >= this.concurrency) break;
      if (entry.status !== 'queued') continue;
      if ([...this.slots.values()].some(s => s.entry.target.id === entry.target.id)) continue;
      const used = new Set([...this.slots.values()].map(s => s.index));
      let index = 0; while (used.has(index)) index++;
      const slot = { entry, index, busy: true, closed: false, workspace: null };
      this.slots.set(entry.target.syncTargetId, slot);
      entry.status = 'running'; entry.lastAttemptAt = new Date().toISOString();
      // run catches all failures; retain the slot until its in-flight adapter settles.
      void this.run(slot);
    }
    this.emit();
  }
  async run(slot, {resumeWidgetJobId,resumeProjectsReconciled=false,resumeAttachmentPending=false}={}) {
    const e = slot.entry, t = e.target;
    try {
      this.record(e);
      if(!resumeWidgetJobId&&!resumeProjectsReconciled)slot.workspace = await this.createWorkspace(t, slot.index, this.concurrency, () => { void this.close(t.syncTargetId); }, state => {
        if (slot.closed || slot.busy || this.slots.get(t.syncTargetId)!==slot || state?.usable!==false || !['review-required','verified','manual-required'].includes(e.status)) return;
        e.status='manual-required'; e.message='当前网页已离开可核对表单，旧字段回读已失效；请检查页面后重新更新';
        try{this.record(e);}catch{e.message+='；状态记录写入失败，请保留当前页面';}this.emit();
      });
      if (slot.closed || this.stopped) throw new Error('本轮已停止');
      const workspace = { ...slot.workspace };
      for (const key of ['openWorkspace', 'run', 'setInputFiles']) {
        if (!workspace[key]) continue;
        workspace[key] = async (...args) => {
          if (slot.closed || this.stopped) throw new Error('本轮已停止');
          if(resumeFingerprint(this.store.get().resume)!==e.attempt.fingerprint)throw Error('本机简历已改变，请核对当前页面；不会继续写入旧档案');
          return slot.workspace[key](...args);
        };
      }
      const result = await this.getAdapter(t.id).fillResume(e.attempt.resume, {
        workspace, company: t, recruitType: t.resumeRecruitType, syncTargetId: t.syncTargetId,
        attachmentPath: e.attempt.file,
        resumeWidgetJobId,resumeProjectsReconciled,resumeAttachmentPending,
        onStep: info => { if (!slot.closed) { e.message = info.message; this.emit(); } }
      });
      if (!slot.closed && !this.stopped) {
        const allowed = ['login-required', 'review-required', 'manual-required', 'failed', 'verified', 'saved'];
        e.status = allowed.includes(result?.status) ? result.status : 'failed';
        e.message = String(result?.message || '请核对官网页面');
        if(result?.report?.projectPlan)e.projectPlan=result.report.projectPlan;
        else if(resumeProjectsReconciled)e.projectPlan=null;
        if(typeof result?.report?.attachmentPending==='boolean')e.attachmentPending=result.report.attachmentPending;
        if(result?.report?.widgetJob)e.widgetJob=widgetJobMeta(result.report.widgetJob,result.report.widgets||[]);
        if(resumeWidgetJobId&&e.widgetJob&&!e.projectPlan&&['review-required','verified','saved'].includes(e.status)&&e.widgetJob.status==='completed')e.widgetJob.continuationCompleted=true;
        if (e.status === 'saved') {
          if (typeof result.saveEvidence === 'string' && result.saveEvidence.trim()) e.saveEvidence = result.saveEvidence.slice(0, 500);
          else { e.status = 'review-required'; e.message = '尚无官网保存证据，请核对页面'; }
        }
      }
    } catch (error) {
      if (!slot.closed) { e.status = (resumeWidgetJobId||resumeProjectsReconciled)?'manual-required':'failed'; e.message = (resumeWidgetJobId||resumeProjectsReconciled)?'续填没有完成，当前页面已保留，请核对后继续':error.message; }
    } finally {
      slot.busy = false;
      if (slot.closed || this.stopped) e.status = 'cancelled';
      try { this.record(e); } catch {
        e.status=slot.workspace&&!slot.closed&&!this.stopped?'manual-required':'failed';
        e.message='本轮状态记录写入失败；当前核对页面已保留，请核对字段，不视为已保存';
      }
      if (slot.closed || this.stopped || e.status === 'failed') await this.release(slot);
      this.emit(); this.pump();
    }
  }
  async release(slot) {
    try { await slot.workspace?.dispose?.(); } finally {
      if (this.slots.get(slot.entry.target.syncTargetId) === slot) this.slots.delete(slot.entry.target.syncTargetId);
    }
  }
  async close(id) {
    const slot = this.slots.get(id);
    if (!slot || slot.closed) return;
    slot.closed = true;
    // Explicitly closing destroys the owner page. A pending handle must become
    // lost, otherwise retry is blocked forever while query has no page to read.
    if(jobNeedsQuery(slot.entry.widgetJob)){
      slot.entry.widgetJob={...slot.entry.widgetJob,status:'lost',reason:'widget-job-lost',pendingKey:null};
      this.record(slot.entry);
    }
    await slot.workspace?.dispose?.();
    if (!slot.busy) { this.slots.delete(id); this.emit(); this.pump(); }
  }
  async retry(id) {
    if(this.persistenceChecks.get(id)?.probe?.snapshot().status==='running')throw Error('请先查询或停止原存储核验，不重复启动填写');
    const entry = this.entries.find(e => e.target.syncTargetId === id);
    if (!entry || this.slots.get(id)?.busy||this.slots.get(id)?.querying || ['queued', 'retrying'].includes(entry.status)) throw new Error('请等待当前平台填写结束后重试');
    if(entry.projectPlan?.phase==='unknown')throw Error('项目替换状态待核对，请先查询原操作，不重放删除');
    if(jobNeedsQuery(entry.widgetJob))throw Error('原字段任务仍在运行或状态未知，请先查询进度；当前页面已保留');
    // Prepare before discarding the current review page. Each attempt owns its
    // facts/file/fingerprint; refreshing this entry never changes in-flight peers.
    const attempt = this.captureResume();
    this.persistenceChecks.delete(id); entry.saveCheck=null;
    // Hold scheduling while replacing this slot to keep retry deterministic.
    entry.status = 'retrying';
    const epoch = this.stopEpoch;
    const slot = this.slots.get(id);
    if (slot) { slot.closed = true; await this.release(slot); }
    if (epoch !== this.stopEpoch) { entry.status = 'cancelled'; return this.snapshot(); }
    entry.attempt = attempt;
    entry.widgetJob=null;entry.projectPlan=null;
    entry.status = 'queued'; entry.message = ''; this.stopped = false;
    this.pump(); return this.snapshot();
  }
  async confirmSaved(id) {
    const slot = this.slots.get(id);
    if (!slot || slot.busy||slot.querying ||(slot.entry.projectPlan&&slot.entry.projectPlan.phase!=='complete')||jobNeedsQuery(slot.entry.widgetJob)|| !['review-required', 'manual-required', 'verified'].includes(slot.entry.status)) throw new Error('请先查询未结束任务、完成填写和官网保存，再确认');
    this.store.update(s => {
      const h = s.resumeSyncHistory?.[id];
      if (!h) throw new Error('尚无本轮更新记录');
      h.lastUserConfirmedAt = new Date().toISOString();
      h.userConfirmedFingerprint = slot.entry.attempt.fingerprint;
      h.status = 'user-confirmed';
      return s;
    });
    slot.entry.status = 'user-confirmed';
    await this.close(id);
    return this.snapshot();
  }
  focus(id) { this.slots.get(id)?.workspace?.focus?.(); }
  async queryWidgetJob(id){
    const slot=this.slots.get(id),entry=slot?.entry;
    if(!slot||slot.closed||slot.busy||slot.querying||this.stopped||!['meituan','bytedance'].includes(entry.target.id)||!entry.widgetJob)throw Error('请等待当前平台结束，并保留原任务页面后查询');
    slot.querying=true;this.emit();const epoch=this.stopEpoch,jobId=entry.widgetJob.id;
    try{let state;try{state=await (entry.target.id==='bytedance'?readByteDateJob:readMeituanWidgetJob)(slot.workspace,jobId,entry.target.id==='bytedance'?planByteDates(entry.attempt.resume):undefined);}catch{state={id:jobId,status:'unknown',reason:'widget-job-status-unavailable'};}
      if(slot.closed||this.stopped||epoch!==this.stopEpoch||this.slots.get(id)!==slot)return this.snapshot();
      const previous=entry.widgetJob;
      entry.widgetJob=widgetJobMeta({...state,continuationCompleted:previous.continuationCompleted},state.records||[]);
      if(entry.widgetJob&&state.status==='unknown'&&!state.records)Object.assign(entry.widgetJob,{recordCount:previous.recordCount,verifiedCount:previous.verifiedCount,failedCount:previous.failedCount,pendingKey:previous.pendingKey});
      if(!entry.widgetJob)throw Error('字段任务状态未核实，请保留页面');
      entry.message=entry.widgetJob.status==='completed'?`原控件任务已结束，记录 ${entry.widgetJob.recordCount} 项；可继续填写文本，再核对官网保存`:
        entry.widgetJob.status==='running'?'原控件任务仍在运行，请稍后查询；不会重复启动':entry.widgetJob.status==='lost'?'原任务页面已改变或丢失，请手动核对；没有确认保存':entry.widgetJob.status==='failed'?'原控件任务已失败，请核对已产生的字段变化':'原任务状态暂未读到，请再次查询；不会重复启动';
      this.record(entry);
    }finally{slot.querying=false;this.emit();}
    return this.snapshot();
  }
  async continueWidgetJob(id){
    const slot=this.slots.get(id),entry=slot?.entry;
    if(!slot||slot.closed||slot.busy||slot.querying||this.stopped||!['meituan','bytedance'].includes(entry.target.id)||!entry.widgetJob||entry.widgetJob.status!=='completed'||entry.widgetJob.continuationCompleted)throw Error('请先查询原控件任务，确认已结束后再继续填写');
    if(resumeFingerprint(this.store.get().resume)!==entry.attempt.fingerprint)throw Error('本机简历已改变，请核对当前页面后重新更新；原页面已保留');
    slot.busy=true;entry.status='running';entry.message='保留原页面，继续填写尚未处理的文本字段';this.emit();
    await this.run(slot,{resumeWidgetJobId:entry.widgetJob.id});return this.snapshot();
  }
  async retryWidgetJob(id){
    const slot=this.slots.get(id),entry=slot?.entry;
    if(!slot||slot.closed||slot.busy||slot.querying||this.stopped||entry.target.id!=='meituan'||!entry.widgetJob||entry.widgetJob.status!=='completed'||!entry.widgetJob.failedCount||entry.projectPlan)throw Error('请保留已结束的失败控件任务，先查询进度再补齐');
    if(resumeFingerprint(this.store.get().resume)!==entry.attempt.fingerprint)throw Error('本机简历已改变，请核对当前页面；不会覆盖现有字段');
    const old=entry.widgetJob,epoch=this.stopEpoch;slot.busy=true;entry.message='原页仅补齐已知失败且仍为空的控件，不重传附件或重填文本';this.emit();
    const workspace=guardResumeWorkspace({run:async code=>{if(slot.closed||this.stopped||epoch!==this.stopEpoch)throw Error('本轮已停止');return slot.workspace.run(code);}},resolvePlatformUrl('meituan',entry.target.resumeRecruitType,'resume'));
    try{const rows=await retryFailedWidgets(workspace,planMeituanWidgets(entry.attempt.resume),old.id);
      if(slot.closed||this.stopped||epoch!==this.stopEpoch)return this.snapshot();
      entry.widgetJob=widgetJobMeta({...rows.widgetJob,continuationCompleted:old.continuationCompleted},rows);entry.status='review-required';entry.message=`原页控件核对 ${entry.widgetJob.verifiedCount}/${entry.widgetJob.recordCount} 项；没有重传附件、重填文本或官网保存`;
    }catch(error){if(!slot.closed&&!this.stopped&&epoch===this.stopEpoch){if(error.widgetJob)entry.widgetJob=widgetJobMeta({...error.widgetJob,continuationCompleted:old.continuationCompleted},error.partialResults||[]);entry.status='manual-required';entry.message=error.widgetJob?'补齐任务状态待查询，保留原句柄和页面，不会重复发送':'失败控件补齐未完成，请核对原页面；没有重传或保存';}}
    finally{slot.busy=false;if(!slot.closed&&!this.stopped&&epoch===this.stopEpoch){try{this.record(entry);}catch{entry.status='manual-required';entry.message='控件核对结果未落盘，当前页面已保留';}}if(slot.closed||this.stopped){entry.status='cancelled';await this.release(slot);}this.emit();this.pump();}
    return this.snapshot();
  }
  projectSlot(id,planId){
    const slot=this.slots.get(id),e=slot?.entry;
    if(!slot||slot.closed||slot.busy||slot.querying||this.stopped||!['meituan','bytedance'].includes(e.target.id)||e.target.id==='bytedance'&&(e.target.resumeRecruitType!=='campus'||e.projectPlan?.platform!=='bytedance')||!e.projectPlan||e.projectPlan.id!==planId||jobNeedsQuery(e.widgetJob))throw Error('请先等待原任务结束并保留项目差异页面');
    if(resumeFingerprint(this.store.get().resume)!==e.attempt.fingerprint)throw Error('本机简历已改变，请核对当前页面后重新更新');
    return slot;
  }
  async queryProjects(id,planId){
    const slot=this.projectSlot(id,planId),epoch=this.stopEpoch;slot.querying=true;this.emit();
    const current=()=>!slot.closed&&!this.stopped&&epoch===this.stopEpoch;
    try{if(slot.entry.target.id==='bytedance'){if(slot.entry.projectPlan.startedReplacement){const plan=structuredClone(slot.entry.projectPlan);await queryByteProjectReplacement(slot.workspace,plan);if(current()){if(resumeFingerprint(this.store.get().resume)!==slot.entry.attempt.fingerprint)throw Error('resume-changed');slot.entry.projectPlan=plan;slot.entry.message='原字节项目步骤已只读核对；未重复删除/新增，请查看进度后确认继续';}}else{const p=await inspectByteProjectDifference(slot.workspace,slot.entry.attempt.resume,{previousId:planId});if(!p.ok)throw Error('project-inspection-uncertain');if(current()){if(resumeFingerprint(this.store.get().resume)!==slot.entry.attempt.fingerprint)throw Error('resume-changed');slot.entry.projectPlan=p;slot.entry.message='字节项目已只读核对；请查看差异，再确认替换或官网对齐后续填；本次没有填写';}}}else{await queryProjectReplacement(slot.workspace,slot.entry.projectPlan);if(current())slot.entry.message='原项目操作已只读核对；继续替换前仍需再次确认，不会自动重发删除';}}
    catch{if(current()){slot.entry.status='manual-required';slot.entry.message='原项目操作或本机档案仍待核实，请保留当前页面，不重放删除';}}
    finally{slot.querying=false;this.emit();}return this.snapshot();
  }
  async replaceProjects(id,planId,confirmed){
    if(confirmed!==true)throw Error('请先查看差异并确认项目替换');
    const slot=this.projectSlot(id,planId),e=slot.entry;if(e.projectPlan.phase==='unknown')throw Error('请先查询原项目操作，再核对是否继续');
    if(e.target.id==='bytedance'&&e.projectPlan.canReplace!==true)throw Error('请在字节官网对齐项目后重新核对；当前操作入口尚未核实');
    slot.busy=true;e.message='已确认项目替换，先备份，再逐段核验删除和重建；不会保存或投递';this.emit();
    const epoch=this.stopEpoch,workspace={run:script=>{if(slot.closed||this.stopped||epoch!==this.stopEpoch)throw Error('本轮已停止');if(resumeFingerprint(this.store.get().resume)!==e.attempt.fingerprint)throw Error('本机简历已改变，请核对当前页面');return slot.workspace.run(script);}};
    try{
      const result=await (e.target.id==='bytedance'?replaceByteProjects:replaceProjects)(workspace,e.projectPlan,{confirmed:true,backup:this.backupProjects});
      if(!result.complete){e.status='manual-required';e.message='项目替换尚未确认，已保留备份和原操作，请先查询进度，不重复删除';}
      else if(!slot.closed&&!this.stopped&&epoch===this.stopEpoch){e.widgetJob=null;e.status='running';await this.run(slot,{resumeProjectsReconciled:true,resumeAttachmentPending:e.target.id==='bytedance'&&e.attachmentPending===true});}
    }finally{
      slot.busy=false;
      if(slot.closed||this.stopped){e.status='cancelled';await this.release(slot);}
      try{this.record(e);}catch{if(!slot.closed&&!this.stopped){e.status='manual-required';e.message='本轮状态记录写入失败；当前核对页面已保留，不视为已保存';}}
      this.emit();this.pump();
    }
    return this.snapshot();
  }
  async refreshProjects(id,planId){
    const slot=this.projectSlot(id,planId),e=slot.entry;if(e.projectPlan.inFlight)throw Error('请先查询原项目操作，不丢弃未知回执');
    slot.busy=true;this.emit();const epoch=this.stopEpoch;
    try{
      const workspace={run:script=>{if(slot.closed||this.stopped||epoch!==this.stopEpoch)throw Error('本轮已停止');return slot.workspace.run(script);}};
      const plan=await (e.target.id==='bytedance'?inspectByteProjectDifference:inspectProjectDifference)(workspace,e.attempt.resume,{previousId:e.projectPlan.id,...(e.target.id==='bytedance'?{freshId:true}:{})});if(!plan.ok)throw Error('项目差异仍未核实，请保留原页面');
      if(resumeFingerprint(this.store.get().resume)!==e.attempt.fingerprint)throw Error('本机简历已改变，请核对当前页面后重新更新');
      if(!slot.closed&&!this.stopped&&epoch===this.stopEpoch){
        e.projectPlan=plan;
        if(plan.needsReplacement){e.status='review-required';e.message='已更新当前项目差异，请查看最新列表后确认；未删除或保存';}
        else{e.projectPlan=null;e.status='running';await this.run(slot,{resumeProjectsReconciled:true,...(e.target.id==='bytedance'&&e.attachmentPending===true?{resumeAttachmentPending:true}:{}),...(e.target.id==='bytedance'&&e.widgetJob?.id?{resumeWidgetJobId:e.widgetJob.id}:{})});}
      }
    }catch(error){if(!slot.closed&&!this.stopped){e.status='manual-required';e.message='项目差异核对没有完成，原页面和操作记录已保留；请核对后再继续';}throw error;}
    finally{slot.busy=false;if(slot.closed||this.stopped){e.status='cancelled';await this.release(slot);}
      try{this.record(e);}catch{if(!slot.closed&&!this.stopped){e.status='manual-required';e.message='本轮状态记录写入失败；当前核对页面已保留，不视为已保存';}}
      this.emit();this.pump();}
    return this.snapshot();
  }
  async stop() {
    this.stopped = true; this.stopEpoch++;
    for (const check of this.persistenceChecks.values()) {
      if (check.probe?.snapshot().status !== 'running') continue;
      check.probe.dispose();
      check.entry.saveCheck = { ...check.entry.saveCheck, status: 'cancelled', reason: 'cancelled' };
      check.entry.message = '只读存储核验已停止；原填写页面与历史保存记录保留';
    }
    for (const e of this.entries) if (e.status === 'queued') e.status = 'cancelled';
    await Promise.all([...this.slots.keys()].map(id => this.close(id)));
    this.emit(); return this.snapshot();
  }
}

module.exports = { ResumeBatch, resumeFingerprint, tileBounds };
