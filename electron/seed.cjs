const companies = [
  { id: 'tencent', name: '腾讯', short: 'T', color: '#1664ff', portal: 'https://careers.tencent.com/', status: 'adapter-needed', enabled: true },
  { id: 'alibaba', name: '阿里巴巴', short: 'A', color: '#ff6a00', portal: 'https://talent.alibaba.com/', status: 'adapter-needed', enabled: true },
  { id: 'bytedance', name: '字节跳动', short: '字', color: '#111827', portal: 'https://jobs.bytedance.com/', status: 'adapter-needed', enabled: true },
  { id: 'meituan', name: '美团', short: '美', color: '#ffc300', portal: 'https://zhaopin.meituan.com/', status: 'adapter-needed', enabled: true },
  { id: 'xiaomi', name: '小米', short: '米', color: '#ff6900', portal: 'https://hr.xiaomi.com/', status: 'adapter-needed', enabled: true },
  { id: 'netease', name: '网易', short: '易', color: '#e1251b', portal: 'https://hr.163.com/', status: 'adapter-needed', enabled: true }
];

const jobs = [
  {
    id: 'demo-001', companyId: 'tencent', title: '产品经理（AI 应用方向）', department: '云与智慧产业事业群',
    city: '深圳', type: '全职', experience: '3-5 年', education: '本科', salary: '薪资面议',
    tags: ['AI 产品', 'B 端', '增长'], postedAt: '2026-07-22', source: '演示数据', favorite: true,
    match: 91, url: 'https://careers.tencent.com/', summary: '负责 AI 应用从需求洞察到上线迭代的完整闭环。'
  },
  {
    id: 'demo-002', companyId: 'alibaba', title: '高级前端开发工程师', department: '淘天集团',
    city: '杭州', type: '全职', experience: '3-5 年', education: '本科', salary: '薪资面议',
    tags: ['React', 'TypeScript', '工程化'], postedAt: '2026-07-21', source: '演示数据', favorite: false,
    match: 87, url: 'https://talent.alibaba.com/', summary: '建设高性能业务前端与跨端研发基础设施。'
  },
  {
    id: 'demo-003', companyId: 'bytedance', title: 'Agent 平台研发工程师', department: 'Flow',
    city: '北京', type: '全职', experience: '3-5 年', education: '本科', salary: '薪资面议',
    tags: ['LLM', 'Agent', 'Python'], postedAt: '2026-07-20', source: '演示数据', favorite: true,
    match: 95, url: 'https://jobs.bytedance.com/', summary: '参与智能体平台、工具编排和评测体系建设。'
  },
  {
    id: 'demo-004', companyId: 'meituan', title: '用户增长产品经理', department: '核心本地商业',
    city: '上海', type: '全职', experience: '3-5 年', education: '本科', salary: '薪资面议',
    tags: ['用户增长', '数据分析', '策略'], postedAt: '2026-07-19', source: '演示数据', favorite: false,
    match: 82, url: 'https://zhaopin.meituan.com/', summary: '通过数据与实验持续提升用户转化和留存。'
  },
  {
    id: 'demo-005', companyId: 'xiaomi', title: '桌面端开发工程师', department: '互联网业务部',
    city: '武汉', type: '全职', experience: '1-3 年', education: '本科', salary: '薪资面议',
    tags: ['Electron', 'Node.js', '跨平台'], postedAt: '2026-07-18', source: '演示数据', favorite: false,
    match: 89, url: 'https://hr.xiaomi.com/', summary: '负责跨平台桌面工具的架构、性能和体验。'
  },
  {
    id: 'demo-006', companyId: 'netease', title: 'AI 交互设计师', department: '伏羲实验室',
    city: '杭州', type: '全职', experience: '3-5 年', education: '本科', salary: '薪资面议',
    tags: ['AI UX', '设计系统', '原型'], postedAt: '2026-07-17', source: '演示数据', favorite: false,
    match: 79, url: 'https://hr.163.com/', summary: '探索生成式 AI 产品的新型交互范式。'
  }
];

const messages = [
  { id: 'msg-001', company: '腾讯招聘', subject: '面试邀请｜AI 产品经理', stage: '面试', receivedAt: '2026-07-22 14:30', unread: true, source: '演示数据', preview: '你好，邀请你参加本周五的线上技术面试，请选择合适时间。' },
  { id: 'msg-002', company: '字节跳动招聘', subject: '简历已进入评估阶段', stage: '流程中', receivedAt: '2026-07-21 10:08', unread: false, source: '演示数据', preview: '你的简历已经进入业务评估阶段，后续结果将通过邮件同步。' },
  { id: 'msg-003', company: '阿里巴巴招聘', subject: '在线测评提醒', stage: '测评', receivedAt: '2026-07-20 19:12', unread: true, source: '演示数据', preview: '请在 48 小时内完成在线测评，预计耗时 45 分钟。' },
  { id: 'msg-004', company: '美团招聘', subject: '感谢你的关注', stage: '结束', receivedAt: '2026-07-18 09:45', unread: false, source: '演示数据', preview: '本次岗位暂未进入后续环节，感谢关注。' }
];

const resume = {
  updatedAt: null,
  completion: 36,
  basic: { name: '', phone: '', email: '', city: '', gender: '', birthday: '', wechat: '', website: '' },
  intention: { roles: '', cities: '', salary: '', availability: '', employmentType: '全职' },
  education: [{ school: '', major: '', degree: '', start: '', end: '', rank: '', courses: '' }],
  experience: [{ company: '', role: '', start: '', end: '', description: '', achievements: '' }],
  projects: [{ name: '', role: '', start: '', end: '', description: '', link: '' }],
  skills: { keywords: '', languages: '', certificates: '', portfolio: '' },
  extras: { summary: '', awards: '', campus: '', publications: '', patents: '' }
};

function createSeed() {
  const now = new Date().toISOString();
  return {
    meta: { schemaVersion: 1, createdAt: now, updatedAt: now, onboardingSeen: false },
    companies,
    jobs,
    messages,
    resume,
    tasks: [
      { id: 'task-welcome', type: 'system', title: 'MVP 已就绪', status: 'done', progress: 100, createdAt: now, detail: '演示数据已载入，可体验筛选、收藏、简历保存与 Agent API。' }
    ],
    settings: {
      apiEnabled: true,
      apiPort: 53147,
      apiToken: '',
      githubRepo: 'lyzbcy/yijian-toudi',
      email: { address: '', connected: false, lastSyncAt: null },
      autoCheckUpdates: true,
      dataMode: 'demo'
    }
  };
}

module.exports = { createSeed };
