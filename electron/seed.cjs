// 公司清单。tags 用于岗位筛选（500强/AI公司/游戏/无锡/苏州）。
// adapterStatus: adapter-ready(已能抓取) / login-only(需登录后浏览) / adapter-needed(待适配)
// 标签是人工维护的事实数据（一家公司是不是500强/AI，是确定的），不随岗位抓取变化。
const companies = [
  // ===== 互联网头部（已适配或待适配） =====
  { id: 'tencent', name: '腾讯', short: 'T', color: '#1664ff', logoUrl: './assets/logos/tencent.png', portal: 'https://careers.tencent.com/', tags: ['500强', 'AI公司'], adapterStatus: 'adapter-ready', applyRule: { maxActive: 3, cooldown: '7天', note: '腾讯 7 天内最多投递 3 个岗位' }, enabled: true },
  { id: 'baidu', name: '百度', short: '百', color: '#2932e1', logoUrl: './assets/logos/baidu.svg', portal: 'https://talent.baidu.com/', tags: ['500强', 'AI公司'], adapterStatus: 'adapter-ready', enabled: true },
  { id: 'bytedance', name: '字节跳动', short: '字', color: '#111827', logoUrl: './assets/logos/bytedance.svg', portal: 'https://jobs.bytedance.com/', tags: ['500强', 'AI公司'], adapterStatus: 'adapter-ready', enabled: true },
  { id: 'alibaba', name: '阿里巴巴', short: 'A', color: '#ff6a00', portal: 'https://talent.alibaba.com/', tags: ['500强', 'AI公司'], adapterStatus: 'adapter-needed', enabled: true },
  { id: 'meituan', name: '美团', short: '美', color: '#ffc300', logoUrl: './assets/logos/meituan.svg', portal: 'https://zhaopin.meituan.com/', tags: ['500强'], adapterStatus: 'adapter-ready', enabled: true },
  { id: 'jd', name: '京东', short: '京', color: '#e1251b', logoUrl: './assets/logos/jd.png', portal: 'https://zhaopin.jd.com/', tags: ['500强'], adapterStatus: 'adapter-ready', enabled: true },
  { id: 'xiaomi', name: '小米', short: '米', color: '#ff6900', logoUrl: './assets/logos/xiaomi.svg', portal: 'https://xiaomi.jobs.f.mioffice.cn/', tags: ['500强'], adapterStatus: 'adapter-ready', enabled: true },
  { id: 'pdd', name: '拼多多', short: '拼', color: '#e1251b', portal: 'https://careers.pddglobalhr.com/', tags: ['500强'], adapterStatus: 'adapter-needed', enabled: true },
  { id: 'huawei', name: '华为', short: '华', color: '#cf0a2c', logoUrl: './assets/logos/huawei.svg', portal: 'https://career.huawei.com/cn', tags: ['500强', 'AI公司'], adapterStatus: 'adapter-needed', enabled: true },

  // ===== 游戏 =====
  { id: 'mihoyo', name: '米哈游', short: '米哈', color: '#5a8dee', logoUrl: './assets/logos/mihoyo.svg', portal: 'https://app.mihoyo.com/', tags: ['游戏', 'AI公司'], adapterStatus: 'adapter-needed', applyRule: { maxActive: 1, cooldown: '30天', note: '米哈游 30 天内只能投递一个岗位' }, enabled: true },
  { id: 'netease', name: '网易', short: '易', color: '#e1251b', logoUrl: './assets/logos/netease.png', portal: 'https://hr.163.com/', tags: ['500强', '游戏', 'AI公司'], adapterStatus: 'login-only', enabled: true },

  // ===== 无锡本地 AI/芯片（T0，调研 2026-07-24） =====
  { id: 'xuelang', name: '雪浪数制', short: '雪', color: '#2eb872', logoUrl: './assets/logos/xuelang.png', portal: 'https://www.xuelangyun.com/', tags: ['AI公司', '无锡'], adapterStatus: 'adapter-needed', enabled: true },
  { id: 'crmicro', name: '华润微电子', short: '润', color: '#cc0000', logoUrl: './assets/logos/crmicro.png', portal: 'https://www.crmicro.com/contact/', tags: ['500强', '无锡'], adapterStatus: 'login-only', enabled: true },
  { id: 'jcet', name: '长电科技', short: '长', color: '#0066b3', logoUrl: './assets/logos/jcet.svg', portal: 'https://www.jcetglobal.com/', tags: ['500强', '无锡'], adapterStatus: 'login-only', enabled: true },
  { id: 'skhynix', name: 'SK海力士', short: 'SK', color: '#e60012', portal: 'https://job.skhynixsystemic.cn/', tags: ['500强', '无锡'], adapterStatus: 'login-only', enabled: true },

  // ===== 苏州本地 AI（T0，苏州"十小虎"代表） =====
  { id: 'aispeech', name: '思必驰', short: '思', color: '#0091ff', logoUrl: './assets/logos/aispeech.png', portal: 'https://www.aispeech.com/about/joinus', tags: ['AI公司', '苏州'], adapterStatus: 'adapter-needed', enabled: true },
  { id: 'iflytek', name: '科大讯飞', short: '讯', color: '#e4393c', portal: 'https://iflytek.zhiye.com/', tags: ['500强', 'AI公司', '苏州'], adapterStatus: 'adapter-needed', enabled: true },
  { id: 'momenta', name: 'Momenta魔门塔', short: 'Mo', color: '#7b2ff7', logoUrl: './assets/logos/momenta.png', portal: 'https://www.momenta.cn/', tags: ['AI公司', '苏州'], adapterStatus: 'adapter-needed', enabled: true },
  { id: 'qcc', name: '企查查', short: '查', color: '#3b82f6', logoUrl: './assets/logos/qcc.png', portal: 'https://www.qcc.com/', tags: ['AI公司', '苏州'], adapterStatus: 'adapter-needed', enabled: true }
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
    cart: [],
    applied: [],
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
      jobs: { daysBack: 30, lastRefreshAt: null, recruitType: 'social' }
    }
  };
}

module.exports = { createSeed };
