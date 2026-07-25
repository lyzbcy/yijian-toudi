const APPLY_PAGE_PROBE = `(() => {
  const bodyText = document.body?.innerText || '';
  const isNotFound = /404|页面不存在|没有找到/.test(document.title + bodyText.slice(0, 500));
  const candidates = [...document.querySelectorAll('button, a, [role="button"]')];
  const applyButton = candidates.find((element) => {
    const text = (element.innerText || element.textContent || '').trim();
    return /^(申请岗位|立即申请|立即投递|投递)$/.test(text);
  }) || document.querySelector('.default-btn');
  if (applyButton) applyButton.setAttribute('data-yjt-apply-button', 'true');
  const loginControl = document.querySelector(
    'a[href*="login"], button[class*="login"], .tis-login, [data-testid*="login"]'
  );
  return {
    isNotFound,
    loginRequired: Boolean(loginControl) && !applyButton,
    applyButton: applyButton ? {
      selector: '[data-yjt-apply-button="true"]',
      text: (applyButton.innerText || applyButton.textContent || '').trim()
    } : null
  };
})()`;

const CLICK_APPLY_BUTTON = `(() => {
  const button = document.querySelector('[data-yjt-apply-button="true"]');
  if (!button) return { clicked: false };
  button.click();
  return { clicked: true };
})()`;

function resolveTencentJobUrl(job) {
  if (/^https:\/\/careers\.tencent\.com\//.test(job?.url || '')) return job.url;
  const postId = String(job?.id || '').replace(/^tencent(-campus)?-/, '');
  if (!postId || postId === String(job?.id || '')) {
    throw new Error('岗位缺少可信的腾讯详情链接');
  }
  return `https://careers.tencent.com/jobdesc.html?postId=${encodeURIComponent(postId)}`;
}

async function applyTencentJob(job, {
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
  const detailUrl = resolveTencentJobUrl(job);

  step('loading', `正在打开 ${job.title}…`);
  await workspace.openWorkspace({
    company,
    url: detailUrl,
    mode: 'application-review',
    title: `核对投递：${job.title}`,
    context: {
      action: 'apply-job',
      companyId: 'tencent',
      jobId: job.id,
      taskId: taskId || null
    }
  });

  const page = await workspace.run(APPLY_PAGE_PROBE);
  if (page.isNotFound) {
    return {
      ok: false,
      status: 'failed',
      message: '岗位详情页不存在，岗位可能已经下线'
    };
  }
  if (page.loginRequired) {
    step('login-required', '腾讯登录态已失效，请在当前页面完成登录');
    return {
      ok: false,
      status: 'login-required',
      message: '请先在当前腾讯页面完成登录，然后重新投递'
    };
  }
  if (!page.applyButton) {
    return {
      ok: false,
      status: 'manual-required',
      message: '未找到可靠的申请按钮，请在当前页面手动检查'
    };
  }

  step('preparing', `已找到“${page.applyButton.text || '申请岗位'}”，正在打开投递流程…`);
  const click = await workspace.run(CLICK_APPLY_BUTTON);
  if (!click.clicked) {
    return {
      ok: false,
      status: 'manual-required',
      message: '申请按钮已变化，请在当前页面手动继续'
    };
  }

  const message = '已打开腾讯投递流程，请核对信息后在官网完成最终提交';
  step('review-required', message);
  return {
    ok: true,
    status: 'review-required',
    message
  };
}

module.exports = {
  APPLY_PAGE_PROBE,
  CLICK_APPLY_BUTTON,
  resolveTencentJobUrl,
  applyTencentJob
};
