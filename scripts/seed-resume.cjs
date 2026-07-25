#!/usr/bin/env node
// 把余恩泽的真实简历写入「一键投递」开发版数据（~/Library/Application Support/yijian-toudi/state.json）
// 用法：node scripts/seed-resume.cjs
// 安全：写入前自动备份原 state.json；只覆盖 resume 字段，不碰 jobs/cart/applied/settings。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// 兼容开发版（yijian-toudi）和正式版（一键投递）两个可能的数据目录
const candidates = [
  path.join(os.homedir(), 'Library/Application Support/yijian-toudi/state.json'),
  path.join(os.homedir(), 'Library/Application Support/一键投递/state.json')
];
const stateFile = candidates.find((p) => fs.existsSync(p));
if (!stateFile) {
  console.error('❌ 找不到 state.json，请先启动一次「一键投递」应用生成数据目录。');
  console.error('   尝试过：', candidates);
  process.exit(1);
}
console.log('找到数据文件：', stateFile);

// 备份
const backup = stateFile + `.before-seed-${Date.now()}`;
fs.copyFileSync(stateFile, backup);
console.log('已备份原数据到：', backup);

const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));

// 简历内容（来源：软件开发/2026.1.30简历&评价/简历内容.md，2026-07-24 版本 + 网站 corporate-website 印证）
const resume = {
  updatedAt: new Date().toISOString(),
  completion: 100,
  activeProfileId: 'default',
  basic: {
    name: '余恩泽',
    phone: '19519955175',
    email: 'lyzbcy@qq.com',
    city: '苏州市',
    gender: '男',
    birthday: '',
    wechat: '',
    website: 'https://lyzbcy.github.io/corporate-website/'
  },
  intention: {
    roles: '前端开发工程师,AI 应用开发,全栈工程师',
    cities: '苏州,上海,杭州,深圳,北京',
    salary: '15k-25k',
    availability: '可随时到岗',
    employmentType: '实习'
  },
  education: [{
    school: '江南大学',
    major: '人工智能',
    degree: '本科',
    start: '2023-09',
    end: '2027-06',
    rank: '前20%',
    courses: '深度学习、计算机视觉、自然语言处理、数据结构与算法、操作系统、Unity 3D 开发'
  }],
  experience: [{
    company: '江苏微盛网络科技有限公司',
    role: '前端研发实习生',
    start: '2026-04',
    end: '至今',
    description: '在知名 SCRM 服务商（企业微信官方合作伙伴）研发部，负责官网、AI 智能体、企微文档检索等业务线前端开发，独立交付多个生产级功能。深度处理 SSE 流式传输 UI 渲染性能，调用企微 JSSDK（wx.invoke / $configReady 鉴权），具备复杂前后端契约对齐与多端联调经验。',
    achievements: '官网 2.0 全流程开发（产品价格页/公共头部/客服弹窗）；SEO 官网 PC 端 + Bing UET 接入；知识库 AI 二期（企微知识库+微盘多源同步、公私分流检索、管理后台）；企微文档检索 PC 端（扫码选文档→轮询回显→专区分析→注入大模型回复）'
  }],
  projects: [
    {
      name: '企微文档检索 PC 端（跨设备文档选择器）',
      role: '独立前端开发',
      start: '2026-06',
      end: '2026-07',
      description: '在企微管家 AI 智能体公共输入框新增「企微文档/微盘」入口，实现扫码选文档 → PC 端轮询回显附件卡片 → 发送时交后端专区程序分析 → 分析结果注入大模型回复的完整链路。',
      link: ''
    },
    {
      name: '知识库 AI 开发二期（多源 AI 知识库）',
      role: '前端开发',
      start: '2026-05',
      end: '2026-06',
      description: '构建多来源（企微知识库+微盘）文档同步、统一检索（公私分流）、管理后台完整系统；打通企微文档知识库、企业微信机器人、Doc-Claw 管理端与腾讯云 ADP/TCADP，实现企微文档同步入库+内部检索问答最小闭环。',
      link: ''
    },
    {
      name: '企业官网 2.0 前端交付',
      role: '独立前端开发',
      start: '2026-04',
      end: '2026-05',
      description: '独立负责产品价格页 2.0、公共头部组件、客服咨询弹窗的开发与提测排障，完成从首轮开发到样式收口的完整闭环。SEO 官网 PC 端首页及 openClaw 核心入口，接入 Bing UET 与落地页参数解析。',
      link: ''
    },
    {
      name: '基于知识图谱的医药智能问答系统',
      role: '独立开发者',
      start: '2025-11',
      end: '2025-12',
      description: '在 Neo4j 中构建多实体复杂关系网络，利用 AC 自动机算法实现高效实体识别与多义项意图分类；采用 FastAPI 异步架构配合缓存机制，将查询效率提升 5 倍以上，平均响应延迟优化至毫秒级。',
      link: ''
    },
    {
      name: 'Unity 编辑器效率工具集',
      role: '独立开发',
      start: '2025-11',
      end: '2025-12',
      description: '封装 Git CLI 实现图形化版本控制；引入 FileSystemWatcher 智能延迟刷新，减少窗口切换卡顿 60%；开发 Fire VR Converter 一键配置 XR 协议；基于 Barracuda + MoveNet 实现无穿戴体感输入方案。',
      link: ''
    },
    {
      name: '《Fire》VR 音乐康复治愈项目',
      role: '核心开发',
      start: '2025-04',
      end: '2025-12',
      description: '面向失语症辅助治疗的跨平台 VR 交互应用。深度应用 XR Interaction Toolkit 与 OpenXR 标准，引入 AI 3D 建模流程将 3D 物产效率提升 40%，在 Quest 2 上确保稳定 90FPS。',
      link: ''
    }
  ],
  skills: {
    keywords: 'JavaScript,TypeScript,Python,C++,C#,FastAPI,Unity 3D,VR/XR 开发,Barracuda,MediaPipe,Q-Learning,Neo4j,知识图谱,SSE 流式传输,企微 JSSDK,Git CLI,SEO 优化,前端逆向与重构',
    languages: '英语 CET-6 (492)',
    certificates: '蓝桥杯软件赛江苏赛区二等奖',
    portfolio: 'https://lyzbcy.github.io/corporate-website/'
  },
  extras: {
    summary: '全栈开发与快速交付：独立交付 8 个涵盖 VR、AI 问答、3D 游戏及工具开发的可运行项目。AI+工程交叉落地：深度实践 MoveNet 无穿戴体感输入、Q-Learning 自适应敌人 AI 及 AI 3D 建模管线。底层原理与性能优化：医药知识图谱查询效率 5 倍提升，VR 项目 Quest 2 稳定 90FPS。现代前端交互探索：SSE 流式传输处理经验，擅长构建 AI-Native 渐进式交互体验。',
    awards: '蓝桥杯个人赛省赛江苏赛区二等奖；2023/2024 年度江南大学奖学金；2024 年度优秀学生干部',
    campus: '人工智能2304班班长（2025/10-至今）、学习委员（2023-2025）；院主持人（2023/10-至今，近20场活动）',
    publications: '',
    patents: ''
  },
  profiles: [{
    id: 'default',
    label: '默认简历',
    intention: {
      roles: '前端开发工程师,AI 应用开发,全栈工程师',
      cities: '苏州,上海,杭州,深圳,北京',
      salary: '15k-25k',
      availability: '可随时到岗',
      employmentType: '实习'
    },
    education: [{
      school: '江南大学', major: '人工智能', degree: '本科',
      start: '2023-09', end: '2027-06', rank: '前20%',
      courses: '深度学习、计算机视觉、自然语言处理、数据结构与算法、操作系统、Unity 3D 开发'
    }],
    experience: [{
      company: '江苏微盛网络科技有限公司', role: '前端研发实习生',
      start: '2026-04', end: '至今',
      description: '在知名 SCRM 服务商（企业微信官方合作伙伴）研发部，负责官网、AI 智能体、企微文档检索等业务线前端开发，独立交付多个生产级功能。深度处理 SSE 流式传输 UI 渲染性能，调用企微 JSSDK（wx.invoke / $configReady 鉴权），具备复杂前后端契约对齐与多端联调经验。',
      achievements: '官网 2.0 全流程开发；SEO 官网 PC 端 + Bing UET 接入；知识库 AI 二期（多源同步、公私分流检索）；企微文档检索 PC 端（扫码选文档→轮询回显→专区分析→注入大模型回复）'
    }],
    projects: [
      { name: '企微文档检索 PC 端（跨设备文档选择器）', role: '独立前端开发', start: '2026-06', end: '2026-07', description: '扫码选文档 → PC 端轮询回显附件卡片 → 发送时交后端专区程序分析 → 分析结果注入大模型回复的完整链路。', link: '' },
      { name: '知识库 AI 开发二期（多源 AI 知识库）', role: '前端开发', start: '2026-05', end: '2026-06', description: '多来源文档同步、统一检索（公私分流）、管理后台；打通企微文档知识库、企业微信机器人、Doc-Claw 管理端与腾讯云 ADP/TCADP。', link: '' },
      { name: '企业官网 2.0 前端交付', role: '独立前端开发', start: '2026-04', end: '2026-05', description: '产品价格页 2.0、公共头部组件、客服咨询弹窗完整闭环；SEO 官网 PC 端 + Bing UET 接入。', link: '' },
      { name: '基于知识图谱的医药智能问答系统', role: '独立开发者', start: '2025-11', end: '2025-12', description: 'Neo4j 多实体关系网络 + AC 自动机实体识别；FastAPI 异步架构查询效率提升 5 倍，响应延迟毫秒级。', link: '' },
      { name: 'Unity 编辑器效率工具集', role: '独立开发', start: '2025-11', end: '2025-12', description: 'Git CLI 图形化版本控制；FileSystemWatcher 智能延迟刷新减少卡顿 60%；Fire VR Converter 一键 XR 配置；Barracuda + MoveNet 无穿戴体感输入。', link: '' },
      { name: '《Fire》VR 音乐康复治愈项目', role: '核心开发', start: '2025-04', end: '2025-12', description: 'XR Interaction Toolkit + OpenXR 跨设备兼容；AI 3D 建模流程提升物产效率 40%；Quest 2 稳定 90FPS。', link: '' }
    ]
  }]
};

state.resume = resume;
fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + '\n', 'utf8');
console.log('✅ 简历已写入，完整度：', resume.completion + '%');
console.log('   打开「一键投递」应用 → 我的简历，即可看到。');
