const STAGE_RULES = [
  { stage: '结束', pattern: /遗憾|未通过|暂不匹配|不予录用|未能进入|不再推进/i },
  { stage: 'Offer', pattern: /offer|录用|意向书|薪资方案/i },
  { stage: '面试', pattern: /面试|interview|沟通邀请|预约时间/i },
  { stage: '测评', pattern: /测评|笔试|在线考试|assessment/i },
  { stage: '流程中', pattern: /评估|筛选|处理中|已收到|简历状态|投递成功/i }

];

function classifyRecruitingMail(subject = '', text = '') {
  if (/满意度|问卷|调研|survey|feedback|邀请投递|推荐职位|招聘公告|热招中|约面试先机|智联推荐|网申职位推荐|欢迎投递|快来报名|收获.*offer/i.test(subject)) return '其他';
  const primary = STAGE_RULES.find(rule => rule.pattern.test(subject));
  if(primary) return primary.stage;
  const haystack = `${subject}\n${text}`;
  const matched = STAGE_RULES.find((rule) => rule.pattern.test(haystack));
  return matched?.stage || '其他';
}

function looksLikeRecruitingMail(subject = '', from = '', text = '') {
  return /招聘|校招|社招|面试|offer|career|talent|jobs|recruit|猎头|测评|笔试/i.test(`${subject}\n${from}\n${text}`);
}

module.exports = { classifyRecruitingMail, looksLikeRecruitingMail };
