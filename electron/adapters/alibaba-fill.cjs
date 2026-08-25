// 阿里校招简历页适配器：查看态 + 各分区「编辑」按钮结构（2026-08-25 真站实测）。
// 流程：打开简历页 → 处理「刷新简历」弹窗（点取消，不覆盖）→ 逐分区点「编辑」→
//       在弹出的编辑层内用通用引擎写入并回读 → 点该层「保存/确定」→ 下一个分区。
// 安全边界：真实承诺/申请协议/投递类勾选与按钮永不触碰；「去选择职位」永不点击。
const { createUniversalResumePlan } = require('../resume-plan.cjs');
const { planGenericResumeFields, buildExecuteFieldPlanScript, mergeExecutionWithInspection, summarizeGenericVerification } = require('./generic-resume-fill.cjs');
const { resolvePlatformUrl } = require('../platform-manifests.cjs');
const { LOGIN_AND_FORM_PROBE, INSPECT_FORM_FIELDS } = require('../form-inspection.cjs');
const { normalizeComparableValue } = require('../field-matching.cjs');

async function probeFormState(workspace) {
  try { return await workspace.run(LOGIN_AND_FORM_PROBE); }
  catch { await new Promise((r) => setTimeout(r, 2000)); return workspace.run(LOGIN_AND_FORM_PROBE); }
}

// 页面侧：找到第 n 个「编辑」按钮并点击，返回是否点到了
const CLICK_EDIT_SCRIPT = (index) => `(() => {
  const edits = [...document.querySelectorAll('button,[role=button]')].filter(b => (b.innerText || '').trim() === '编辑');
  if (!edits[${index}]) return false;
  for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) edits[${index}].dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
  return true;
})()`;

// 页面侧：点当前展开区的「保存/确定/完成」。
// 阿里是内联展开编辑：每个大栏目底部有独立保存按钮（非弹窗层）。取页面上可见的
// 保存类按钮中最靠下的一个（= 当前展开区底部），绝不匹配「提交/投递/申请/去选择职位」。
const CLICK_SAVE_SCRIPT = `(() => {
  const cands = [...document.querySelectorAll('button,[role=button]')]
    .filter(b => {
      const t = (b.innerText || '').trim();
      if (!/^(保存|确 ?定|完 ?成)$/.test(t)) return false;
      if (/提交|投递|申请|选择职位/.test(t)) return false;
      return b.offsetParent !== null; // 可见
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  if (!cands.length) return false;
  const btn = cands[cands.length - 1];
  for (const t of ['pointerdown','mousedown','pointerup','mouseup','click']) btn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
  return btn.innerText.trim();
})()`;

// 页面侧：处理「是否用附件刷新简历」弹窗（点取消，避免覆盖用户已有信息）
const DISMISS_REFRESH_DIALOG = `(() => {
  const text = (document.body ? document.body.innerText : '').slice(0, 800);
  if (!/刷新简历|根据您上传附件/.test(text)) return false;
  const cancel = [...document.querySelectorAll('button')].find(b => /取消|暂不/.test(b.innerText || ''));
  if (cancel) { cancel.click(); return 'dismissed'; }
  return 'found-no-cancel';
})()`;

