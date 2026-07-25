#!/usr/bin/env node
// 把余恩泽的真实简历写入「一键投递」数据，三份 profile（软件开发/游戏/AI 方向）。
// 覆盖 11 家大厂调研字段：basic 全字段、intention 全字段、education/experience/projects 全字段、family/compliance。
// basic/skills/family/compliance 全局共享；intention/教育/工作/项目 按 profile 独立。
//
// 数据来源：
// - 软件开发/简历内容.md（2026-07-24 版，含微盛 5-7 月）
// - 游戏/余恩泽简历2026.3.30.md（Unity/客户端全栈）
// - corporate-website 印证微盛项目
//
// 用法：node scripts/seed-resume.cjs
// 安全：写入前自动备份原 state.json；只覆盖 resume 字段。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const candidates = [
  path.join(os.homedir(), 'Library/Application Support/yijian-toudi/state.json'),
  path.join(os.homedir(), 'Library/Application Support/一键投递/state.json')
];
const stateFile = candidates.find((p) => fs.existsSync(p));
if (!stateFile) {
  console.error('❌ 找不到 state.json，请先启动一次「一键投递」生成数据目录。');
  process.exit(1);
}
console.log('找到数据文件：', stateFile);

const backup = stateFile + `.before-seed-${Date.now()}`;
fs.copyFileSync(stateFile, backup);
console.log('已备份原数据到：', backup);

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

// ===== 全局共享字段 =====
const basic = {
  name: '余恩泽',
  gender: '男',
  birthday: '2005-01-01', // 占位，用户可改
  phone: '19519955175',
  email: 'lyzbcy@qq.com',
  wechat: '',
  city: '苏州市',
  nativePlace: '江苏省苏州市', // 籍贯（游戏简历写户籍苏州）
  nationality: '中国',
  ethnicity: '汉族',
  politicalStatus: '共青团员',
  idCard: '', // 敏感，留空让用户自行填
  avatarUrl: '',
  website: 'https://lyzbcy.github.io/corporate-website/',
  github: 'https://github.com/lyzbcy',
  maritalStatus: '未婚',
  height: ''
};

const skills = {
  keywords: 'JavaScript,TypeScript,React,Python,C++,C#,FastAPI,Unity 3D,VR/XR,Barracuda,MediaPipe,Q-Learning,Neo4j,知识图谱,AC自动机,SSE 流式传输,企微 JSSDK,Git CLI,SEO 优化,前端逆向与重构,MoveNet,OpenXR,FastAPI,PyQt5,Cinemachine,Timeline,Toon Shader',
  proficiency: 'JavaScript/Python/C# 熟练；C++/Unity 底层 熟悉；VR/XR/MoveNet 精通（项目实战）',
  languages: '英语 CET-6 (492)，日常会话，读写熟练',
  certificates: '蓝桥杯软件赛江苏赛区二等奖；大学英语六级',
  certificateIds: '',
  portfolio: '',
  portfolioUrl: 'https://lyzbcy.github.io/corporate-website/',
  interests: '主持（院校级近20场活动）、技术博客、3D 建模'
};

const extras = {
  summary: '全栈开发与快速交付：独立交付 8 个涵盖 VR、AI 问答、3D 游戏及工具开发的可运行项目，曾在一个工作日内完成复杂 CMS 系统重构并上线。AI+工程交叉落地：深度实践 MoveNet 无穿戴体感输入、Q-Learning 自适应敌人 AI 及 AI 3D 建模管线。底层原理与性能优化：医药知识图谱查询效率 5 倍提升，VR 项目 Quest 2 稳定 90FPS。现代前端交互探索：SSE 流式传输处理经验，擅长构建 AI-Native 渐进式交互体验。',
  awards: '蓝桥杯个人赛省赛江苏赛区二等奖；2023/2024 年度江南大学奖学金；2024 年度优秀学生干部；2024 年度校内勤工助学优秀员工',
  campus: '人工智能2304班班长（2025/10-至今）、学习委员（2023-2025）；院主持人（2023/10-至今，近20场活动）',
  publications: '',
  patents: ''
};

