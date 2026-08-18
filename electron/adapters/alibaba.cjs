const { resolvePlatformUrl } = require('../platform-manifests.cjs');

const SOCIAL_JOBS_URL = resolvePlatformUrl('alibaba', 'social', 'jobs');
const CAMPUS_JOBS_URL = resolvePlatformUrl('alibaba', 'campus', 'jobs');

// 阿里集团主管网是多个业务招聘子站的入口，不存在当前已验证的单一公开职位 feed。
// 在逐个子站建立响应 fixture 前，宁可明确降级，也不把 302 后的模板首页解析成职位。
async function listAlibabaJobs({ recruitType = 'social', onProgress } = {}) {
  const campus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
  const error = new Error(`阿里${campus ? '校招' : '社招'}岗位需在官方业务招聘子站查看；当前未启用未经验证的自动抓取`);
  error.code = 'OFFICIAL_SOURCE_NOT_VERIFIED';
  error.officialUrl = campus ? CAMPUS_JOBS_URL : SOCIAL_JOBS_URL;
  onProgress?.({ error: error.message, officialUrl: error.officialUrl });
  throw error;
}

module.exports = { SOCIAL_JOBS_URL, CAMPUS_JOBS_URL, listAlibabaJobs };