async function fillAlibabaResume(resume, { workspace, company, recruitType = 'campus', syncTargetId, taskId, onStep, attachmentPath } = {}) {
  if (!workspace?.openWorkspace || !workspace?.run) throw new Error('浏览器工作区未就绪');
  const step = (name, message) => onStep?.({ step: name, message });
  const track = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType) ? 'campus' : 'social';
  const url = resolvePlatformUrl('alibaba', track, 'resume');
  step('loading', '正在打开阿里巴巴简历页…');
  const openArgs = {
    company, url, mode: 'resume-review', title: '核对阿里巴巴简历',
    context: { action: 'fill-resume', companyId: 'alibaba', syncTargetId: syncTargetId || 'alibaba', taskId: taskId || null, recruitType: track }
  };
  try {
    await workspace.openWorkspace(openArgs);
  } catch (error) {
    // SSO 令牌回跳（sendBucSSOToken.do）期间 loadURL 可能瞬时 ERR_ABORTED，等待后重开一次
    if (!/ERR_ABORTED/.test(String(error.message))) throw error;
    await new Promise((r) => setTimeout(r, 2500));
    await workspace.openWorkspace(openArgs);
  }
  const probe = await probeFormState(workspace);
  if (probe.isNotFound || probe.loginRequired) {
    return { ok: false, status: 'login-required', message: '请先在当前阿里巴巴页面完成登录，然后重新更新' };
  }
  // 附件刷新确认弹窗：由附件上传触发，会在注入后延迟弹出；「取消」逻辑放在附件注入之后再跑
  // 附件：注入用户上传的简历文件（重新上传入口）
  let attachment = null;
  if (attachmentPath && workspace.setInputFiles) {
    step('attachment', '检测到简历附件入口，正在上传你的简历文件…');
    try { attachment = await workspace.setInputFiles(attachmentPath); }
    catch (error) { attachment = { uploaded: false, reason: String(error.message).slice(0, 80) }; }
    // 弹窗由上传触发：注入后等它弹出再取消（保留用户已有信息，不解析覆盖）
    await new Promise((r) => setTimeout(r, 2500));
    try {
      const dismissed = await workspace.run(DISMISS_REFRESH_DIALOG);
      if (dismissed === 'dismissed') step('dialog', '已关闭「用附件刷新简历」提示（保留你现有的详细信息）');
    } catch {}
  }
  const plan = createUniversalResumePlan(resume).filter((item) => item.value);

  // 逐分区：点「编辑」→ 填写编辑层 → 保存
  const results = [];
  const usedFieldIndexes = new Set();
  for (let editIndex = 0; editIndex < 8; editIndex += 1) {
    try { await workspace.run(DISMISS_REFRESH_DIALOG).catch(() => {}); } catch {}
    let opened;
    try { opened = await workspace.run(CLICK_EDIT_SCRIPT(editIndex)); } catch { opened = false; }
    if (!opened || opened.timeout) break;
    await new Promise((r) => setTimeout(r, 1800));
    const fields = await workspace.run(INSPECT_FORM_FIELDS).catch(() => []);
    // 空字段（如附件区）不终止流程：跳过写入但仍尝试保存并继续下一个分区
    const available = Array.isArray(fields) ? fields.filter((f) => !usedFieldIndexes.has(f.index)) : [];
    const planned = planGenericResumeFields(plan, available);
    let verified = [];
    if (planned.writable.length) {
      const immediate = await workspace.run(buildExecuteFieldPlanScript(planned.writable)).catch(() => []);
      await new Promise((r) => setTimeout(r, 800));
      const fieldsAfter = immediate.length ? await workspace.run(INSPECT_FORM_FIELDS).catch(() => []) : [];
      const execution = mergeExecutionWithInspection(immediate, fieldsAfter);
      const verification = summarizeGenericVerification(execution);
      verified = verification.verified;
      for (const item of planned.writable) usedFieldIndexes.add(item.fieldIndex);
      results.push({ section: editIndex + 1, wrote: planned.writable.length, verified: verified.length, keys: verified });
    }
    const saved = await workspace.run(CLICK_SAVE_SCRIPT).catch(() => false);
    step('section-filled', `第 ${editIndex + 1} 区：写入 ${planned.writable.length} 项、核验 ${verified.length} 项${saved ? `，已点保存（${saved}）` : '（未找到保存按钮，请手动检查该区）'}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  const verifiedTotal = results.reduce((sum, r) => sum + r.verified, 0);
  const wroteTotal = results.reduce((sum, r) => sum + r.wrote, 0);
  const message = `已逐区写入 ${wroteTotal} 项、回读核验 ${verifiedTotal} 项并保存；真实承诺/申请协议类勾选未触碰，由你本人确认`;
  step('review-required', message);
  return {
    ok: verifiedTotal > 0,
    status: 'review-required',
    message,
    report: { sections: results, attachment, compliance: 'untouched' }
  };
}

module.exports = { fillAlibabaResume };
