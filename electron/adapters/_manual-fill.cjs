// 通用「打开官网让用户手动填简历」骨架（manual 级别 fillResume）。
//
// 对字节/小米/京东/美团/百度等暂未实现自动填表的招聘网站，fillResume 至少应该
// 打开官网的简历/个人信息页，让用户手动填写。这样 capabilities.resume 从 unsupported
// 升到 manual，一键更新流程能覆盖到这些公司（虽是 manual：打开官网让你手动填）。
//
// 各公司简历页 URL 按 recruitType 分两套（登录后可达，未登录会跳登录页）。
// URL 全部来自 doc/招聘官网汇总.md 第三节「2026-07-26 录制实测」——社招页此前直接写死、
// 校招页 2026-07-26 新增。腾讯社招页尤其需要校准：原 jobresume/resume.html 录制已证不符，
// 实测入口是 resume.html?operType=1（但腾讯走 tencent-fill.cjs 自动填表，这里的 tencent
// 仅作 manual 兜底/占位，不常走）。校招若某公司无独立页则回退社招并在 message 注明。
const { PLATFORM_MANIFESTS, resolvePlatformUrl } = require('../platform-manifests.cjs');
const RESUME_URLS = { social: {}, campus: {} };
for (const id of Object.keys(PLATFORM_MANIFESTS)) {
  RESUME_URLS.social[id] = resolvePlatformUrl(id, 'social', 'resume');
  RESUME_URLS.campus[id] = resolvePlatformUrl(id, 'campus', 'resume');
}

// 判定是否校招方向。与各 listJobs 适配器里的 isCampus 判定保持一致。
function isCampusRecruit(recruitType) {
  if (recruitType === 'all') throw new Error('“全部都要”必须先拆分为社招和校招两个简历轨道');
  return ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
}

function createManualFillResume(companyId, siteName) {
  return async function fillResume(resume, { workspace, company, syncTargetId, taskId, onStep, recruitType = 'social' } = {}) {
    if (!workspace?.openWorkspace) throw new Error('浏览器工作区未就绪');
    if (!company?.id) throw new Error('缺少公司配置');
    const step = (name, message) => onStep?.({ step: name, message });
    const track = isCampusRecruit(recruitType) ? 'campus' : 'social';
    const campusUrl = RESUME_URLS.campus[companyId];
    const url = PLATFORM_MANIFESTS[companyId]
      ? resolvePlatformUrl(companyId, track, 'resume')
      : ((track === 'campus' && campusUrl) ? campusUrl : (RESUME_URLS.social[companyId] || company.portal));
    const fellBackToSocial = track === 'campus' && !campusUrl;

    step('loading', `正在打开${siteName}${track === 'campus' ? '校招' : '社招'}简历页…`);
    await workspace.openWorkspace({
      company,
      url,
      mode: 'resume-review',
      title: `手动核对${siteName}简历（${track === 'campus' ? '校招' : '社招'}）`,
      context: { action: 'manual-fill-resume', companyId, syncTargetId: syncTargetId || companyId, taskId: taskId || null, recruitType: track }
    });

    const directionNote = track === 'campus' ? '校招' : '社招';
    let message = `已打开${siteName}${directionNote}简历/个人信息页。请登录后对照本机简历手动填写（软件暂未实现自动填表）。填完后点顶部「完成核对」`;
    if (fellBackToSocial) {
      message = `${siteName}暂未确认校招简历页，已打开社招页（${directionNote}方向）。若你正在校招，请在页面内手动切换到校招入口`;
    }
    step('manual-required', message);
    return {
      ok: true,
      status: 'manual-required',
      message,
      report: { filled: [], manual: [] }
    };
  };
}

module.exports = { createManualFillResume, RESUME_URLS, isCampusRecruit };
