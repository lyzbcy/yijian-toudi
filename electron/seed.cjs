const companies = [
  { id: 'tencent', name: '腾讯', short: 'T', color: '#1664ff', portal: 'https://careers.tencent.com/', status: 'adapter-needed', enabled: true },
  { id: 'alibaba', name: '阿里巴巴', short: 'A', color: '#ff6a00', portal: 'https://talent.alibaba.com/', status: 'adapter-needed', enabled: true },
  { id: 'bytedance', name: '字节跳动', short: '字', color: '#111827', portal: 'https://jobs.bytedance.com/', status: 'adapter-needed', enabled: true },
  { id: 'meituan', name: '美团', short: '美', color: '#ffc300', portal: 'https://zhaopin.meituan.com/', status: 'adapter-needed', enabled: true },
  { id: 'xiaomi', name: '小米', short: '米', color: '#ff6900', portal: 'https://hr.xiaomi.com/', status: 'adapter-needed', enabled: true },
  { id: 'netease', name: '网易', short: '易', color: '#e1251b', portal: 'https://hr.163.com/', status: 'adapter-needed', enabled: true }
];

// 岗位列表：不再内置演示数据。首次启动为空，用户点“刷新全部岗位”后由各公司适配器抓取真实数据。
const jobs = [];

// 招聘邮件：不内置演示数据。由 QQ 邮箱同步按需拉取。
const messages = [];

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
      { id: 'task-welcome', type: 'system', title: '已就绪', status: 'done', progress: 100, createdAt: now, detail: '点击“刷新全部岗位”开始抓取真实招聘数据。' }
    ],
    settings: {
      apiEnabled: true,
      apiPort: 53147,
      apiToken: '',
      githubRepo: 'lyzbcy/yijian-toudi',
      email: { address: '', connected: false, lastSyncAt: null },
      autoCheckUpdates: true,
      dataMode: 'live',
      jobs: { daysBack: 30, lastRefreshAt: null }
    }
  };
}

module.exports = { createSeed };
