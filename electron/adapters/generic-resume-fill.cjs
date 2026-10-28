const { createUniversalResumePlan } = require('../resume-plan.cjs');
const { matchField, normalizeComparableValue } = require('../field-matching.cjs');
const { resolvePlatformUrl } = require('../platform-manifests.cjs');
const { LOGIN_AND_FORM_PROBE, INSPECT_FORM_FIELDS } = require('../form-inspection.cjs');
const {resolveJdFormControl,buildEnsureJdGroupsScript}=require('../jd-form-context.cjs');
const {planJdWidgets,executeJdWidgets}=require('../jd-widget-fill.cjs');
const {buildJdRequiredFieldsScript}=require('../jd-required-fields.cjs');
const {getByteDanceFormContext,resolveByteDanceFormControl}=require('../bytedance-form-context.cjs');
const {getMeituanFormContext,resolveMeituanFormControl}=require('../meituan-form-context.cjs');
const {planMeituanWidgets,executeMeituanWidgets}=require('../meituan-widget-fill.cjs');
const {readMeituanWidgetJob}=require('../meituan-widget-job.cjs');
const {planByteDates}=require('../bytedance-date-fill.cjs');
const {readByteDateJob,executeByteDateJob,recheckByteDates}=require('../bytedance-date-job.cjs');
const {recheckWidgetResults}=require('../resume-widget-review.cjs');
const {guardResumeWorkspace}=require('../resume-target-guard.cjs');
const {ensureMeituanGroups}=require('../meituan-groups.cjs');
const {inspectProjectDifference,projectReview}=require('../meituan-project-reconcile.cjs');
const {inspectByteProjectDifference}=require('../bytedance-project-review.cjs');

function radioComparableValue(value) {
  const normalized = normalizeComparableValue(value);
  if (normalized === '1') return '是';
  if (normalized === '0') return '否';
  return normalized;
}

function planGenericResumeFields(plan, fields) {
  const writable = [];
  const manual = [];
  const used = new Set();
  // 页面是否带经历区块信息（实习经历-1/项目经历-2…）
  const hasSections = (fields || []).some((field) => field.section);
  // The APP still exposes legacy idCard. Use its supplied number for the official
  // generic document-number label only when an explicit idNumber is absent.
  // Never emit both identities or guess document type.
  const hasCanonicalIdentity=plan.some(i=>i.key==='basic.idNumber'&&String(i.value??'').trim());
  const identityPlan=plan.filter(i=>i.key!=='basic.idCard'||!hasCanonicalIdentity).map(i=>i.key==='basic.idCard'?{...i,keywords:[...new Set([...(i.keywords||[]),'证件号码','证件号'])]}:i);
  for (const item of identityPlan) {
    const expected = normalizeComparableValue(item.value);
    let available = (fields || []).filter((field) => {
      if (used.has(field.index)) return false;
      if (field.readOnly) return false;
      if (!String(field.type || '').includes('radio')) return true;
      const optionValue = radioComparableValue(field.controlValue || field.label?.split(/\s+/).at(-1));
      return !optionValue || optionValue === expected;
    });
    // 按经历区块限定候选：兄弟区块的祖先文本不再互相污染（项目名称 只在本区块内匹配）
    if (hasSections && item.sectionHint) {
      const scoped = available.filter((field) => {
        if (!field.section) return false;
        const matchesAlias = item.sectionHint.aliases.some((alias) => field.section.startsWith(alias));
        const seg = field.section.match(/(\d+)$/);
        return matchesAlias && seg && Number(seg[1]) === item.sectionHint.number;
      });
      available = scoped;
    }
    // resume-plan decorates segment 2+ keywords for display. Once the actual
    // numbered section is scoped, that annotation is not part of the site label.
    const matchItem=hasSections&&item.sectionHint?{...item,keywords:(item.keywords||[]).map(k=>k.replace(/\(第\d+段\)$/,''))}:item;
    let match = matchField(matchItem, available);
    if (match.status === 'ambiguous') {
      // 同构多槽位：阿里等站的多段经历每段都有完全相同的「公司或组织名称」等字段。
      // 候选标签/类型/占位符完全一致时视为槽位数组而非真歧义，按顺序取第一个未占用的槽位。
      const cands = match.candidates || [];
      // 判定“同构槽位”：类型与占位符一致即可（label 常嵌入唯一字段名如 tfitem_5.name，不能逐字比较）
      const sameSlotShape = (a, b) => a.field.type === b.field.type
        && (a.field.placeholder || '') === (b.field.placeholder || '');
      if (cands.length >= 1 && cands[0].confidence >= 0.78 && cands.slice(1).every((x) => sameSlotShape(x, cands[0]))) {
        match = { status: 'matched', field: cands[0].field, confidence: cands[0].confidence, candidates: cands };
      }
    }
    if (match.status !== 'matched') {
      manual.push({ ...item, reason: match.status, confidence: match.confidence });
      continue;
    }
    // 美团(mtd)/腾讯校招(el)等组件没有 id/name，但 label 匹配高置信。
    // 此时用「同页同序号」定位：inspect 与写入发生在同一页面状态，序号确定；写入后仍有回读核验兜底。
    const radioLocator = match.field.id
      ? { kind: 'id', value: match.field.id }
      : (match.field.name
          ? { kind: 'radio', value: match.field.name, controlValue: match.field.controlValue }
          : { kind: 'index', value: match.field.index });
    const plainLocator = match.field.id
      ? { kind: 'id', value: match.field.id }
      : (match.field.name
          ? { kind: 'name', value: match.field.name, type: match.field.type }
          : { kind: 'index', value: match.field.index });
    used.add(match.field.index);
    writable.push({
      ...item,
      fieldIndex: match.field.index,
      fieldType: match.field.type,
      confidence: match.confidence,
      observedBefore: match.field.value
      , locator: match.field.meituanLocator ? {kind:'meituan-context',...match.field.meituanLocator} : match.field.byteLocator ? {kind:'bytedance-context',...match.field.byteLocator,...(typeof item.projectName==='string'?{projectName:item.projectName}:{})} : match.field.jdLocator ? {kind:'jd-context',...match.field.jdLocator} : String(match.field.type || '').includes('radio') ? radioLocator : plainLocator
    });
  }
  return { writable, manual };
}

