const STAGE_RULES = [
  { stage: 'Offer', pattern: /offer|录用|意向书|薪资方案/i },
  { stage: '面试', pattern: /面试|interview|沟通邀请|预约时间/i },
  { stage: '测评', pattern: /测评|笔试|在线考试|assessment/i },
  { stage: '流程中', pattern: /评估|筛选|处理中|已收到|简历状态/i },
  { stage: '结束', pattern: /遗憾|未通过|暂不匹配|感谢.*关注/i }
];

function classifyRecruitingMail(subject = '', text = '') {
  const haystack = `${subject}\n${text}`;
  const matched = STAGE_RULES.find((rule) => rule.pattern.test(haystack));
  return matched?.stage || '其他';
}

function looksLikeRecruitingMail(subject = '', from = '', text = '') {
  return /招聘|校招|社招|面试|offer|career|talent|jobs|recruit|猎头|测评|笔试/i.test(`${subject}\n${from}\n${text}`);
}

module.exports = { classifyRecruitingMail, looksLikeRecruitingMail };
