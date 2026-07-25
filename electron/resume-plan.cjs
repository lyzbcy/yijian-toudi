const FIELD_RULES = [
  ['basic.name', ['姓名', 'name']],
  ['basic.phone', ['手机号', '手机', '电话', 'phone', 'mobile']],
  ['basic.email', ['邮箱', 'email', 'mail']],
  ['basic.city', ['当前城市', '现居城市', '现居地', '城市', 'city']],
  ['basic.gender', ['性别', 'gender']],
  ['basic.birthday', ['出生日期', '生日', 'birthday']],
  ['basic.wechat', ['微信', 'wechat']],
  ['basic.website', ['个人主页', '主页', 'website']],
  ['intention.roles', ['目标岗位', '期望岗位', '意向岗位', 'position']],
  ['intention.cities', ['意向城市', '期望城市', '工作地点']],
  ['intention.salary', ['期望薪资', '薪资', 'salary']],
  ['intention.availability', ['到岗时间', '可到岗']],
  ['intention.employmentType', ['工作类型', '求职类型', 'employment']],
  ['education.0.school', ['学校名称', '毕业院校', '学校', 'school']],
  ['education.0.major', ['专业名称', '所学专业', '专业', 'major']],
  ['education.0.degree', ['最高学历', '学历', 'degree']],
  ['education.0.rank', ['成绩排名', '排名', 'rank']],
  ['education.0.start', ['入学时间', '教育开始时间']],
  ['education.0.end', ['毕业时间', '教育结束时间']],
  ['education.0.courses', ['主修课程', '课程']],
  ['experience.0.company', ['公司名称', '工作单位', '公司', 'company']],
  ['experience.0.role', ['职位名称', '工作职位', '职位', 'role']],
  ['experience.0.start', ['工作开始时间', '入职时间']],
  ['experience.0.end', ['工作结束时间', '离职时间']],
  ['experience.0.description', ['工作描述', '工作内容']],
  ['experience.0.achievements', ['关键成果', '工作业绩', '工作成果']],
  ['projects.0.name', ['项目名称', 'project name']],
  ['projects.0.role', ['项目角色', '担任角色']],
  ['projects.0.start', ['项目开始时间']],
  ['projects.0.end', ['项目结束时间']],
  ['projects.0.description', ['项目说明', '项目描述']],
  ['projects.0.link', ['项目链接', 'project link']],
  ['skills.keywords', ['专业技能', '技能', 'skill']],
  ['skills.languages', ['语言能力', '外语能力', 'language']],
  ['skills.certificates', ['证书', 'certificate']],
  ['skills.portfolio', ['作品集', 'portfolio']],
  ['extras.summary', ['个人简介', '自我介绍', '个人总结', 'summary']],
  ['extras.awards', ['奖项', '荣誉', 'award']],
  ['extras.campus', ['校园经历', '校园活动']],
  ['extras.publications', ['发表作品', '论文', 'publication']],
  ['extras.patents', ['专利', '软著', 'patent']]
];

function readPath(value, fieldPath) {
  return fieldPath
    .split('.')
    .reduce((current, key) => current?.[key], value);
}

function createTencentResumePlan(resume) {
  return FIELD_RULES.flatMap(([key, keywords]) => {
    const value = String(readPath(resume, key) || '').trim();
    return value ? [{ key, value, keywords }] : [];
  });
}

function summarizeFillReport(plan, matches) {
  const matchedKeys = new Set(
    matches
      .filter((match) => match?.matched)
      .map((match) => match.key)
  );
  return {
    filled: plan
      .filter((item) => matchedKeys.has(item.key))
      .map((item) => item.key),
    manual: plan
      .filter((item) => !matchedKeys.has(item.key))
      .map((item) => item.key)
  };
}

module.exports = {
  FIELD_RULES,
  createTencentResumePlan,
  summarizeFillReport
};