function buildExecuteFieldPlanScript(fieldPlan) {
  function execute(planned) {
    // 与 form-inspection.cjs INSPECT_FORM_FIELDS 保持逐字符一致的筛选（含 file input，不额外排除），
    // index 定位才与 inspect 序号严格对齐——曾因排除 file input 整体错位 3 位写错字段。
    const inspectControls = () => [...document.querySelectorAll('input, textarea, select')]
      .filter((control) => !control.disabled && control.type !== 'hidden' && control.type !== 'button' && control.type !== 'submit')
      .filter((control) => !control.closest('form[action*="login"], [class*="login"], [class*="captcha"], [class*="auth"], [role="dialog"]'));
    const resolveControl = (item) => {
      let control = null;
      if (item.locator?.kind === 'meituan-context') {
        control=resolveMeituanFormControl(item.locator);
      } else if (item.locator?.kind === 'bytedance-context') {
        control=resolveByteDanceFormControl(item.locator);
      } else if (item.locator?.kind === 'jd-context') {
        control=resolveJdFormControl(item.locator);
      } else if (item.locator?.kind === 'index') {
        const all = inspectControls();
        control = all[item.locator.value] || null;
      } else {
        const selector = item.locator?.kind === 'id'
          ? '#' + CSS.escape(item.locator.value)
          : '[name="' + CSS.escape(item.locator?.value || '') + '"]';
        const candidates = [...document.querySelectorAll(selector)]
          .filter((candidate) => !candidate.disabled && candidate.type !== 'hidden' && candidate.type !== 'submit')
          .filter((candidate) => item.locator?.kind !== 'radio' || candidate.value === item.locator.controlValue);
        control = candidates.length === 1 ? candidates[0] : null;
      }
      return control;
    };
    const writableControl = (control) => control && control.isConnected !== false && !control.disabled && !control.readOnly
      && !['password', 'file', 'hidden', 'button', 'submit', 'reset', 'image'].includes(control.type)
      && !control.closest?.('.atsx-select, .atsx-date-picker, .resumeEditForm-hiddenField, form[action*="login"], [class*="login"], [class*="captcha"], [class*="auth"], [role="dialog"]');
    const routeOf = () => {
      if (typeof location === 'undefined') return null;
      const url = new URL(location.href);
      return JSON.stringify([url.origin, url.pathname, url.searchParams.get('type'), url.hash.split('?')[0], new URLSearchParams(url.hash.split('?')[1] || '').get('type')]);
    };
    const initialRoute = routeOf(), initialBody = document.body, initialDocument = document.documentElement;
    const boundControls = planned.map(resolveControl);
    let pageLost = false;
    const pageCurrent = () => {
      try { return !pageLost && routeOf() === initialRoute && document.body === initialBody && document.documentElement === initialDocument; }
      catch { return false; }
    };
    return planned.map((item, index) => {
      if (!pageCurrent()) { pageLost = true; return { key: item.key, written: false, observed: '', error: 'page-changed' }; }
      const control = boundControls[index];
      if (!control) return { key: item.key, written: false, observed: '', error: 'control-missing' };
      if (resolveControl(item) !== control) return { key: item.key, written: false, observed: '', error: 'control-changed' };
      // Recheck the actual node, not the earlier inspection: SPA remounts can
      // turn a text locator into a widget search/date/internal or readonly field.
      // Keep index enumeration unchanged (including file inputs) and preserve
      // Meituan/Byte/JD context resolution above. Stop before focus/setter/events.
      if (!writableControl(control)) {
        return { key: item.key, written: false, observed: '', error: 'unsupported-control' };
      }
      const ensureCurrent = () => {
        if (!pageCurrent()) { pageLost = true; throw new Error('page-changed'); }
        if (!writableControl(control) || resolveControl(item) !== control) throw new Error('control-changed');
      };
      const value = String(item.value ?? '');
      // Project identity is already explicitly aligned. Rewriting its name via
      // an intermediate empty string would invalidate our own per-event anchor.
      if(item.locator?.kind==='bytedance-context'&&item.locator.projectName!==undefined&&item.locator.label==='项目名称')return{key:item.key,written:value.trim()===item.locator.projectName&&control.value.trim()===item.locator.projectName,observed:control.value,unchanged:true};
      try {
        if (control.type === 'checkbox' || control.type === 'radio') {
          const normalized = value.trim();
          const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
          if (!checkedSetter) throw new Error('checked-setter-missing');
          ensureCurrent();
          if (control.type === 'radio') checkedSetter.call(control, true);
          else checkedSetter.call(control, normalized === '是' || normalized === 'true' || normalized === '1');
        } else if (control.tagName === 'SELECT') {
          const option = [...control.options].find((candidate) =>
            candidate.value === value || candidate.textContent.trim() === value
          );
          if (!option) throw new Error('option-missing');
          ensureCurrent();
          control.value = option.value;
        } else {
          const prototype = control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          if (!setter) throw new Error('value-setter-missing');
          // element-ui 等组件的输入状态机依赖 focus/composition 事件：先聚焦再写，
          // 否则合成 input 事件可能被组件丢弃，随后表单刷新把字段回滚成空
          control.dispatchEvent(new Event('focus', { bubbles: true }));
          ensureCurrent();
          setter.call(control, '');
          control.dispatchEvent(new Event('compositionstart', { bubbles: true }));
          ensureCurrent();
          control.dispatchEvent(new Event('input', { bubbles: true }));
          ensureCurrent();
          setter.call(control, value);
          control.dispatchEvent(new Event('compositionend', { bubbles: true }));
          ensureCurrent();
        }
        control.dispatchEvent(new Event('input', { bubbles: true }));
        ensureCurrent();
        control.dispatchEvent(new Event('change', { bubbles: true }));
        ensureCurrent();
        control.dispatchEvent(new Event('blur', { bubbles: true }));
        ensureCurrent();
        const observed = control.type === 'radio'
          ? (control.checked ? (control.value || value) : '')
          : (control.type === 'checkbox' ? (control.checked ? '是' : '否') : control.value);
        return { key: item.key, fieldIndex: item.fieldIndex, locator: item.locator, expected: value, observed, written: true };
      } catch (error) {
        return { key: item.key, fieldIndex: item.fieldIndex, locator: item.locator, expected: value, observed: '', written: false, error: error.message };
      }
    });
  }
  return `(()=>{const resolveJdFormControl=${resolveJdFormControl.toString()};const getMeituanFormContext=${getMeituanFormContext.toString()};const resolveMeituanFormControl=${resolveMeituanFormControl.toString()};const getByteDanceFormContext=${getByteDanceFormContext.toString()};const resolveByteDanceFormControl=${resolveByteDanceFormControl.toString()};return (${execute.toString()})(${JSON.stringify(fieldPlan)});})()`;
}