const family = [
  { name: '', relation: '父亲', company: '', position: '', phone: '' },
  { name: '', relation: '母亲', company: '', position: '', phone: '' }
];

const compliance = {
  previouslyInterviewed: false,
  previouslyEmployed: false,
  hasRelativeAtCompany: false,
  relativeDetail: '',
  criminalRecord: false
};

// 共享教育经历
const sharedEducation = [{
  school: '江南大学', major: '人工智能', degree: '本科', degreeName: '学士（在读）',
  start: '2023-09', end: '2027-06', rank: '前20%',
  courses: '深度学习、计算机视觉、自然语言处理、数据结构与算法、操作系统、Unity 3D 开发',
  isFullTime: true, isUnified: true, is211: '是（双一流）',
  advisor: '陆恒杨', researchDirection: '', thesisTitle: ''
}];

// ===== Profile 1: 软件开发方向（前端为主，含微盛实习）=====
const softwareProfile = {
  id: 'default',
  label: '软件开发（前端/全栈）',
  intention: {
    roles: '前端开发工程师,全栈工程师,Web 开发',
    cities: '苏州,上海,杭州,深圳,北京',
    salary: '200-300', salaryUnit: '日薪（实习）',
    availability: '可随时到岗', employmentType: '实习',
    referralCode: '', channel: '',
    willingness: { travel: false, relocate: true, overtime: true, nightShift: false },
    preferredLocations: '苏州,上海,杭州'
  },
  education: sharedEducation,
  experience: [{
    company: '江苏微盛网络科技有限公司', department: '研发部', role: '前端研发实习生', level: '',
    start: '2026-04', end: '至今', employmentType: '实习', isOutsource: false,
    description: '在知名 SCRM 服务商（企业微信官方合作伙伴）研发部，负责官网、AI 智能体、企微文档检索等业务线前端开发，独立交付多个生产级功能。深度处理 SSE 流式传输 UI 渲染性能，调用企微 JSSDK（wx.invoke / $configReady 鉴权），具备复杂前后端契约对齐与多端联调经验。',
    achievements: '官网 2.0 全流程开发（产品价格页/公共头部/客服弹窗）；SEO 官网 PC 端 + Bing UET 接入；知识库 AI 二期（多源同步、公私分流检索）；企微文档检索 PC 端（扫码选文档→轮询回显→专区分析→注入大模型回复）',
    leaveReason: '', reportTo: '', teamSize: ''
  }],
  projects: [
    { name: '企微文档检索 PC 端（跨设备文档选择器）', role: '独立前端开发', start: '2026-06', end: '2026-07', description: '在企微管家 AI 智能体公共输入框新增「企微文档/微盘」入口。', contribution: '独立负责公共组件层入口、鉴权、二维码弹窗、轮询、附件回显和发送链路。', techStack: 'JavaScript,企微 JSSDK,SSE,轮询', outcome: '已完成 CR 整改并合入发布分支', scale: '', link: '', client: '微盛' },
    { name: '知识库 AI 开发二期（多源 AI 知识库）', role: '前端开发', start: '2026-05', end: '2026-06', description: '多来源（企微知识库+微盘）文档同步、统一检索、管理后台。', contribution: '打通企微文档知识库、企业微信机器人、Doc-Claw 管理端与腾讯云 ADP/TCADP。', techStack: 'JavaScript,企微 API,腾讯云 ADP', outcome: '实现企微文档同步入库+内部检索问答最小闭环', scale: '', link: '', client: '微盛' },
    { name: '企业官网 2.0 前端交付', role: '独立前端开发', start: '2026-04', end: '2026-05', description: '官网 2.0 全流程开发。', contribution: '产品价格页 2.0、公共头部组件、客服咨询弹窗；SEO 官网 + Bing UET。', techStack: 'JavaScript,CSS Flexbox,Bing UET', outcome: '完成从首轮开发到样式收口完整闭环', scale: '', link: '', client: '微盛' },
    { name: '基于知识图谱的医药智能问答系统', role: '独立开发者', start: '2025-11', end: '2025-12', description: '毫秒级响应的医药咨询平台。', contribution: 'Neo4j 多实体关系建模 + AC 自动机实体识别。', techStack: 'Python,FastAPI,Neo4j,PyQt5,AC自动机', outcome: '查询效率提升 5 倍以上，响应延迟毫秒级', scale: '千万级医疗数据', link: '', client: '' }
  ]
};

