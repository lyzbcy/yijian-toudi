// 全局字段规则（basic/intention/skills/extras/family/compliance），路径直接读取 resume 顶层。
// 覆盖 11 家大厂调研字段（2026-07-26 六厂考古）：含籍贯/民族/政治面貌/GitHub/内推码/学位/导师/GPA/QQ/
// 工作年限/事业群/调剂/开发语言/英语等级/证明人等校招+社招字段。详见 doc/specs/简历字段缺口-2026-07-26.md。
const GLOBAL_FIELD_RULES = [
  // 基本信息
  ['basic.name', ['姓名', 'name', '有效证件上的全名', '联系人姓名']],
  ['basic.phone', ['手机号', '手机号码', '手机', '电话', 'phone', 'mobile', '电话号码', '手机号码', 'telephone']],
  ['basic.email', ['邮箱', '电子邮箱', 'e-mail', 'email', 'mail']],
  ['basic.city', ['当前城市', '现居城市', '现居地', '目前所在地', '当前所处地', '所处地', '城市', 'city', '省/市', '当前居住']],
  ['basic.province', ['省份', '省', '现居省份', 'province']],
  ['basic.gender', ['性别', 'gender']],
  ['basic.birthday', ['出生日期', '生日', 'birthday']],
  ['basic.wechat', ['微信', '微信号', 'wechat']],
  ['basic.qq', ['qq', 'qq号', 'qq号码']],
  ['basic.website', ['个人主页', '个人主页链接', '主页', 'website']],
  ['basic.github', ['github', 'github主页', '开源主页']],
  ['basic.nativePlace', ['籍贯', '老家', '户籍地']],
  ['basic.nationality', ['国籍', '国家', '国家地区', 'nationality']],
  ['basic.ethnicity', ['民族', 'ethnicity']],
  ['basic.politicalStatus', ['政治面貌', '党员', '团员']],
  ['basic.idCard', ['身份证号', '身份证']], // 兼容旧字段；新数据用 idType+idNumber，keywords 去掉「证件号码」避免与 idNumber 冲突
  ['basic.idType', ['证件类型']],
  ['basic.idNumber', ['证件号码', '证件号']],
  ['basic.avatarUrl', ['个人照片', '证件照', '头像', 'photo']],
  ['basic.maritalStatus', ['婚姻状况', '婚否']],
  ['basic.height', ['身高']],
  ['basic.emergencyContact', ['紧急联系人', '紧急联系电话']],
  // 求职意向
  ['intention.roles', ['目标岗位', '期望岗位', '意向岗位', 'position']],
  ['intention.cities', ['意向城市', '期望城市', '期望工作城市', '工作地点']],
  ['intention.salary', ['期望薪资', '薪资', 'salary']],
  ['intention.salaryUnit', ['薪资单位', '薪水单位']],
  ['intention.availability', ['到岗时间', '可到岗', '最早可入职时间']],
  ['intention.employmentType', ['工作类型', '求职类型', 'employment']],
  ['intention.referralCode', ['内推码', '内推串码', '推荐码', '内推']],
  ['intention.channel', ['渠道来源', '招聘信息来源', '招聘渠道', '来源']],
  ['intention.workYears', ['工作年限', '工作年限要求', '工作经验']],
  ['intention.interviewCity', ['面试城市', '参加面试城市', '期待面试地点']],
  ['intention.businessGroup', ['意向事业群', '事业群', '意向业务方向', '感兴趣的事业群']],
  ['intention.preferredLocations', ['意向城市排序', '多城市排序', '志愿城市']],
  ['intention.expectCountry', ['期望工作国家', '期望工作国家地区', '意向国家', '期望国家']],
  ['intention.acceptAdjustment', ['接受调剂', '是否接受调剂', '岗位调剂', '职位调剂']],
  ['intention.acceptCityDeployment', ['接受城市分配', '城市调剂', '工作地分配', '工作地调剂']],
  ['intention.willingness.travel', ['接受出差', '是否出差', '出差意愿']],
  ['intention.willingness.relocate', ['接受外派', '是否外派', '外派意愿', '接受异地']],
  ['intention.willingness.overtime', ['接受加班', '是否加班', '加班意愿']],
  ['intention.willingness.nightShift', ['接受夜班', '是否夜班', '夜班意愿']],
  // 技能与语言
  ['skills.keywords', ['专业技能', '技能', 'skill', '其他技能']],
  ['skills.proficiency', ['熟练程度', '熟练度', '掌握程度']],
  ['skills.languages', ['语言能力', '外语能力', '外语语种', 'language']],
  ['skills.devLanguages', ['开发语言', '编程语言']],
  ['skills.englishLevel', ['英语等级', '英语考试', '语言考试']],
  ['skills.englishScore', ['英语分数', '语言考试成绩']],
  ['skills.certificates', ['证书', '技能证书', 'certificate']],
  ['skills.certificateIds', ['证书编号', '证书号码']],
  ['skills.portfolio', ['作品集', 'portfolio']],
  ['skills.portfolioUrl', ['作品集链接', '作品链接', '作品集url']],
  ['skills.interests', ['兴趣爱好', '特长', 'hobby']],
  // 补充信息
  ['extras.summary', ['个人简介', '自我介绍', '自我评价', '个人总结', 'summary']],
  ['extras.awards', ['奖项', '荣誉', '获奖', 'award']],
  ['extras.campus', ['校园经历', '校园活动']],
  ['extras.publications', ['发表作品', '论文', 'publication', '论文名称']],
  ['extras.patents', ['专利', '软著', 'patent', '发明成果']],
  ['extras.certifier', ['资料证明人', '证明人']],
  // 合规声明（各厂投递通用）
  ['compliance.previouslyInterviewed', ['是否曾被面试', '曾被面试', '曾面试过']],
  ['compliance.previouslyEmployed', ['是否曾被录用', '曾被录用', '曾入职过']],
  ['compliance.hasRelativeAtCompany', ['是否有亲属在本公司', '亲属在本公司', '亲友在本公司']],
  ['compliance.relativeDetail', ['亲属详情', '亲属信息', '亲友详情']],
  ['compliance.criminalRecord', ['无犯罪记录', '犯罪记录', '无犯罪声明']]
];