function mergeExecutionWithInspection(execution, fieldsAfter) {
  return (execution || []).map((item) => ({
    ...item,
    observedImmediately: item.observed,
    observed: (() => {
      if (item.locator?.kind === 'index') {
        const field = (fieldsAfter || [])[item.locator.value];
        return String(field?.type || '').includes('radio') && ['是', '否'].includes(normalizeComparableValue(item.expected))
          ? (field?.value ? radioComparableValue(field.value) : '')
          : (field?.value || '');
      }
      const stable = (fieldsAfter || []).filter((field) => {
        if (item.locator?.kind === 'meituan-context') return field.meituanLocator&&JSON.stringify({kind:'meituan-context',...field.meituanLocator})===JSON.stringify(item.locator);
        if (item.locator?.kind === 'bytedance-context') return field.byteLocator&&JSON.stringify({kind:'bytedance-context',...field.byteLocator})===JSON.stringify(item.locator);
        if (item.locator?.kind === 'jd-context') return field.jdLocator&&JSON.stringify({kind:'jd-context',...field.jdLocator})===JSON.stringify(item.locator);
        if (item.locator?.kind === 'id') return field.id === item.locator.value;
        if (item.locator?.kind === 'radio') return field.name === item.locator.value && field.controlValue === item.locator.controlValue;
        if (item.locator?.kind === 'name') return field.name === item.locator.value;
        return false;
      });
      if (stable.length === 1) return String(stable[0].type || '').includes('radio') && ['是', '否'].includes(normalizeComparableValue(item.expected))
        ? (stable[0].value ? radioComparableValue(stable[0].value) : '')
        : stable[0].value;
      return '';
    })()
  }));
}

