const { createUniversalResumePlan } = require('../resume-plan.cjs');
const { matchField, normalizeComparableValue } = require('../field-matching.cjs');
const { resolvePlatformUrl } = require('../platform-manifests.cjs');
const { LOGIN_AND_FORM_PROBE, INSPECT_FORM_FIELDS } = require('../form-inspection.cjs');

function planGenericResumeFields(plan, fields) {
  const writable = [];
  const manual = [];
  const used = new Set();
  for (const item of plan) {
    const expected = normalizeComparableValue(item.value);
    const available = (fields || []).filter((field) => {
      if (used.has(field.index)) return false;
      if (!String(field.type || '').includes('radio')) return true;
      const optionValue = normalizeComparableValue(field.controlValue || field.label?.split(/\s+/).at(-1));
      return !optionValue || optionValue === expected;
    });
    const match = matchField(item, available);
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
      , locator: String(match.field.type || '').includes('radio') ? radioLocator : plainLocator
    });
  }
  return { writable, manual };
}

function buildExecuteFieldPlanScript(fieldPlan) {
  function execute(planned) {
    // 与 form-inspection.cjs INSPECT_FORM_FIELDS 保持完全一致的筛选，index 定位才与 inspect 序号对齐
    const inspectControls = () => [...document.querySelectorAll('input, textarea, select')]
      .filter((control) => !control.disabled && control.type !== 'hidden' && control.type !== 'button' && control.type !== 'submit')
      .filter((control) => !control.closest('form[action*="login"], [class*="login"], [class*="captcha"], [class*="auth"], [role="dialog"]'));
    return planned.map((item) => {
      let control = null;
      if (item.locator?.kind === 'index') {
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
      if (!control) return { key: item.key, written: false, observed: '', error: 'control-missing' };
      const value = String(item.value ?? '');
      try {
        if (control.type === 'checkbox' || control.type === 'radio') {
          const normalized = value.trim();
          const checkedSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
          if (!checkedSetter) throw new Error('checked-setter-missing');
          if (control.type === 'radio') checkedSetter.call(control, true);
          else checkedSetter.call(control, normalized === '是' || normalized === 'true' || normalized === '1');
        } else if (control.tagName === 'SELECT') {
          const option = [...control.options].find((candidate) =>
            candidate.value === value || candidate.textContent.trim() === value
          );
          if (!option) throw new Error('option-missing');
          control.value = option.value;
        } else {
          const prototype = control.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
          if (!setter) throw new Error('value-setter-missing');
          setter.call(control, '');
          control.dispatchEvent(new Event('input', { bubbles: true }));
          setter.call(control, value);
        }
        control.dispatchEvent(new Event('input', { bubbles: true }));
        control.dispatchEvent(new Event('change', { bubbles: true }));
        control.dispatchEvent(new Event('blur', { bubbles: true }));
        const observed = control.type === 'radio'
          ? (control.checked ? (control.value || value) : '')
          : (control.type === 'checkbox' ? (control.checked ? '是' : '否') : control.value);
        return { key: item.key, fieldIndex: item.fieldIndex, locator: item.locator, expected: value, observed, written: true };
      } catch (error) {
        return { key: item.key, fieldIndex: item.fieldIndex, locator: item.locator, expected: value, observed: '', written: false, error: error.message };
      }
    });
  }
  return `(${execute.toString()})(${JSON.stringify(fieldPlan)})`;
}

function mergeExecutionWithInspection(execution, fieldsAfter) {
  return (execution || []).map((item) => ({
    ...item,
    observedImmediately: item.observed,
    observed: (() => {
      if (item.locator?.kind === 'index') return (fieldsAfter || [])[item.locator.value]?.value || '';
      const stable = (fieldsAfter || []).filter((field) => {
        if (item.locator?.kind === 'id') return field.id === item.locator.value;
        if (item.locator?.kind === 'radio') return field.name === item.locator.value && field.controlValue === item.locator.controlValue;
        if (item.locator?.kind === 'name') return field.name === item.locator.value;
        return false;
      });
      if (stable.length === 1) return stable[0].value;
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

function createGenericResumeFill(companyId, siteName) {
  return async function fillResume(resume, { workspace, company, recruitType = 'social', syncTargetId, taskId, onStep } = {}) {
    if (!workspace?.openWorkspace || !workspace?.run) throw new Error('浏览器工作区未就绪');
    const url = resolvePlatformUrl(companyId, recruitType, 'resume');
    const step = (name, message) => onStep?.({ step: name, message });
    step('loading', `正在打开${siteName}简历页…`);
    await workspace.openWorkspace({
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
    const fields = await workspace.run(INSPECT_FORM_FIELDS);
    if (!(fields || []).length) {
      return { ok: false, status: 'manual-required', message: `${siteName}页面没有可识别的简历字段（可能在登录页），请完成登录后重新更新` };
    }
    const localPlan = createUniversalResumePlan(resume);
    const planned = planGenericResumeFields(localPlan, fields);
    const immediateExecution = planned.writable.length
      ? await workspace.run(buildExecuteFieldPlanScript(planned.writable))
      : [];
    // React/Vue 等受控表单可能在 input/change 事件后把 DOM 值回滚。等待一轮事件后
    // 再读取页面，只有最终可见值一致才算 verified，避免写入瞬间循环自证。
    if (immediateExecution.length) await new Promise((resolve) => setTimeout(resolve, 250));
    const fieldsAfter = immediateExecution.length ? await workspace.run(INSPECT_FORM_FIELDS) : [];
    const execution = mergeExecutionWithInspection(immediateExecution, fieldsAfter);
    const verification = summarizeGenericVerification(execution);
    const verifiedCount = verification.verified.length;
    const needsReview = planned.manual.length + verification.mismatched.length + verification.failed.length;
    const message = `已写入并回读核验 ${verifiedCount} 个字段，${needsReview} 个字段需人工核对；软件不会点击保存、提交或投递`;
    step('review-required', message);
    return {
      ok: verifiedCount > 0,
      status: 'review-required',
      message,
      report: { ...verification, manual: planned.manual.map((item) => item.key) },
      applyRisk: 'review-before-save'
    };
  };
}

module.exports = {
  planGenericResumeFields,
  buildExecuteFieldPlanScript,
  mergeExecutionWithInspection,
  summarizeGenericVerification,
  createGenericResumeFill
};
