'use strict';
// Pure, Agent-reported observation classifier. No click, SMS or submit requests.
function inspectGuopin(o) {
  const bad = () => { throw Object.assign(Error('invalid-iguopin-observation'), { status: 400 }); };
  if (!o || typeof o !== 'object') return bad();
  let u; try { u = new URL(o.url); } catch { return bad(); }
  if (u.protocol !== 'https:' || !['www.iguopin.com', 'c.iguopin.com'].includes(u.hostname) || u.username || u.password) return bad();
  if (typeof o.text !== 'string' || o.text.length > 80000 || !Array.isArray(o.buttons) || o.buttons.length > 200 || o.buttons.some(x => typeof x !== 'string')) return bad();
  const jobId = u.searchParams.get('id') || u.searchParams.get('job_id');
  if (jobId && !/^\d{8,30}$/.test(jobId)) return bad();
  const text = o.text, b = o.buttons.map(x => x.replace(/\s+/g, ''));
  let status = 'unknown';
  if (/验证码|滑块|拼图/.test(text) && /登录|验证/.test(text)) status = 'waiting-verification';
  else if (/\/login/.test(u.pathname) || (b.includes('登录') && !jobId)) status = 'waiting-login';
  else if (jobId && u.hostname === 'www.iguopin.com' && b.includes('已申请')) status = 'already-applied';
  else if (jobId && o.successDialogVisible === true && /^申请成功$/.test(o.successDialogText || '')) status = 'success-visible';
  else if (/简历信息填写不完善|信息填写不完善|附件信息缺失|下列标黄部分/.test(text)) status = 'waiting-materials';
  else if (u.hostname === 'c.iguopin.com' && u.pathname === '/apply') status = 'custom-template';
  else if (b.includes('确认申请')) status = 'confirmation';
  else if (jobId && b.includes('申请职位')) status = 'job-detail';
  return { platform: 'iguopin', jobId, projectId: u.searchParams.get('project_id'), templateId: u.searchParams.get('template_id'),
    status, evidenceSource: 'agent-reported', submittedByInspection: false,
    next: ['already-applied', 'success-visible'].includes(status) ? '核对本次账号、主体、岗位及原attempt，再向本机账本登记回执；旧申请不新增计数'
      : status === 'waiting-materials' ? '登记缺项并后置该岗位，继续其他候选' : '沿用当前页面核对；此接口不执行网页动作' };
}
module.exports = { inspectGuopin };
