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

function resolveTencentJobUrl(job) {
  // 腾讯 API 返回的 PostURL 常是 http://，腾讯会 302 到 https——但 302 链路不稳，
  // 且 http 链接在部分网络环境会失败。统一规范化为 https。
  const raw = String(job?.url || '').trim();
  if (/^https:\/\/careers\.tencent\.com\//.test(raw)) return raw;
  if (/^http:\/\/careers\.tencent\.com\//.test(raw)) return raw.replace(/^http:/, 'https:');
  // url 缺失时从 id 反推 postId（id 形如 tencent-<postId> / tencent-campus-<postId>）。
  // 反推不出就回退到 job.url（即便为空也让 openWorkspace 自己报「工作区只允许 http(s)」，
  // 比直接 throw 更可控——throw 会让调用方走 catch，而 catch 路径不一定关 workspace）。
  const postId = String(job?.id || '').replace(/^tencent(-campus)?-/, '');
  if (postId && postId !== String(job?.id || '')) {
    return `https://careers.tencent.com/jobdesc.html?postId=${encodeURIComponent(postId)}`;
  }
  return raw;
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
    // 岗位下线/404：必须关 workspace，否则腾讯404页会一直挂在窗口上，
    // 用户被困住只能点腾讯页内的「返回首页」然后彻底卡死（用户实测痛点）。
    // login-required/manual-required 分支不关——那是要留给用户登录或手动接管的。
    await workspace.closeWorkspaceIfOpen();
    return {
      ok: false,
      status: 'failed',
      message: '岗位详情页不存在，岗位可能已经下线'
    };
  }
  if (page.loginRequired) {
    step('login-required', '腾讯登录态已失效或需要验证码，请在当前页面完成');
    return {
      ok: false,
      status: 'login-required',
      message: '请先在当前腾讯页面完成登录或验证码，然后重新投递'
    };
  }
  const message = page.applyButton
    ? `已打开岗位详情页并找到“${page.applyButton.text || '申请岗位'}”；请由你本人点击，软件不会触发任何申请或投递按钮`
    : '已打开岗位详情页；请由你本人检查并操作，软件不会触发任何申请或投递按钮';
  step('manual-required', message);
  return {
    ok: true,
    status: 'manual-required',
    message
  };
}

module.exports = {
  APPLY_PAGE_PROBE,
  resolveTencentJobUrl,
  applyTencentJob
};
