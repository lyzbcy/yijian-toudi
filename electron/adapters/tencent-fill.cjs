const {
  createTencentResumePlan,
  summarizeFillReport,
  GLOBAL_FIELD_RULES,
  REPEATABLE_GROUPS
} = require('../resume-plan.cjs');

const RESUME_URL = 'https://careers.tencent.com/jobresume/resume.html';

// 探测登录态、404、表单是否存在。返回 { loginRequired, isNotFound, inputCount }。
const LOGIN_AND_FORM_PROBE = `(() => new Promise((resolve) => {
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
const INSPECT_FORM_FIELDS = `(() => {
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
        ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`)?.innerText
        : '';
      return [
        labelByFor,
        control.closest('label')?.innerText,
        control.placeholder,
        control.name,
        control.id,
        control.getAttribute('aria-label'),
        control.parentElement?.innerText?.slice(0, 160)
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

// design §4.2 第 1 步：打开腾讯简历页，读出所有可识别表单字段及其当前值。
// 只读不写，供 planResumePatch 做差异对比，也让用户在填写前看到「腾讯简历页现在长什么样」。
// 返回 { status, fields } 或 { status: 'login-required'|'manual-required', message }。
async function inspectTencentResume({ workspace, company, taskId, onStep } = {}) {
  if (!workspace?.openWorkspace || !workspace?.run) throw new Error('浏览器工作区未就绪');
  if (!company?.id) throw new Error('缺少腾讯公司配置');
  const step = (name, message) => onStep?.({ step: name, message });
  step('loading', '正在打开腾讯简历页读取当前字段…');
  await workspace.openWorkspace({
    company,
    url: RESUME_URL,
    mode: 'resume-review',
    title: '核对腾讯简历',
    context: { action: 'inspect-resume', companyId: 'tencent', taskId: taskId || null }
  });
  const probe = await workspace.run(LOGIN_AND_FORM_PROBE);
  if (probe.isNotFound || probe.loginRequired) {
    return { status: 'login-required', message: '请先在当前腾讯页面完成登录，然后重新读取简历字段' };
  }
  if (probe.inputCount === 0) {
    return { status: 'manual-required', message: '腾讯简历页没有出现可识别表单，请在当前页面手动检查' };
  }
  const fields = await workspace.run(INSPECT_FORM_FIELDS);
  step('inspected', `已读取 ${fields.length} 个腾讯简历字段`);
  return { status: 'inspected', fields, url: RESUME_URL };
}

// design §4.2 第 2 步：纯本地计算，对比本地简历值和 inspectResume 读到的远端字段，生成差异清单。
// 每条差异：{ key, localValue, remoteValue, action: 'fill'|'skip'|'manual', risk, matchedField }
//   - fill：本地有值、远端为空或不同，且能在远端找到匹配字段 → 计划写入
//   - skip：本地值与远端值已一致 → 不动
//   - manual：本地有值但找不到匹配字段，或字段类型不兼容（如 select 缺对应选项）→ 标记需手动
function planTencentResumePatch(resume, inspection) {
  const remoteFields = Array.isArray(inspection?.fields) ? inspection.fields : [];
  const plan = createTencentResumePlan(resume);
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
  taskId,
  onStep
} = {}) {
  if (!workspace?.openWorkspace || !workspace?.run) {
    throw new Error('浏览器工作区未就绪');
  }
  if (!company?.id) throw new Error('缺少腾讯公司配置');

  const step = (name, message) => onStep?.({ step: name, message });
  const plan = createTencentResumePlan(resume);
  if (plan.length === 0) {
    return {
      ok: false,
      status: 'failed',
      message: '本地简历没有可填写的内容'
    };
  }

  step('loading', '正在打开腾讯简历页…');
  await workspace.openWorkspace({
    company,
    url: RESUME_URL,
    mode: 'resume-review',
    title: '核对腾讯简历',
    context: {
      action: 'fill-resume',
      companyId: 'tencent',
      taskId: taskId || null
    }
  });

  const probe = await workspace.run(LOGIN_AND_FORM_PROBE);
  if (probe.isNotFound || probe.loginRequired) {
    step('login-required', '腾讯简历页需要登录，请在当前页面完成登录');
    return {
      ok: false,
      status: 'login-required',
      message: '请先在当前腾讯页面完成登录，然后重新更新简历'
    };
  }
  if (probe.inputCount === 0) {
    return {
      ok: false,
      status: 'manual-required',
      message: '腾讯简历页没有出现可识别表单，请在当前页面手动检查'
    };
  }

  step('filling', `正在匹配 ${plan.length} 个本地简历字段…`);
  const matches = await workspace.run(buildFillScript(plan));
  const report = summarizeFillReport(plan, matches);
  // 同时读一遍远端当前字段，生成填写后的差异快照（design §4.2：逐字段命中报告）
  let patchPlan = null;
  try {
    const fieldsAfter = await workspace.run(INSPECT_FORM_FIELDS);
    patchPlan = planTencentResumePatch(resume, { fields: fieldsAfter });
  } catch (e) {
    // 读字段失败不影响主流程，report 仍有 filled/manual
  }
  const message = `已填写 ${report.filled.length} 个字段，${report.manual.length} 个字段需手动检查；软件不会点击保存`;
  step('review-required', message);

  return {
    ok: true,
    status: 'review-required',
    message,
    report,
    patchPlan
  };
}

module.exports = {
  RESUME_URL,
  buildFillScript,
  LOGIN_AND_FORM_PROBE,
  INSPECT_FORM_FIELDS,
  inspectTencentResume,
  planTencentResumePatch,
  fillTencentResume
};