// ===== Profile 2: 游戏方向（Unity/VR/3D，源自游戏简历）=====
const gameProfile = {
  id: 'game',
  label: '游戏开发（Unity/VR/3D）',
  intention: {
    roles: 'Unity 客户端开发,游戏开发工程师,VR 开发工程师,3D 开发',
    cities: '上海,苏州,杭州,深圳,广州',
    salary: '200-350', salaryUnit: '日薪（实习）',
    availability: '可随时到岗', employmentType: '实习',
    referralCode: '', channel: '',
    willingness: { travel: false, relocate: true, overtime: true, nightShift: false },
    preferredLocations: '上海,苏州,杭州'
  },
  education: sharedEducation,
  experience: [], // 游戏方向暂无游戏公司正式实习
  projects: [
    { name: '《Fire》VR 音乐康复治愈游戏', role: '核心开发', start: '2025-04', end: '2025-12', description: '面向失语症辅助治疗的跨平台 VR 交互应用。', contribution: '深度应用 XR Interaction Toolkit 与 OpenXR 标准实现主流 VR 设备全兼容；引入 AI 3D 建模流程。', techStack: 'Unity,C#,XR Interaction Toolkit,OpenXR,Barracuda,Quest 2', outcome: '3D 物产效率提升 40%，Quest 2 稳定 90FPS', scale: '独立完成', link: '', client: '' },
    { name: 'Unity 编辑器效率工具集', role: '独立开发', start: '2025-11', end: '2025-12', description: '全流程编辑器扩展工具集。', contribution: '封装 Git CLI 图形化版本控制；FileSystemWatcher 智能延迟刷新；Fire VR Converter 一键 XR 配置；Barracuda+MoveNet 无穿戴体感输入。', techStack: 'Unity,C#,Git CLI,Barracuda,MoveNet', outcome: '减少窗口切换卡顿 60%，5 个 3D 项目一键转 VR', scale: '准发布产品', link: '', client: '' },
    { name: '《雷厉风行》3D 动作 RPG', role: '核心开发', start: '2025-03', end: '2025-05', description: '电影级运镜 + NPR 二次元渲染的动作 RPG。', contribution: 'Cinemachine 电影运镜；Toon Shader NPR 风格化；AI Navigation 群组寻路；Visual Scripting 技能组合。', techStack: 'Unity,C#,Cinemachine,Timeline,Toon Shader,AI Navigation', outcome: '完成核心战斗机制', scale: '', link: '', client: '' },
    { name: '禁止喧哗（No Noise）实时音频恐怖游戏', role: '独立开发', start: '2025-04', end: '2025-06', description: '麦克风音量驱动怪物威胁值的沉浸式恐怖游戏。', contribution: 'C# 实时音频采样；多阶段有限状态机；Jump Scare 机制。', techStack: 'Unity,C#,音频采样,FSM', outcome: '完成核心玩法', scale: '', link: '', client: '' }
  ]
};