function summarizeGenericVerification(results) {
  const verified = [];
  const mismatched = [];
  const failed = [];
  for (const item of results || []) {
    if (!item.written) failed.push(item.key);
    else if (normalizeComparableValue(item.expected) === normalizeComparableValue(item.observed)) verified.push(item.key);
    else mismatched.push(item.key);
  }
  return { verified, mismatched, failed };
}

// 探测登录态：页面跳转期间 executeJavaScript 可能超时，等待后重试一次。
async function probeFormState(workspace) {
  try {
    return await workspace.run(LOGIN_AND_FORM_PROBE);
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return workspace.run(LOGIN_AND_FORM_PROBE);
  }
}

// 带重试的字段写入：Vue/React 受控组件会在重渲染时回滚第一步「清空」，导致字段被写空。
// 每轮写入后立即回读；mismatched/failed 的字段用最新页面索引再补写一轮（最多 2 轮）。
async function executeFieldPlanWithRetry(workspace, plan, initialFields, { onProgress } = {}) {
  // 日志显示名：优先中文关键词（如「姓名」「手机号」），经历组带上段序号（「项目经历 1·项目名称」）
  const displayName = (item) => {
    if (item.label) return item.label;
    const keyword = (item.keywords || []).find((kw) => /^[\u4e00-\u9fa5]{2,8}$/.test(kw)) || String(item.key || '').split('.').pop();
    return item.segmentLabel ? `${item.segmentLabel}·${keyword}` : keyword;
  };
  const executions = [];
  let pendingPlan = plan;
  let fields = initialFields;
  for (let pass = 0; pass < 3; pass += 1) {
    if (!pendingPlan.length) break;
    const planned = planGenericResumeFields(pendingPlan, fields);
    if (!planned.writable.length) {
      // 首轮写入可能触发表单段重挂载（如 el-select 收到文本后整段重建），字段暂时消失：
      // 等待后重新读取页面再试，而不是直接放弃
      if (pass === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        fields = await workspace.run(INSPECT_FORM_FIELDS);
        continue;
      }
      break;
    }
    if (onProgress) for (const item of planned.writable) onProgress({ phase: 'writing', field: displayName(item), pass });
    const immediate = await workspace.run(buildExecuteFieldPlanScript(planned.writable));
    if (!immediate || !immediate.length) break;
    // 表单段重挂载需要足够稳定窗口；读取过早会把暂时消失的字段误判为写入失败
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const fieldsAfter = await workspace.run(INSPECT_FORM_FIELDS);
    if (!fieldsAfter || !fieldsAfter.length) break;
    const execution = mergeExecutionWithInspection(immediate, fieldsAfter);
    if (onProgress) {
      for (const record of execution) {
        if (record.written === false) onProgress({ phase: 'failed', field: displayName(planned.writable.find((w) => w.key === record.key) || record), pass });
        else if (normalizeComparableValue(record.expected) === normalizeComparableValue(record.observed)) onProgress({ phase: 'verified', field: displayName(planned.writable.find((w) => w.key === record.key) || record), pass });
        else onProgress({ phase: 'mismatched', field: displayName(planned.writable.find((w) => w.key === record.key) || record), pass });
      }
    }
    for (const record of execution) executions.push(record);
    const verification = summarizeGenericVerification(execution);
    const retryKeys = new Set([...verification.mismatched, ...verification.failed]);
    if (!retryKeys.size) break;
    // 实测腾讯校招：批量写入会引发表单段延迟刷新，把部分字段清空；只补写失败字段仍会被再次清掉，
    // 而「整批再写一遍」可以稳定收敛（第二遍写入后表单状态已稳定）。因此第二轮重写全量计划。
    pendingPlan = pass === 0 ? plan : plan.filter((item) => retryKeys.has(item.key));
    fields = fieldsAfter;
  }
  // 同 key 保留最后一轮结果
  const byKey = new Map();
  for (const record of executions) byKey.set(record.key, record);
  return [...byKey.values()];
}

