// 通用「打开详情页让用户手动投递」骨架（design §4.3 manual-required 语义）。
//
// 对于暂未实现自动填表的招聘网站（字节/小米/京东/美团/百度），prepareApplication 至少
// 应该打开岗位详情页，让用户在浏览器工作区手动完成投递。这样 capabilities.apply
// 从 unsupported（完全不能投）升级到 manual（能打开官网手动投），购物车不再一刀切禁用。
//
// 真正的自动投递（点申请按钮、填表、用户确认提交）留给后续逐家适配。

// 构造一个 prepareApplication 函数。siteName 用于任务标题和提示。
// job.url 必须是有效的招聘网站详情页链接。
const { isAllowedWorkspaceUrl } = require('../navigation-policy.cjs');

function createManualPrepareApplication(siteName) {
  return async function prepareApplication(job, { workspace, company, taskId, onStep } = {}) {
    if (!workspace?.openWorkspace) throw new Error('浏览器工作区未就绪');
    if (!company?.id) throw new Error('缺少公司配置');
    const step = (name, message) => onStep?.({ step: name, message });
    const url = job?.url;
    if (!url || !/^https?:\/\//.test(url)) {
      return {
        ok: false,
        status: 'manual-required',
        message: `${siteName} 岗位缺少详情页链接，请手动打开官网投递`
      };
    }
    if (!isAllowedWorkspaceUrl(company.id, url)) {
      return {
        ok: false,
        status: 'manual-required',
        message: `岗位详情页不属于${siteName}官网，已拒绝在登录会话中打开`
      };
    }

    step('loading', `正在打开 ${siteName} 岗位详情页…`);
    await workspace.openWorkspace({
      company,
      url,
      mode: 'application-review',
      title: `手动投递：${job.title || ''}`,
      context: {
        action: 'manual-apply',
        companyId: company.id,
        jobId: job.id,
        taskId: taskId || null
      }
    });

    const message = `已打开${siteName}岗位详情页，请在浏览器工作区手动完成投递（软件不会自动提交）`;
    step('manual-required', message);
    return {
      ok: true,
      status: 'manual-required',
      message
    };
  };
}

module.exports = { createManualPrepareApplication };
