const {
  createTencentResumePlan,
  summarizeFillReport,
  GLOBAL_FIELD_RULES,
  REPEATABLE_GROUPS
} = require('../resume-plan.cjs');
const { requireManualCaptcha } = require('../captcha.cjs');
const { isCampusRecruit } = require('./_manual-fill.cjs');
const { LOGIN_AND_FORM_PROBE, INSPECT_FORM_FIELDS } = require('../form-inspection.cjs');
const { resolvePlatformUrl } = require('../platform-manifests.cjs');
const {
  planGenericResumeFields,
  buildExecuteFieldPlanScript,
  mergeExecutionWithInspection,
  summarizeGenericVerification
} = require('./generic-resume-fill.cjs');

// 腾讯简历页 URL 按社招/校招分两个域名（2026-07-26 录制实测校准，见
// doc/招聘官网汇总.md 第三节）：
//   - 社招：careers.tencent.com，实测入口 resume.html?operType=1（原 jobresume/resume.html 已废弃）
//   - 校招：join.qq.com（独立域名），入口 resume.html，编辑 resumeedit.html
// ⚠️ 校招页底部的「提交简历」会真实投递职位，不是保存按钮。本适配器只填字段、
//    从不点击任何提交/投递类按钮；校招分支返回值会带 applyRisk:'submit-means-apply' 警示调用方。
const SOCIAL_RESUME_URL = resolvePlatformUrl('tencent', 'social', 'resume');
const CAMPUS_RESUME_URL = resolvePlatformUrl('tencent', 'campus', 'resume');

// 兼容旧引用：导出的 RESUME_URL 指向社招页。新代码应改用 resolveResumeUrl(recruitType)。
const RESUME_URL = SOCIAL_RESUME_URL;

function resolveResumeUrl(recruitType) {
  return isCampusRecruit(recruitType) ? CAMPUS_RESUME_URL : SOCIAL_RESUME_URL;
}

// 探测登录态、404、表单是否存在。返回 { loginRequired, isNotFound, inputCount }。
const LEGACY_LOGIN_AND_FORM_PROBE = `(() => new Promise((resolve) => {
  const inspect = () => {
    const bodyText = document.body?.innerText || '';
    const inputCount = document.querySelectorAll('input, textarea, select').length;
    const isNotFound = /404|页面不存在|没有找到/.test(document.title + bodyText.slice(0, 500));
    const loginControl = document.querySelector(
      'a[href*="login"], button[class*="login"], .tis-login, [data-testid*="login"]'
    );
    return {
      loginRequired: Boolean(loginControl) && inputCount === 0,
      isNotFound,
      inputCount
    };
  };
  const initial = inspect();
  if (initial.inputCount > 0 || initial.isNotFound || initial.loginRequired) return resolve(initial);
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const result = inspect();
    if (result.inputCount > 0 || result.isNotFound || result.loginRequired || Date.now() - startedAt > 6000) {
      clearInterval(timer);
      resolve(result);
    }
  }, 250);
}))()`;

// 读取页面上所有可识别表单控件的「描述文本 + 当前值 + 类型 + 控件标识」，供 planResumePatch 做差异对比。
// 这是 design §4.2 第 1 步 inspectResume 的页面端实现：只读，不写。
const LEGACY_INSPECT_FORM_FIELDS = `(() => {
  function describe(control) {
    const labelByFor = control.id
      ? document.querySelector('label[for="' + CSS.escape(control.id) + '"]')?.innerText
      : '';
    return [
      labelByFor,
      control.closest('label')?.innerText,
      control.placeholder,
      control.name,
      control.id,
      control.getAttribute('aria-label'),
      control.parentElement?.innerText?.slice(0, 160)
    ].filter(Boolean).join(' ').trim();
  }
  const controls = [...document.querySelectorAll('input, textarea, select')]
    .filter((c) => !c.disabled && c.type !== 'hidden' && c.type !== 'button' && c.type !== 'submit');
  return controls.map((c, i) => ({
    index: i,
    label: describe(c).slice(0, 200),
    type: c.tagName.toLowerCase() + (c.type ? ':' + c.type : ''),
    value: c.value || '',
    name: c.name || '',
    id: c.id || '',
    placeholder: c.placeholder || '',
    // 控件外层 HTML 片段（含父容器），用于诊断无 label 字段的真实结构
    context: (c.parentElement?.outerHTML || '').replace(/\\s+/g, ' ').slice(0, 300),
    options: c.tagName === 'SELECT' ? [...c.options].map((o) => o.textContent.trim()).slice(0, 12) : null
  }));
})()`;

