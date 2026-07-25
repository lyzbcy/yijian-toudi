// 全局字段规则（basic/intention/skills/extras/family/compliance），路径直接读取 resume 顶层。
// 覆盖 11 家大厂调研字段（2026-07）：含籍贯/民族/政治面貌/GitHub/内推码/学位/导师等校招+社招字段。
const GLOBAL_FIELD_RULES = [
  // 基本信息
  ['basic.name', ['姓名', 'name']],
  ['basic.phone', ['手机号', '手机', '电话', 'phone', 'mobile']],
  ['basic.email', ['邮箱', 'email', 'mail']],
  ['basic.city', ['当前城市', '现居城市', '现居地', '城市', 'city']],
  ['basic.gender', ['性别', 'gender']],
  ['basic.birthday', ['出生日期', '生日', 'birthday']],
  ['basic.wechat', ['微信', 'wechat']],
  ['basic.website', ['个人主页', '主页', 'website']],
  ['basic.github', ['github', 'github主页', '开源主页']],
  ['basic.nativePlace', ['籍贯', '老家', '户籍地']],
  ['basic.nationality', ['国籍', ' nationality']],
  ['basic.ethnicity', ['民族', 'ethnicity']],
  ['basic.politicalStatus', ['政治面貌', '党员', '团员']],
  ['basic.idCard', ['身份证号', '身份证', '证件号码']],
  ['basic.maritalStatus', ['婚姻状况', '婚否']],
  // 求职意向
  ['intention.roles', ['目标岗位', '期望岗位', '意向岗位', 'position']],
  ['intention.cities', ['意向城市', '期望城市', '工作地点']],
  ['intention.salary', ['期望薪资', '薪资', 'salary']],
  ['intention.availability', ['到岗时间', '可到岗']],
  ['intention.employmentType', ['工作类型', '求职类型', 'employment']],
  ['intention.referralCode', ['内推码', '推荐码', '内推']],
  ['intention.channel', ['渠道来源', '招聘渠道', '来源']],
  // 技能与语言
  ['skills.keywords', ['专业技能', '技能', 'skill']],
  ['skills.proficiency', ['熟练程度', '熟练度', '掌握程度']],
  ['skills.languages', ['语言能力', '外语能力', 'language']],
  ['skills.certificates', ['证书', 'certificate']],
  ['skills.certificateIds', ['证书编号', '证书号码']],
  ['skills.portfolio', ['作品集', 'portfolio']],
  ['skills.portfolioUrl', ['作品集链接', '作品链接', '作品集url']],
  ['skills.interests', ['兴趣爱好', '特长', 'hobby']],
  // 补充信息
  ['extras.summary', ['个人简介', '自我介绍', '个人总结', 'summary']],
  ['extras.awards', ['奖项', '荣誉', 'award']],
  ['extras.campus', ['校园经历', '校园活动']],
  ['extras.publications', ['发表作品', '论文', 'publication']],
  ['extras.patents', ['专利', '软著', 'patent']]
];

