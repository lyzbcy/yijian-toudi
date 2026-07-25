// 通用「打开官网让用户手动填简历」骨架（manual 级别 fillResume）。
//
// 对字节/小米/京东/美团/百度等暂未实现自动填表的招聘网站，fillResume 至少应该
// 打开官网的简历/个人信息页，让用户手动填写。这样 capabilities.resume 从 unsupported
// 升到 manual，一键更新流程能覆盖到这些公司（虽是 manual：打开官网让你手动填）。
//
// 各公司简历页 URL（登录后可达，未登录会跳登录页）：
const RESUME_URLS = {
  bytedance: 'https://jobs.bytedance.com/experienced/center/resume',
  xiaomi: 'https://xiaomi.jobs.f.mioffice.cn/user/profile/resume',
  jd: 'https://zhaopin.jd.com/web/personal/resume',
  meituan: 'https://zhaopin.meituan.com/web/personal/resume',
  baidu: 'https://talent.baidu.com/applicants/resume',
  tencent: 'https://careers.tencent.com/jobresume/resume.html'
};

function createManualFillResume(companyId, siteName) {
  return async function fillResume(resume, { workspace, company, taskId, onStep } = {}) {
    if (!workspace?.openWorkspace) throw new Error('浏览器工作区未就绪');
    if (!company?.id) throw new Error('缺少公司配置');
    const step = (name, message) => onStep?.({ step: name, message });
    const url = RESUME_URLS[companyId] || company.portal;

    step('loading', `正在打开${siteName}简历页…`);
    await workspace.openWorkspace({
      company,
      url,
      mode: 'resume-review',
      title: `手动核对${siteName}简历`,
      context: { action: 'manual-fill-resume', companyId, taskId: taskId || null }
    });

    const message = `已打开${siteName}简历/个人信息页。请登录后对照本机简历手动填写（软件暂未实现自动填表）。填完后点底部「完成」`;
    step('manual-required', message);
    return {
      ok: true,
      status: 'manual-required',
      message,
      report: { filled: [], manual: [] }
    };
  };
}

module.exports = { createManualFillResume, RESUME_URLS };