function buildFillScript(plan) {
  function fillPlan(planData) {
    const controls = [...document.querySelectorAll('input, textarea, select')]
      .filter((control) => !control.disabled && control.type !== 'hidden');
    const used = new Set();

    function describe(control) {
      const labelByFor = control.id
        ? document.querySelector('label[for="' + CSS.escape(control.id) + '"]')?.innerText
        : '';
      // 腾讯社招页用 Vue 组件，input 包在多层 div 里，label 文本在最外层容器。
      // 往上找祖先：取每层祖先里「不含该 input 的文本」（通常是字段标题如「姓名」「手机号」）。
      const ancestorTexts = [];
      let node = control.parentElement;
      for (let depth = 0; depth < 5 && node; depth++) {
        try {
          // 克隆该层、移除所有 input/textarea/select 后取 textContent，避免拿到控件值
          const clone = node.cloneNode(true);
          clone.querySelectorAll('input,textarea,select').forEach((el) => el.remove());
          const t = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
          if (t && t.length < 100) ancestorTexts.push(t);
        } catch (e) {}
        node = node.parentElement;
      }
      // 腾讯用 CSS class 承载语义（telephone-input=手机、describe-input=描述）
      const classText = (control.className || '') + ' ' + (control.parentElement?.className || '');
      return [
        labelByFor,
        control.closest('label')?.innerText,
        control.placeholder,
        control.name,
        control.id,
        control.getAttribute('aria-label'),
        classText,
        ancestorTexts.join(' ')
      ].filter(Boolean).join(' ').toLowerCase();
    }

    function setControlValue(control, value) {
      if (control.tagName === 'SELECT') {
        const options = [...control.options];
        const target = options.find((option) =>
          option.value === value ||
          option.textContent.trim() === value ||
          option.textContent.includes(value)
        );
        if (!target) return false;
        control.value = target.value;
      } else {
        const prototype = control.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
        if (!setter) return false;
        setter.call(control, value);
      }
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      control.dispatchEvent(new Event('blur', { bubbles: true }));
      return true;
    }

    return planData.map((item) => {
      const candidates = controls
        .filter((control) => !used.has(control))
        .map((control) => {
          const description = describe(control);
          const score = item.keywords.reduce(
            (total, keyword) => total + (description.includes(keyword.toLowerCase()) ? 1 : 0),
            0
          );
          return { control, score };
        })
        .filter((candidate) => candidate.score > 0)
        .sort((left, right) => right.score - left.score);
      const match = candidates[0]?.control;
      const matched = Boolean(match && setControlValue(match, item.value));
      if (matched) used.add(match);
      return {
        key: item.key,
        matched,
        control: matched ? (match.name || match.id || match.placeholder || match.tagName) : null
      };
    });
  }

  return `(${fillPlan.toString()})(${JSON.stringify(plan)})`;
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

async function ensureCaptchaCleared(workspace, { onStep } = {}) {
  const result = await requireManualCaptcha(workspace, { onStep });
  return !result.manualRequired;
}

// design §4.2 第 1 步：打开腾讯简历页，读出所有可识别表单字段及其当前值。
// 只读不写，供 planResumePatch 做差异对比，也让用户在填写前看到「腾讯简历页现在长什么样」。
// 返回 { status, fields } 或 { status: 'login-required'|'manual-required', message }。
async function inspectTencentResume({ workspace, company, taskId, onStep, recruitType = 'social' } = {}) {
  if (!workspace?.openWorkspace || !workspace?.run) throw new Error('浏览器工作区未就绪');
  if (!company?.id) throw new Error('缺少腾讯公司配置');
  const step = (name, message) => onStep?.({ step: name, message });
  const resumeUrl = resolveResumeUrl(recruitType);
  const campus = isCampusRecruit(recruitType);
  step('loading', `正在打开腾讯${campus ? '校招' : '社招'}简历页读取当前字段…`);
  await workspace.openWorkspace({
    company,
    url: resumeUrl,
    mode: 'resume-review',
    title: `核对腾讯简历（${campus ? '校招' : '社招'}）`,
    context: { action: 'inspect-resume', companyId: 'tencent', taskId: taskId || null, recruitType: campus ? 'campus' : 'social' }
  });
  const probe = await probeFormState(workspace);
  // 验证码是明确的人机协作节点：只检测，不自动破解。
  if (probe.isNotFound || probe.loginRequired || probe.inputCount === 0) {
    const cleared = await ensureCaptchaCleared(workspace, { onStep });
    if (cleared) {
      // 过了验证码，重新探测
      const reprobe = await probeFormState(workspace);
      if (!reprobe.isNotFound && !reprobe.loginRequired && reprobe.inputCount > 0) {
        const fields = await workspace.run(INSPECT_FORM_FIELDS);
        step('inspected', `页面已就绪，读取到 ${fields.length} 个腾讯简历字段`);
        return { status: 'inspected', fields, url: resumeUrl };
      }
    }
  }
  if (probe.isNotFound || probe.loginRequired) {
    return { status: 'login-required', message: '请先在当前腾讯页面完成登录或验证码，然后重新读取简历字段' };
  }
  if (probe.inputCount === 0) {
    return { status: 'manual-required', message: '腾讯简历页没有出现可识别表单，请在当前页面手动检查' };
  }
  const fields = await workspace.run(INSPECT_FORM_FIELDS);
  step('inspected', `已读取 ${fields.length} 个腾讯简历字段`);
  return { status: 'inspected', fields, url: resumeUrl };
}

// design §4.2 第 2 步：纯本地计算，对比本地简历值和 inspectResume 读到的远端字段，生成差异清单。
// 每条差异：{ key, localValue, remoteValue, action: 'fill'|'skip'|'manual', risk, matchedField }
//   - fill：本地有值、远端为空或不同，且能在远端找到匹配字段 → 计划写入
//   - skip：本地值与远端值已一致 → 不动
//   - manual：本地有值但找不到匹配字段，或字段类型不兼容（如 select 缺对应选项）→ 标记需手动
function planTencentResumePatch(resume, inspection, { recruitType = 'social' } = {}) {
  const remoteFields = Array.isArray(inspection?.fields) ? inspection.fields : [];
  const plan = createTencentResumePlan(resume, { recruitType });
  // 远端字段描述统一小写化用于关键词匹配
  const remoteDescribed = remoteFields.map((f) => ({ ...f, descLower: (f.label + ' ' + f.placeholder + ' ' + f.name + ' ' + f.id).toLowerCase() }));

  const usedRemote = new Set();
  const patches = plan.map((item) => {
    const localValue = String(item.value || '').trim();
    // 在远端字段里按 keywords 找最佳匹配（与 buildFillScript 的打分逻辑一致）
    const candidates = remoteDescribed
      .filter((f) => !usedRemote.has(f.index))
      .map((f) => ({ field: f, score: item.keywords.reduce((s, kw) => s + (f.descLower.includes(kw.toLowerCase()) ? 1 : 0), 0) }))
      .filter((c) => c.score > 0)
      .sort((a, b) => b.score - a.score);
    const matched = candidates[0]?.field;
    if (!matched) {
      return { key: item.key, localValue, remoteValue: '', action: 'manual', risk: '在腾讯简历页未找到对应字段，需手动填写', matchedField: null, segmentLabel: item.segmentLabel };
    }
    usedRemote.add(matched.index);
    const remoteValue = String(matched.value || '').trim();
    // select 字段：检查本地值是否在选项里
    if (matched.options && !matched.options.includes(localValue)) {
      return { key: item.key, localValue, remoteValue, action: 'manual', risk: `腾讯此字段是下拉框，选项 [${matched.options.slice(0, 5).join('/')}…] 不含「${localValue}」`, matchedField: matched.label, segmentLabel: item.segmentLabel };
    }
    if (remoteValue === localValue) {
      return { key: item.key, localValue, remoteValue, action: 'skip', risk: '本地与腾讯当前值一致，无需改动', matchedField: matched.label, segmentLabel: item.segmentLabel };
    }
    return { key: item.key, localValue, remoteValue, action: 'fill', risk: remoteValue ? `将覆盖腾讯当前值「${remoteValue}」` : '腾讯当前为空，将填入', matchedField: matched.label, segmentLabel: item.segmentLabel };
  });

  const summary = {
    fill: patches.filter((p) => p.action === 'fill').length,
    skip: patches.filter((p) => p.action === 'skip').length,
    manual: patches.filter((p) => p.action === 'manual').length,
    total: patches.length
  };
  return { patches, summary, remoteFieldCount: remoteFields.length };
}

async function fillTencentResume(resume, {
  workspace,
  company,
  syncTargetId,
  taskId,
  onStep,
  recruitType = 'social'
} = {}) {
  if (!workspace?.openWorkspace || !workspace?.run) {
    throw new Error('浏览器工作区未就绪');
  }
  if (!company?.id) throw new Error('缺少腾讯公司配置');

  const step = (name, message) => onStep?.({ step: name, message });
  const campus = isCampusRecruit(recruitType);
  const resumeUrl = resolveResumeUrl(recruitType);
  const plan = createTencentResumePlan(resume, { recruitType });
  if (plan.length === 0) {
    return {
      ok: false,
      status: 'failed',
      message: '本地简历没有可填写的内容'
    };
  }

  step('loading', `正在打开腾讯${campus ? '校招' : '社招'}简历页…`);
  await workspace.openWorkspace({
    company,
    url: resumeUrl,
    mode: 'resume-review',
    title: `核对腾讯简历（${campus ? '校招' : '社招'}）`,
    context: {
      action: 'fill-resume',
      companyId: 'tencent',
      syncTargetId: syncTargetId || 'tencent',
      taskId: taskId || null,
      recruitType: campus ? 'campus' : 'social'
    }
  });

  const probe = await probeFormState(workspace);
  // 验证码是明确的人机协作节点：只检测，不自动破解。
  if (probe.isNotFound || probe.loginRequired || probe.inputCount === 0) {
    step('captcha-check', '正在检查是否需要你手动完成验证码…');
    const cleared = await ensureCaptchaCleared(workspace, { onStep });
    if (cleared) {
      const reprobe = await probeFormState(workspace);
      if (!reprobe.isNotFound && !reprobe.loginRequired && reprobe.inputCount > 0) {
        // 未检测到验证码且页面已就绪，继续填写流程。
        return await fillAfterProbe(workspace, plan, reprobe, resume, step, campus);
      }
    }
  }
  if (probe.isNotFound || probe.loginRequired) {
    step('login-required', '腾讯简历页需要登录或验证码，请在当前页面完成');
    return {
      ok: false,
      status: 'login-required',
      message: '请先在当前腾讯页面完成登录或验证码，然后重新更新简历'
    };
  }
  if (probe.inputCount === 0) {
    return {
      ok: false,
      status: 'manual-required',
      message: '腾讯简历页没有出现可识别表单，请在当前页面手动检查'
    };
  }
  return await fillAfterProbe(workspace, plan, probe, resume, step, campus);
}

// 抽出 probe 通过后的填写逻辑，供 fillTencentResume 在验证码通过后复用。
// campus=true 时（join.qq.com 校招页）：「提交简历」会真实投递职位，文案必须强调只填不提交，
// 并在返回值带 applyRisk 字段警示调用方/前端。
async function fillAfterProbe(workspace, plan, probe, resume, step, campus = false) {
  if (probe.inputCount === 0) {
    return { ok: false, status: 'manual-required', message: '腾讯简历页没有出现可识别表单，请在当前页面手动检查' };
  }

  const preWriteProbe = await probeFormState(workspace);
  if (preWriteProbe.isNotFound || preWriteProbe.loginRequired) {
    return { ok: false, status: 'login-required', message: '腾讯页面已进入登录或验证码流程，请完成后重新更新简历' };
  }

  step('inspecting', `正在读取腾讯页面字段并进行高置信匹配…`);
  const fieldsBefore = await workspace.run(INSPECT_FORM_FIELDS);
  if (!fieldsBefore.length) {
    // 页面没有可识别字段：通常是登录页残留了 1 个隐藏输入框被 inputCount 误计。
    return { ok: false, status: 'login-required', message: '腾讯页面没有出现可识别的简历表单（可能在登录页），请完成登录后重新更新' };
  }
  const planned = planGenericResumeFields(plan, fieldsBefore);
  step('filling', `已找到 ${planned.writable.length} 个唯一高置信字段，正在写入并回读…`);
  const immediateExecution = planned.writable.length
    ? await workspace.run(buildExecuteFieldPlanScript(planned.writable))
    : [];
  if (immediateExecution.length) await new Promise((resolve) => setTimeout(resolve, 250));
  const fieldsAfter = immediateExecution.length ? await workspace.run(INSPECT_FORM_FIELDS) : [];
  const execution = mergeExecutionWithInspection(immediateExecution, fieldsAfter);
  const verification = summarizeGenericVerification(execution);
  const manualKeys = [
    ...planned.manual.map((item) => item.key),
    ...verification.mismatched,
    ...verification.failed
  ];
  const report = { filled: verification.verified, manual: [...new Set(manualKeys)], verification };
  // 同时读一遍远端当前字段，生成填写后的差异快照（design §4.2：逐字段命中报告）
  let patchPlan = null;
  try {
    const finalFields = fieldsAfter.length ? fieldsAfter : await workspace.run(INSPECT_FORM_FIELDS);
    patchPlan = planTencentResumePatch(resume, { fields: finalFields }, { recruitType: campus ? 'campus' : 'social' });
  } catch (e) {
    // 读字段失败不影响主流程，report 仍有 filled/manual
  }
  const tail = campus
    ? '；⚠️ 校招页「提交简历」会真实投递职位，软件只填不提交，请勿点击「提交简历」'
    : '；软件不会点击保存';
  const message = `已写入并回读核验 ${report.filled.length} 个字段，${report.manual.length} 个字段因歧义、组件限制或回读不一致需手动检查${tail}`;
  step('review-required', message);

  return {
    ok: report.filled.length > 0,
    status: 'review-required',
    message,
    report,
    patchPlan,
    ...(campus ? { applyRisk: 'submit-means-apply' } : {})
  };
}

module.exports = {
  RESUME_URL,
  SOCIAL_RESUME_URL,
  CAMPUS_RESUME_URL,
  resolveResumeUrl,
  buildFillScript,
  LOGIN_AND_FORM_PROBE,
  INSPECT_FORM_FIELDS,
  inspectTencentResume,
  planTencentResumePatch,
  fillTencentResume,
  ensureCaptchaCleared
};