// ===== Profile 3: AI 方向（知识图谱/MoveNet/Q-Learning）=====
const aiProfile = {
  id: 'ai',
  label: 'AI 应用开发（算法/工程）',
  intention: {
    roles: 'AI 应用开发工程师,算法工程师,NLP 工程师,AIGC 开发',
    cities: '北京,上海,深圳,杭州,苏州',
    salary: '200-350', salaryUnit: '日薪（实习）',
    availability: '可随时到岗', employmentType: '实习',
    referralCode: '', channel: '',
    willingness: { travel: false, relocate: true, overtime: true, nightShift: false },
    preferredLocations: '北京,上海,杭州'
  },
  education: sharedEducation,
  experience: [{
    company: '江苏微盛网络科技有限公司', department: '研发部', role: '前端研发实习生（AI 方向）', level: '',
    start: '2026-04', end: '至今', employmentType: '实习', isOutsource: false,
    description: '参与知识库 AI 二期、企微文档检索等 AI 智能体相关业务线开发，打通多源知识库与大模型检索问答。',
    achievements: '打通企微知识库+微盘多源同步、公私分流检索；接入腾讯云 ADP/TCADP；SSE 流式传输处理',
    leaveReason: '', reportTo: '', teamSize: ''
  }],
  projects: [
    { name: '基于知识图谱的医药智能问答系统', role: '独立开发者', start: '2025-11', end: '2025-12', description: '毫秒级响应的医药咨询平台。', contribution: 'Neo4j 多实体复杂关系建模；AC 自动机高效实体识别与多义项意图分类。', techStack: 'Python,FastAPI,Neo4j,AC自动机,PyQt5', outcome: '查询效率提升 5 倍以上，响应延迟毫秒级', scale: '千万级医疗数据', link: '', client: '' },
    { name: '神之手：最后的防线（AI 实验项目）', role: '独立开发', start: '2025-11', end: '2025-12', description: '手势追踪 + 强化学习的 AI 实验项目。', contribution: 'MediaPipe 21 关键点手部追踪+手势分类器；Q-Learning 强化学习代理（状态离散化+奖励函数优化）。', techStack: 'MediaPipe,Q-Learning,Python', outcome: '实现敌人 AI 自适应进攻策略', scale: '', link: '', client: '' },
    { name: 'Unity 编辑器体感输入（Barracuda+MoveNet）', role: '独立开发', start: '2025-11', end: '2025-12', description: '普通摄像头无穿戴体感输入方案。', contribution: 'Barracuda 推理引擎 + MoveNet 模型；手势驱动与虚拟输入映射。', techStack: 'Unity,Barracuda,MoveNet,C#', outcome: '无需穿戴设备即可体感交互', scale: '', link: '', client: '' },
    { name: '知识库 AI 二期（微盛，多源 AI 知识库）', role: '前端开发', start: '2026-05', end: '2026-06', description: '多来源文档同步、统一检索、管理后台。', contribution: '打通企微知识库、企业微信机器人、Doc-Claw 与腾讯云 ADP/TCADP。', techStack: 'JavaScript,腾讯云 ADP/TCADP,企微 API', outcome: '企微文档同步入库+内部检索问答闭环', scale: '', link: '', client: '微盛' }
  ]
};

const resume = {
  updatedAt: new Date().toISOString(),
  completion: 100,
  activeProfileId: 'default',
  basic,
  skills,
  extras,
  family,
  compliance,
  // 兼容视图（顶层镜像 active profile，由 store sync 刷新）
  intention: structuredClone(softwareProfile.intention),
  education: structuredClone(softwareProfile.education),
  experience: structuredClone(softwareProfile.experience),
  projects: structuredClone(softwareProfile.projects),
  profiles: [softwareProfile, gameProfile, aiProfile]
};

state.resume = resume;
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
console.log('✅ 简历已写入，共 3 份 profile：');
console.log('   1. 软件开发（前端/全栈）— 含微盛实习 + 4 项目');
console.log('   2. 游戏开发（Unity/VR/3D）— 4 个游戏项目');
console.log('   3. AI 应用开发（算法/工程）— 4 个 AI 项目');
console.log('   完整度：', resume.completion + '%');
console.log('   打开「一键投递」→ 我的简历，顶部可切换三份。');