// 多段经历字段规则：每个 entry 一组同义 keywords，会按段索引展开成 N 倍的计划条目。
// 例如 education 有 2 段，会生成 2 套 school/major/... 规则，keywords 拼上「(第 N 段)」区分。
// 实际写入招聘网站时，第 1 段对应官网表单的「教育经历 1」，第 N 段对应「教育经历 N」，
// 由各公司 adapter 自己决定怎么把段索引映射到官网行号（多数是按顺序填，超出官网上限的标 manual）。
const REPEATABLE_GROUPS = [
  {
    arrayPath: 'education',
    label: '教育经历',
    fields: [
      ['school', ['学校名称', '毕业院校', '学校', 'school']],
      ['major', ['专业名称', '所学专业', '专业', 'major']],
      ['degree', ['最高学历', '学历', 'degree']],
      ['degreeName', ['学位', 'degree name']],
      ['rank', ['成绩排名', '排名', 'rank', 'gpa']],
      ['start', ['入学时间', '教育开始时间']],
      ['end', ['毕业时间', '教育结束时间']],
      ['courses', ['主修课程', '课程']],
      ['isFullTime', ['是否全日制', '全日制']],
      ['isUnified', ['是否统招', '统招']],
      ['advisor', ['导师', '导师姓名', '指导老师']],
      ['researchDirection', ['研究方向', 'research']],
      ['thesisTitle', ['毕业论文', '论文题目']]
    ]
  },
  {
    arrayPath: 'experience',
    label: '工作经历',
    fields: [
      ['company', ['公司名称', '工作单位', '公司', 'company']],
      ['department', ['部门', '所在部门', 'department']],
      ['role', ['职位名称', '工作职位', '职位', 'role']],
      ['level', ['职级', '职位级别', '级别']],
      ['start', ['工作开始时间', '入职时间']],
      ['end', ['工作结束时间', '离职时间']],
      ['employmentType', ['工作类型', '就业类型']],
      ['description', ['工作描述', '工作内容']],
      ['achievements', ['关键成果', '工作业绩', '工作成果']],
      ['leaveReason', ['离职原因', '离职理由']],
      ['reportTo', ['汇报对象', '上级']],
      ['teamSize', ['团队规模', '下属人数', '团队人数']]
    ]
  },
  {
    arrayPath: 'projects',
    label: '项目经历',
    fields: [
      ['name', ['项目名称', 'project name']],
      ['role', ['项目角色', '担任角色']],
      ['start', ['项目开始时间']],
      ['end', ['项目结束时间']],
      ['description', ['项目说明', '项目描述', '项目背景']],
      ['contribution', ['个人贡献', '个人职责', '我的贡献']],
      ['techStack', ['技术栈', '使用技术', '技术方向']],
      ['outcome', ['项目成果', '项目业绩', '成果']],
      ['scale', ['项目规模', '团队人数']],
      ['link', ['项目链接', 'project link']],
      ['client', ['客户', '服务客户']]
    ]
  }
];

function readPath(value, fieldPath) {
  return fieldPath
    .split('.')
    .reduce((current, key) => current?.[key], value);
}

// 兼容旧导出：把全局规则 + 多段展开后的规则合并成一个扁平数组返回。
// 新代码应直接用 createTencentResumePlan，不要再依赖这个常量的段索引（只有 [0]）。
const FIELD_RULES = [
  ...GLOBAL_FIELD_RULES,
  ...REPEATABLE_GROUPS.flatMap((group) => group.fields.map(([key, keywords]) => [`${group.arrayPath}.0.${key}`, keywords]))
];

// 生成腾讯简历填写计划。读取 resume（已由 syncResumeActiveView 把 intention/education/... 镜像到顶层）。
// 多段经历展开：每段生成带段索引的计划条目，便于 adapter 按官网行号写入，也便于差异报告逐段呈现。
function createTencentResumePlan(resume) {
  const plan = [];

  for (const [key, keywords] of GLOBAL_FIELD_RULES) {
    const value = String(readPath(resume, key) || '').trim();
    if (value) plan.push({ key, value, keywords });
  }

  for (const group of REPEATABLE_GROUPS) {
    const arr = readPath(resume, group.arrayPath) || [];
    arr.forEach((item, index) => {
      const segmentNumber = index + 1;
      for (const [key, baseKeywords] of group.fields) {
        const value = String(item?.[key] || '').trim();
        if (!value) continue;
        // 同一页面可能有多段，keywords 加段序号区分（如「学校名称(第2段)」），统一用阿拉伯数字便于 adapter 匹配
        const taggedKeywords = baseKeywords.map((kw) => index === 0 ? kw : `${kw}(第${segmentNumber}段)`);
        plan.push({
          key: `${group.arrayPath}.${index}.${key}`,
          value,
          keywords: taggedKeywords,
          group: group.arrayPath,
          segmentIndex: index,
          segmentNumber,
          segmentLabel: `${group.label} ${segmentNumber}`
        });
      }
    });
  }

  return plan;
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
  GLOBAL_FIELD_RULES,
  REPEATABLE_GROUPS,
  createTencentResumePlan,
  summarizeFillReport
};