// 多段经历字段规则：每个 entry 一组同义 keywords，会按段索引展开成 N 倍的计划条目。
// 例如 education 有 2 段，会生成 2 套 school/major/... 规则，keywords 拼上「(第 N 段)」区分。
// 实际写入招聘网站时，第 1 段对应官网表单的「教育经历 1」，第 N 段对应「教育经历 N」，
// 由各公司 adapter 自己决定怎么把段索引映射到官网行号（多数是按顺序填，超出官网上限的标 manual）。
const REPEATABLE_GROUPS = [
  {
    arrayPath: 'education',
    label: '教育经历',
    pageAliases: ['教育经历'],
    fields: [
      ['school', ['学校名称', '毕业院校', '学校', 'school']],
      ['department', ['学院名称', '院系', '学院', 'department']],
      ['major', ['专业名称', '所学专业', '专业', 'major']],
      ['degree', ['最高学历', '学历', '学历层次', 'degree']],
      ['degreeName', ['学位', 'degree name']],
      ['rank', ['成绩排名', '专业排名', '排名', 'rank']],
      ['gpa', ['gpa', '绩点']],
      ['gpaBase', ['gpa满分', '满分绩点', 'gpa-base']],
      ['start', ['入学时间', '教育开始时间']],
      ['end', ['毕业时间', '教育结束时间']],
      ['courses', ['主修课程', '课程']],
      ['isFullTime', ['是否全日制', '全日制', '学习形式']],
      ['isUnified', ['是否统招', '统招']],
      ['is211', ['是否双一流', '双一流', '985', '211', '学校级别']],
      ['advisor', ['导师', '导师姓名', '指导老师']],
      ['researchDirection', ['研究方向', 'research']],
      ['thesisTitle', ['毕业论文', '论文题目']],
      ['laboratory', ['实验室', 'lab']]
    ]
  },
  {
    arrayPath: 'experience',
    label: '工作经历',
    pageAliases: ['实习经历', '工作经历'],
    fields: [
      ['company', ['公司名称', '企业名称', '工作单位', '公司', 'company']],
      ['department', ['部门', '所在部门', 'department']],
      ['role', ['职位名称', '工作职位', '工作职位名称', '职位', 'role', 'work']],
      ['level', ['职级', '职位级别', '级别']],
      ['start', ['工作开始时间', '入职时间']],
      ['end', ['工作结束时间', '离职时间']],
      ['employmentType', ['工作类型', '就业类型']],
      ['isOutsource', ['是否外包', '外包', '派遣', '劳动关系形式']],
      ['description', ['工作描述', '工作内容']],
      ['achievements', ['关键成果', '工作业绩', '工作成果']],
      ['leaveReason', ['离职原因', '离职理由']],
      ['reportTo', ['汇报对象', '直接上级', '上级']],
      ['teamSize', ['团队规模', '下属人数', '团队人数']]
    ]
  },
  {
    arrayPath: 'projects',
    label: '项目经历',
    pageAliases: ['项目经历'],
    fields: [
      ['name', ['项目名称', 'project name']],
      ['role', ['项目角色', '担任角色']],
      ['start', ['项目开始时间']],
      ['end', ['项目结束时间']],
      ['description', ['项目说明', '项目描述', '项目背景']],
      ['contribution', ['个人贡献', '个人职责', '项目职责', '我的贡献']],
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
// 把任意字段值标准化为 plan 用的字符串。布尔 true→'是'、false→'否'（让否定值能进入填表计划，
// 如「无犯罪记录=否」「接受城市分配=否」），空值（null/undefined/''）→''（不进计划）。
function normalizeFieldValue(raw) {
  if (raw === true || raw === 'true') return '是';
  if (raw === false || raw === 'false') return '否';
  return String(raw ?? '').trim();
}

// 腾讯社招简历页字段极简（考古实锤：仅 ContactInfo/LocationPreference/WorkExperience/
// EducateBackground/SupplementInfo/Works 六区，无项目/技能/证书/语言/家庭/合规）。
// 社招分支只生成这六区对应的字段，避免 projects/nativePlace/ethnicity 等社招不要的字段
// 进 plan 沦为 manual 噪音（用户实测痛点：50 个项目字段 + 籍贯民族全落 manual）。
// 校招分支保留全量（校招 11 区字段丰富）。
const SOCIAL_ALLOWED_KEYS = new Set([
  // ContactInfo
  'basic.name', 'basic.phone', 'basic.email', 'basic.city', 'basic.province', 'basic.nationality', 'basic.website',
  // LocationPreference
  'intention.cities', 'intention.expectCountry', 'intention.acceptCityDeployment',
  // SupplementInfo
  'extras.summary',
  // Works
  'skills.portfolioUrl'
]);

function createTencentResumePlan(resume, { recruitType = 'social' } = {}) {
  const campus = ['campus', 'summer-intern', 'daily-intern'].includes(recruitType);
  const plan = [];

  for (const [key, keywords] of GLOBAL_FIELD_RULES) {
    if (!campus && !SOCIAL_ALLOWED_KEYS.has(key)) continue;
    const value = normalizeFieldValue(readPath(resume, key));
    if (value) plan.push({ key, value, keywords });
  }

  // 社招只要 education + experience，不要 projects（腾讯社招无项目经历区）
  for (const group of REPEATABLE_GROUPS) {
    if (!campus && group.arrayPath === 'projects') continue;
    const arr = readPath(resume, group.arrayPath) || [];
    arr.forEach((item, index) => {
      const segmentNumber = index + 1;
      for (const [key, baseKeywords] of group.fields) {
        const value = normalizeFieldValue(item?.[key]);
        if (!value) continue;
        // 社招教育/工作经历里，也只保留社招页确实有的子字段（教育只要 school/major/degree/start/end，
        // 工作只要 company/role/description/start/end）。校招保留全量。
        if (!campus) {
          const socialEduFields = ['school', 'major', 'degree', 'start', 'end'];
          const socialExpFields = ['company', 'role', 'description', 'start', 'end'];
          if (group.arrayPath === 'education' && !socialEduFields.includes(key)) continue;
          if (group.arrayPath === 'experience' && !socialExpFields.includes(key)) continue;
        }
        // 同一页面可能有多段，keywords 加段序号区分（如「学校名称(第2段)」），统一用阿拉伯数字便于 adapter 匹配
        const taggedKeywords = baseKeywords.map((kw) => index === 0 ? kw : `${kw}(第${segmentNumber}段)`);
        plan.push({
          key: `${group.arrayPath}.${index}.${key}`,
          value,
          keywords: taggedKeywords,
          group: group.arrayPath,
          segmentIndex: index,
          segmentNumber,
          segmentLabel: `${group.label} ${segmentNumber}`,
          sectionHint: { aliases: group.pageAliases || [group.label], number: segmentNumber }
        });
      }
    });
  }

  return plan;
}

// 各平台共用的规范化计划必须保留完整字段；平台自己的 adapter 再根据真实 DOM
// 决定能写哪些。复用 campus 分支只是为了沿用同一份字段与多段经历展开规则，
// 不代表会执行任何校招提交动作。
function createUniversalResumePlan(resume) {
  return createTencentResumePlan(resume, { recruitType: 'campus' });
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
  createUniversalResumePlan,
  summarizeFillReport
};
