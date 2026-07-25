// 公司能力适配器注册表（design §3 六方法契约 + §6.1 五维能力）。
//
// 每个 entry 形状：
//   { id, name, idPrefix,
//     listJobs,               // async ({daysBack,recruitType,onProgress}) => Job[]   必填
//     inspectResume,          // async (ctx) => 远端字段当前值；未实现填 null
//     planResumePatch,        // (resume) => 差异计划；未实现填 null（暂用 resume-plan.cjs 全局规则兜底）
//     fillResume,             // async (resume, {workspace,company,taskId,onStep}) => 填写报告；未实现填 null
//     prepareApplication,     // async (job, {workspace,company,taskId,onStep}) => 投递状态；未实现填 null
//     inspectApplicationStatus, // async (job) => 投递状态；未实现填 null
//     capabilities: { jobs, login, resume, apply, status }  // verified/manual/degraded/unsupported
//   }
//
// 第一阶段（本次）：只做薄包装，把现有各家公司导出的函数名（listTencentJobs / fillTencentResume / applyTencentJob 等）
// 统一包成 listJobs / fillResume / prepareApplication，main.cjs 切到 registry 消费。
// 真正的五维能力值与 seed.cjs 保持一致（capabilities 由 seed 作为事实源，registry 这里只做能力与方法是否存在的对齐）。
//
// 后续：抽 _feishu-base.cjs（字节/小米共享）、补 inspectResume/planResumePatch/inspectApplicationStatus。

const { listTencentJobs } = require('./tencent.cjs');
const { listBaiduJobs } = require('./baidu.cjs');
const { listBytedanceJobs } = require('./bytedance.cjs');
const { listXiaomiJobs } = require('./xiaomi.cjs');
const { listJdJobs } = require('./jd.cjs');
const { listMeituanJobs } = require('./meituan.cjs');

const { createManualPrepareApplication } = require('./_manual-apply.cjs');
const { createManualFillResume } = require('./_manual-fill.cjs');
// 五家（字节/小米/京东/美团/百度）的 prepareApplication：打开详情页让用户手动投递
const manualApplyBytedance = createManualPrepareApplication('字节跳动');
const manualApplyXiaomi = createManualPrepareApplication('小米');
const manualApplyJd = createManualPrepareApplication('京东');
const manualApplyMeituan = createManualPrepareApplication('美团');
const manualApplyBaidu = createManualPrepareApplication('百度');
// 五家的 fillResume：打开官网简历页让用户手动填（manual 级别）
const manualFillBytedance = createManualFillResume('bytedance', '字节跳动');
const manualFillXiaomi = createManualFillResume('xiaomi', '小米');
const manualFillJd = createManualFillResume('jd', '京东');
const manualFillMeituan = createManualFillResume('meituan', '美团');
const manualFillBaidu = createManualFillResume('baidu', '百度');

// 腾讯简历填写/投递按需 require（避免主进程启动就加载 playwright 相关）
function tencentFill(resume, opts) {
  return require('./tencent-fill.cjs').fillTencentResume(resume, opts);
}
function tencentApply(job, opts) {
  return require('./tencent-apply.cjs').applyTencentJob(job, opts);
}

const REGISTRY = [
  {
    id: 'tencent',
    name: '腾讯',
    idPrefix: 'tencent-',
    listJobs: (opts) => listTencentJobs(opts),
    inspectResume: null,
    planResumePatch: null,
    fillResume: tencentFill,
    prepareApplication: tencentApply,
    inspectApplicationStatus: (opts) => require('./tencent-status.cjs').inspectTencentApplicationStatus(opts),
    capabilities: { jobs: 'verified', login: 'manual', resume: 'verified', apply: 'verified', status: 'manual' }
  },
  {
    id: 'baidu',
    name: '百度',
    idPrefix: 'baidu-',
    listJobs: (opts) => listBaiduJobs(opts),
    inspectResume: null, planResumePatch: null, fillResume: manualFillBaidu,
    prepareApplication: manualApplyBaidu,
    inspectApplicationStatus: null,
    capabilities: { jobs: 'verified', login: 'manual', resume: 'manual', apply: 'manual', status: 'unsupported' }
  },
  {
    id: 'bytedance',
    name: '字节跳动',
    idPrefix: 'bytedance-',
    listJobs: (opts) => listBytedanceJobs(opts),
    inspectResume: null, planResumePatch: null, fillResume: manualFillBytedance,
    prepareApplication: manualApplyBytedance,
    inspectApplicationStatus: null,
    capabilities: { jobs: 'verified', login: 'manual', resume: 'manual', apply: 'manual', status: 'unsupported' }
  },
  {
    id: 'xiaomi',
    name: '小米',
    idPrefix: 'xiaomi-',
    listJobs: (opts) => listXiaomiJobs(opts),
    inspectResume: null, planResumePatch: null, fillResume: manualFillXiaomi,
    prepareApplication: manualApplyXiaomi,
    inspectApplicationStatus: null,
    capabilities: { jobs: 'verified', login: 'manual', resume: 'manual', apply: 'manual', status: 'unsupported' }
  },
  {
    id: 'jd',
    name: '京东',
    idPrefix: 'jd-',
    listJobs: (opts) => listJdJobs(opts),
    inspectResume: null, planResumePatch: null, fillResume: manualFillJd,
    prepareApplication: manualApplyJd,
    inspectApplicationStatus: null,
    capabilities: { jobs: 'verified', login: 'manual', resume: 'manual', apply: 'manual', status: 'unsupported' }
  },
  {
    id: 'meituan',
    name: '美团',
    idPrefix: 'meituan-',
    listJobs: (opts) => listMeituanJobs(opts),
    inspectResume: null, planResumePatch: null, fillResume: manualFillMeituan,
    prepareApplication: manualApplyMeituan,
    inspectApplicationStatus: null,
    capabilities: { jobs: 'verified', login: 'manual', resume: 'manual', apply: 'manual', status: 'unsupported' }
  }
];

const byId = new Map(REGISTRY.map((a) => [a.id, a]));

function getAdapter(companyId) {
  return byId.get(companyId);
}

// 用于 refreshJobs：只返回 jobs 能力非 unsupported 的（即能抓岗位的）
function listJobAdapters() {
  return REGISTRY.filter((a) => a.capabilities.jobs !== 'unsupported');
}

// 用于能力矩阵展示：返回 [{id, name, ...capabilities}]
function capabilityMatrix() {
  return REGISTRY.map((a) => ({ id: a.id, name: a.name, ...a.capabilities }));
}

module.exports = { REGISTRY, getAdapter, listJobAdapters, capabilityMatrix };
