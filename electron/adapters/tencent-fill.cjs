const {
  createTencentResumePlan,
  summarizeFillReport
} = require('../resume-plan.cjs');

const RESUME_URL = 'https://careers.tencent.com/jobresume/resume.html';

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

async function fillTencentResume(resume, {
  workspace,
  company,
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
      companyId: 'tencent'
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
  const message = `已填写 ${report.filled.length} 个字段，${report.manual.length} 个字段需手动检查；软件不会点击保存`;
  step('review-required', message);

  return {
    ok: true,
    status: 'review-required',
    message,
    report
  };
}

module.exports = {
  RESUME_URL,
  buildFillScript,
  fillTencentResume
};
