// 腾讯投递状态查询（design §4.3 状态机 + §6.1 status 能力升级到 verified）。
//
// 腾讯「我的投递」页：https://careers.tencent.com/jobresume/application.html
// 该页列出用户所有投递记录及当前状态（如：简历评估中、笔试、面试、offer、已结束等）。
// 本模块打开该页，抓取每条投递的状态，回填到 state.applied。

const APPLICATIONS_URL = 'https://careers.tencent.com/jobresume/application.html';

// 页面端脚本：读取「我的投递」列表，返回 [{ postId, title, status, lastUpdate }]。
// 选择器基于腾讯 careers 站常见结构（.tis-apply-item / .apply-status），改版时需探针更新。
const READ_APPLICATIONS_SCRIPT = `(() => {
  const items = [...document.querySelectorAll(
    '.tis-apply-item, .apply-item, [class*="application-item"], .job-item'
  )];
  if (items.length === 0) return { ok: false, reason: 'no-items', count: 0 };
  const records = items.map((item) => {
    const title = (item.querySelector('.tis-job-title, .job-title, h3, h4, [class*="title"]')?.innerText || '').trim();
    // 状态文本：简历评估中/笔试/面试/Offer/已结束 等
    const status = (item.querySelector('.tis-apply-status, .apply-status, [class*="status"], .status-tag')?.innerText || '').trim();
    // 详情链接里的 postId
    const link = item.querySelector('a[href*="postId"], a[href*="jobdesc"]');
    const href = link?.getAttribute('href') || '';
    const postIdMatch = href.match(/postId=([^&]+)/);
    const lastUpdate = (item.querySelector('.tis-date, .date, [class*="time"], time')?.innerText || '').trim();
    return {
      postId: postIdMatch ? decodeURIComponent(postIdMatch[1]) : '',
      title,
      status,
      lastUpdate,
      href
    };
  }).filter((r) => r.title || r.postId);
  return { ok: true, count: records.length, records };
})()`;

const LOGIN_PROBE = `(() => {
  const bodyText = document.body?.innerText || '';
  const isNotFound = /404|页面不存在|没有找到/.test(document.title + bodyText.slice(0, 500));
  const loginControl = document.querySelector('a[href*="login"], button[class*="login"], .tis-login');
  const itemCount = document.querySelectorAll('.tis-apply-item, .apply-item, [class*="application-item"], .job-item').length;
  return {
    isNotFound,
    loginRequired: Boolean(loginControl) && itemCount === 0,
    itemCount
  };
})()`;

// design §4.3 inspectApplicationStatus：打开腾讯「我的投递」页，读取所有投递记录。
// 返回 { status, records } 或 { status: 'login-required'|'manual-required', message }。
async function inspectTencentApplicationStatus({ workspace, company, taskId, onStep } = {}) {
  if (!workspace?.openWorkspace || !workspace?.run) throw new Error('浏览器工作区未就绪');
  if (!company?.id) throw new Error('缺少腾讯公司配置');
  const step = (name, message) => onStep?.({ step: name, message });

  step('loading', '正在打开腾讯「我的投递」…');
  await workspace.openWorkspace({
    company,
    url: APPLICATIONS_URL,
    mode: 'browse',
    title: '查询腾讯投递状态',
    context: { action: 'inspect-status', companyId: 'tencent', taskId: taskId || null }
  });

  // 等列表加载
  await new Promise((r) => setTimeout(r, 2000));
  const probe = await workspace.run(LOGIN_PROBE);
  if (probe.isNotFound || probe.loginRequired) {
    return { status: 'login-required', message: '请先在当前腾讯页面完成登录，然后重新查询投递状态' };
  }

  step('reading', '正在读取投递记录…');
  const result = await workspace.run(READ_APPLICATIONS_SCRIPT);
  if (!result.ok) {
    return { status: 'manual-required', message: '腾讯「我的投递」页结构未识别（可能改版），请在当前页面手动查看' };
  }
  step('done', `已读取 ${result.count} 条腾讯投递记录`);
  return { status: 'inspected', records: result.records, count: result.count };
}

// 把 inspect 读到的 records 合并进 state.applied：按 postId 匹配，更新 status/lastUpdate。
// 未匹配 postId 的记录（可能是腾讯页独有的、本地没追踪的）单独返回，不强制并入。
function mergeTencentApplicationStatus(applied, records) {
  const byPostId = new Map();
  for (const rec of records) {
    if (rec.postId) byPostId.set(rec.postId, rec);
  }
  return applied.map((job) => {
    // 从 job.id（如 tencent-123）提取 postId
    const postId = String(job.id || '').replace(/^tencent(-campus)?-/, '');
    const match = byPostId.get(postId);
    if (match) {
      return {
        ...job,
        applyStatus: match.status || job.applyStatus,
        lastStatusUpdate: match.lastUpdate || job.lastStatusUpdate,
        statusSource: 'tencent'
      };
    }
    return job;
  });
}

module.exports = {
  APPLICATIONS_URL,
  READ_APPLICATIONS_SCRIPT,
  LOGIN_PROBE,
  inspectTencentApplicationStatus,
  mergeTencentApplicationStatus
};