function createGenericResumeFill(companyId, siteName) {
  return async function fillResume(resume, { workspace, company, recruitType = 'social', syncTargetId, taskId, onStep, attachmentPath,resumeWidgetJobId,resumeProjectsReconciled=false,resumeAttachmentPending=false } = {}) {
    if (!workspace?.openWorkspace || !workspace?.run) throw new Error('浏览器工作区未就绪');
    const url = resolvePlatformUrl(companyId, recruitType, 'resume');
    const step = (name, message) => onStep?.({ step: name, message });
    try {
    let resumedWidgetState=null;
    if(resumeWidgetJobId){
      if(!['meituan','bytedance'].includes(companyId))throw Error('该平台没有可续填的字段任务');
      try{resumedWidgetState=await (companyId==='bytedance'?readByteDateJob:readMeituanWidgetJob)(workspace,resumeWidgetJobId,companyId==='bytedance'?planByteDates(resume):undefined);}catch{resumedWidgetState={id:resumeWidgetJobId,status:'unknown',reason:'widget-job-status-unavailable'};}
      if(resumedWidgetState.status!=='completed')return {ok:false,status:'review-required',message:'原字段任务尚未明确结束，当前页面保留，请先查询进度',report:{widgetJob:resumedWidgetState,widgets:resumedWidgetState.records||[]}};
    }
    step('loading', resumeWidgetJobId?`正在原页面继续核对${siteName}字段…`:`正在打开${siteName}简历页…`);
    if(!resumeWidgetJobId&&!resumeProjectsReconciled)await workspace.openWorkspace({
      company,
      url,
      mode: 'resume-review',
      title: `核对${siteName}简历`,
      context: { action: 'fill-resume', companyId, syncTargetId: syncTargetId || companyId, taskId: taskId || null, recruitType }
    });
    const probe = await probeFormState(workspace);
    if (probe.isNotFound || probe.loginRequired) {
      return { ok: false, status: 'login-required', message: `请先在当前${siteName}页面完成登录，然后重新更新` };
    }
    if (!probe.inputCount) {
      return { ok: false, status: 'manual-required', message: `${siteName}页面尚未出现可识别表单，请在当前页面手动维护` };
    }
    // SPA 可能在首次探测后跳转到登录页。写入 DOM 前再做一次认证保护，避免把手机号等简历值写进登录框。
    const preWriteProbe = await probeFormState(workspace);
    if (preWriteProbe.isNotFound || preWriteProbe.loginRequired) {
      return { ok: false, status: 'login-required', message: `请先在当前${siteName}页面完成登录，然后重新更新` };
    }
    workspace=guardResumeWorkspace(workspace,url);
    const isByteCampus=companyId==='bytedance'&&new URL(url).origin==='https://jobs.bytedance.com'&&new URL(url).pathname==='/campus/resume/edit';
    const checkByteProjects=async()=>{
      const plan=await inspectByteProjectDifference(workspace,resume);
      if(!plan.ok)return{ok:false,status:'manual-required',message:'字节项目结构尚未核实，已保留当前页面；不会上传或填写',report:{projectError:plan.error},applyRisk:'review-before-save'};
      if(plan.needsReplacement)return{ok:false,status:'review-required',message:plan.canReplace?'字节官网项目与本机不一致，已停止上传及填写；请查看差异并确认替换，先备份再逐步核验，不会保存或投递':'字节官网项目与本机不一致，当前替换入口尚未核实；请在官网对齐后重新核对续填，不会保存或投递',report:{projectPlan:plan,projectReview:projectReview(plan),attachmentPending:!!attachmentPath&&!resumeWidgetJobId&&(!resumeProjectsReconciled||resumeAttachmentPending)},applyRisk:'review-before-save'};
      return null;
    };
    if(isByteCampus){const review=await checkByteProjects();if(review)return review;}
    // 简历附件：用户在软件里上传过 PDF/DOC 且页面有简历附件输入框时，直接把文件注入
    let attachment = null;
    if (!resumeWidgetJobId&&(!resumeProjectsReconciled||isByteCampus&&resumeAttachmentPending)&&attachmentPath && workspace?.setInputFiles) {
      step('attachment', '检测到简历附件入口，正在上传你的简历文件…');
      try {
        attachment = await workspace.setInputFiles(attachmentPath);
      } catch (error) {
        attachment = { uploaded: false, reason: error.message.slice(0, 80) };
      }
    }
    if (attachment?.refresh && attachment.refresh.phase !== 'ready') {
      return { ok: false, status: 'review-required', message: '附件已选择；刷新确认或解析尚未完成，请在当前页面核对后继续', report: { attachment,...(isByteCampus?{attachmentPending:false}:{}) } };
    }
    if (attachment?.refresh?.confirmed) step('attachment-refreshed', '已确认使用附件刷新信息，解析已稳定，继续核对字段');
    if(isByteCampus){const review=await checkByteProjects();if(review)return{...review,report:{...review.report,attachment,attachmentPending:false}};}
    let sectionSetup=null;
    if(companyId==='jd'&&['campus','summer-intern','daily-intern'].includes(recruitType)){
      sectionSetup=await workspace.run(buildEnsureJdGroupsScript([
        {sectionId:'edu',count:(resume.education||[]).length},
        {sectionId:'experience',count:(resume.experience||[]).length},
        {sectionId:'program',count:(resume.projects||[]).length}
      ]));
    }
    if(companyId==='meituan'){
      sectionSetup=await ensureMeituanGroups(workspace,resume);
      if(!sectionSetup.complete)return {ok:false,status:'manual-required',message:'经历卡片操作尚未确认，已保留当前页面并停止后续填写；请核对原页面，不会重复添加或删除',report:{attachment,sectionSetup},applyRisk:'review-before-save'};
      for(const row of sectionSetup.added)step('section-added',`已确认添加${row.key==='education'?'教育':row.key==='experience'?'实习':'项目'}第${row.after}段空白卡片，继续核对字段`);
      for(const row of sectionSetup.excess)step('section-review',`${row.key==='education'?'教育':row.key==='experience'?'实习':'项目'}官网${row.observed}段、本机${row.requested}段；多出${row.retained}段仍保留，请先核对最新附件和经历`);
    }
    if(companyId==='meituan'&&await workspace.run("!!document.querySelector('.resume_detail_edit .project_experience_edit')")===true){
      let plan;try{plan=await inspectProjectDifference(workspace,resume);}catch{plan={ok:false,error:'project-facts-invalid'};}
      if(!plan.ok)return {ok:false,status:'manual-required',message:'项目差异尚未核实，当前页面已保留；请核对本机项目名称和原页面',report:{attachment,sectionSetup,projectError:plan.error},applyRisk:'review-before-save'};
      if(plan.needsReplacement)return {ok:false,status:'review-required',message:'官网项目与本机不同或多出，已停止填写，避免混合新旧经历；请查看差异并确认替换，软件不会保存或投递',report:{attachment,sectionSetup,projectPlan:plan,projectReview:projectReview(plan)},applyRisk:'review-before-save'};
    }
    let fields = await workspace.run(INSPECT_FORM_FIELDS);
    // 页面结构指纹：与上次成功填写对比，字段数/标签签名大幅漂移时告警（防官网改版后静默乱填）
    try {
      const fsMod = require('node:fs');
      const pathMod = require('node:path');
      const fpFile = pathMod.join(require('electron').app.getPath('userData'), 'page-fingerprints.json');
      const signature = { count: fields.length, head: (fields || []).slice(0, 8).map((f) => (f.label || f.placeholder || '').slice(0, 20)) };
      let store = {};
      try { store = JSON.parse(fsMod.readFileSync(fpFile, 'utf8')); } catch {}
      const prev = store[companyId];
      if (prev && (Math.abs(prev.count - signature.count) > prev.count * 0.4)) {
        step('page-changed', `⚠ ${siteName}页面结构疑似改版（字段 ${prev.count}→${signature.count}），请核对写入结果`);
      }
      store[companyId] = signature;
      fsMod.writeFileSync(fpFile, JSON.stringify(store, null, 1));
    } catch {}
    if (!(fields || []).length) {
      return { ok: false, status: 'manual-required', message: `${siteName}页面没有可识别的简历字段（可能在登录页），请完成登录后重新更新` };
    }
    const localPlan = createUniversalResumePlan(resume).map(item=>{const m=isByteCampus&&item.key.match(/^projects\.(\d+)\./);return m?{...item,projectName:resume.projects[Number(m[1])].name.trim()}:item;});
    const meituanWidgets=companyId==='meituan'&&new URL(url).origin==='https://zhaopin.meituan.com'&&new URL(url).pathname==='/web/personal-center/resume-detail'&&await workspace.run("!!document.querySelector('.resume_detail_edit .mtd-select')")===true;
    const byteDates=companyId==='bytedance'&&new URL(url).origin==='https://jobs.bytedance.com'&&new URL(url).pathname==='/campus/resume/edit';
    const widgetRequests=companyId==='jd'&&new URL(url).origin==='https://campus.jd.com'?planJdWidgets(resume):meituanWidgets?planMeituanWidgets(resume):byteDates?planByteDates(resume):[];
    const widgetKeys=new Set(widgetRequests.map(item=>item.key));
    let widgetExecution=[];
    try{widgetExecution=resumedWidgetState?await (byteDates?recheckByteDates:recheckWidgetResults)(workspace,widgetRequests):widgetRequests.length?(byteDates?await executeByteDateJob(workspace,widgetRequests):companyId==='meituan'?await executeMeituanWidgets(workspace,resume):await executeJdWidgets(workspace,resume)):[];}
    catch(error){
      if(!error.widgetJob)throw error;
      const partial=Array.isArray(error.partialResults)?error.partialResults:[],verification=summarizeGenericVerification(partial);
      const message=`控件操作状态待核对：已回读 ${verification.verified.length} 项；请先查询原任务进度，不要重复更新。尚未保存或投递`;
      step('review-required',message);
      return {ok:false,status:'review-required',message,report:{...verification,widgets:partial,widgetJob:error.widgetJob,attachment,sectionSetup,...(isByteCampus?{attachmentPending:false}:{}),manual:widgetRequests.filter(x=>!verification.verified.includes(x.key)).map(x=>x.key)},applyRisk:'review-before-save'};
    }
    if(widgetRequests.length){
      fields=await workspace.run(INSPECT_FORM_FIELDS);
      for(const item of widgetExecution){
        const verified=item.written&&item.expected===item.observed;
        step(verified?'field-verified':'field-manual',verified?`「${item.locator.label}」控件已回读核验 ✓`:`「${item.locator.label}」需核对：${item.error==='date-day-required'?'官网要求具体日期，简历仅提供月份':item.error==='option-missing'?'官网没有对应选项':item.error||'回读不一致'}`);
      }
    }
    const textPlan=localPlan.filter(item=>!widgetKeys.has(item.key));
    const planned = planGenericResumeFields(textPlan, fields);
    // React/Vue 等受控表单可能在重渲染时回滚写入；带一轮补写重试，只有最终可见值一致才算 verified。
    const execution = planned.writable.length
      ? await executeFieldPlanWithRetry(workspace, textPlan, fields, {
          onProgress: (info) => {
            const messages = {
              writing: `正在填写「${info.field}」…`,
              verified: `「${info.field}」已写入并核验 ✓`,
              mismatched: `「${info.field}」回读不一致，稍后重试`,
              failed: `「${info.field}」写入失败，需手动检查`
            };
            const kinds = { writing: 'field-writing', verified: 'field-verified', mismatched: 'field-retry', failed: 'field-manual' };
            if (messages[info.phase]) step(kinds[info.phase], messages[info.phase]);
          }
        })
      : [];
    const verification = summarizeGenericVerification([...execution,...widgetExecution]);
    const verifiedCount = verification.verified.length;
    const manualKeys=[...new Set([...planned.manual.map(item=>item.key),...verification.mismatched,...verification.failed])];
    const needsReview = manualKeys.length;
    let requiredFields=null;
    if(companyId==='jd'&&new URL(url).origin==='https://campus.jd.com'){
      try {requiredFields=await workspace.run(buildJdRequiredFieldsScript());}
      catch {requiredFields={applicable:false,structurallyComplete:false,officialValidationProven:false,reason:'inspection-failed',requiredRows:[],missing:[],unknown:[]};}
      if(!requiredFields||!['requiredRows','missing','unknown'].every(k=>Array.isArray(requiredFields[k])))requiredFields={applicable:false,structurallyComplete:false,officialValidationProven:false,reason:'inspection-result-invalid',requiredRows:[],missing:[],unknown:[]};
      for(const row of requiredFields.missing||[])step('required-missing',`「${row.label}」（${row.sectionId} 第${row.groupNumber}段）必填项为空，请补充真实信息`);
      for(const row of requiredFields.unknown||[])step('required-unknown',`「${row.label}」（${row.sectionId} 第${row.groupNumber}段）控件未核实，请人工检查`);
    }
    const requiredMessage=requiredFields?(requiredFields.applicable&&requiredFields.requiredRows.length
      ? `；官网 ${requiredFields.missing.length} 行必填项仍为空，${requiredFields.unknown.length} 行控件未识别（仅结构检查，不代表官网已保存）`
      : '；官网必填结构未核实，请人工检查全部必填项'):'';
    const structureMessage=sectionSetup?.excess?.length?'；官网仍有多出的经历段（未删除），请先核对最新附件和经历':'';
    const message = `已回读核验 ${verifiedCount} 个字段，${needsReview} 个字段需人工核对${requiredMessage}${structureMessage}；软件不会点击保存、提交或投递`;
    step('review-required', message);
    return {
      ok: verifiedCount > 0,
      status: 'review-required',
      message,
      report: { ...verification, manual: manualKeys, attachment, sectionSetup, widgets:widgetExecution,requiredFields,...(isByteCampus?{attachmentPending:false}:{}),...(resumedWidgetState?{widgetJob:{id:resumedWidgetState.id,status:'completed',pendingKey:null}}:widgetExecution.widgetJob?{widgetJob:{...widgetExecution.widgetJob,continuationCompleted:true}}:{}) },
      applyRisk: 'review-before-save'
    };
    }catch(error){
      if(error?.code!=='RESUME_TARGET_MISMATCH')throw error;
      return {ok:false,status:'manual-required',message:'当前执行页面与所选简历平台或方向不一致，已停止后续填写；请核对原页面，不会自动重开、重传或投递',report:{targetVerified:false,targetError:'resume-target-mismatch'},applyRisk:'review-before-save'};
    }
  };
}

module.exports = {
  planGenericResumeFields,
  executeFieldPlanWithRetry,
  buildExecuteFieldPlanScript,
  mergeExecutionWithInspection,
  summarizeGenericVerification,
  createGenericResumeFill
};
