/* Public operation contract only; no selectors, engine implementation or credentials. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YJAgentGuide = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function instructions(version) {
    return [
      '# 一键投递 · Agent 操作 Skill',
      '版本：' + version + '。本说明随桌面软件交付；已安装独立 Skill 时先执行 scripts/use.cjs 并核对有效版本。',
      '## 接入与能力发现',
      '从应用「连接 AI Agent」取得本机 Base URL；Bearer Token 仅放私有环境变量。GET /v1/status 核对运行版本，再 GET /v1/skill 读取本版本操作说明。关闭 API 时保持人工使用，不自动开启。',
      '所有接口都要求 Authorization: Bearer <私有Token>，API 只监听 127.0.0.1。此说明不含凭据、网站选择器或自动化引擎实现。',
      '## 根据简历筛选岗位',
      '岗位采用多来源聚合，OfferBiu只是新增的资料源之一，不替换现有来源，也不回写OfferBiu。GET /v1/job-sources 查看来源状态。浏览器Agent只读正常可见的信息库页面及其实际列表响应，POST /v1/job-sources/offerbiu/import 入库（sourceUrl,capturedAt,observedPage,payload；可dryRun:true）。一条招聘信息不等于一个具体岗位，未知资格、截断文本与原招聘链接必须继续核验；previewLimited不代表全库抓取完成。',
      'GET /v1/resume 读取脱敏简历；GET /v1/jobs 读取岗位与公司。按城市、方向、经历和岗位要求输出匹配理由、事实缺口与原始岗位链接，不虚构经验。',
      'GET /v1/messages 查看招聘消息；GET /v1/tasks 查看任务与回执。脱敏不等于匿名，教育/工作/项目仍属个人信息。',
      '## 本地数据操作',
      'POST /v1/commands，Content-Type: application/json；每次写入带 Idempotency-Key，同动作重试复用原键。',
      '筛选：{"action":"search_jobs","filter":{"keyword":"前端","city":"苏州","limit":20}}。',
      '购物车：{"action":"batch_cart","jobIds":["真实岗位ID"]}。简历增量：{"action":"update_resume","patch":{"skills":{"keywords":"用户确认的技能"}},"merge":true}。',
      '修改前说明差异，优先最小增量；不擅自整体替换经历、删除 profile 或填写未经用户确认的事实。',
      '## 网站改版后的协作',
      '企业官网字段更新可能阻塞自动填写；软件修复未发布时，先 GET /v1/tasks、GET /v1/diagnostics/workspaces 与 GET /v1/resume/batch 读取原任务和页面状态；接口返回 501 表示当前运行环境未提供该诊断，转为人工核对。',
      '只读诊断不等于完整网页控制。按任务报告定位公司、字段和失败步骤，列出人工处理清单，请用户在应用原窗口修正后重新核对。',
      'POST /v1/resume/batch/action 支持 query-widget / query-saved / verify-saved / continue / retry-widget；仅在用户完成原页核对后执行 continue 或 retry-widget，沿用 GET /v1/resume/batch 返回的原 id，不猜 ID、不重建未知任务。',
      'requiresReview=true、review-required、login-required、manual-required 或验证码时暂停并请用户接管；未知回执先查询，不重复投递，不绕过验证。',
      'APP内置填表启动、最终提交和邮箱同步仍由用户回到应用确认；外部浏览器Agent按用户明确授权的身份、筛选、数量与预算执行，不扩展范围；本地保存、字段回读、官网保存、已投递分别报告，只有真实成功回执才记成功。',
      'Boss 批量是独立授权入口：GET /v1/boss/accounts 与 /v1/boss/batch/status 核对账号和旧任务；按用户明确授权 POST /v1/boss/batch/start，携带 accountId、target、dryRun，先演练再正式执行，不自动清除待复核状态。',
      '401：回应用核对或重新取得 Token；503/断连：保留任务ID与幂等键，重开后查询原结果；404：核对运行版本，不猜测未支持能力。',
      '## 任意企业官网 Agent 协作',
      '已配置浏览器工具的 Agent 可协助操作未知企业官网，不必等待新增专用适配器；本 API 只管理持久账本，不提供通用网页控制。详细动作契约见有效 Skill references/official-applications.md。',
      'GET /v1/applications?accountId=ACCOUNT&profileId=PROFILE 查询本次身份任务；POST /v1/applications 带 Idempotency-Key，使用 create/checkpoint/ready/begin-submit/receipt/sync 管理任务，除create外携带原 id/revision。',
      '先核对资格硬条件和地区偏好，优先复用已登录平台与已核对简历，连续处理匹配企业，再走短表单和复杂独立官网；平台复用不放宽资格。已授权范围内不因完成几家而停等继续；达到目标/预算或账号级限制时停止。登录、验证码、缺资料暂停该站而非整批。补充问题去重追加、不覆盖答案；保留待登录、草稿和未知回执的原标签。',
      '智联校园正式网申：客户端投递管理的“智联校园网申”按钮读取已登录浏览器当前可见岗位；GET /v1/job-sources 查询能力，POST /v1/applications/zhilian-campus/read {open:true}读取当前列表，POST /v1/job-sources/zhilian-campus/import将原始read结果入库（可dryRun:true），POST /v1/applications/zhilian-campus/inspect {url,text,buttons}检查页面阶段。隐私政策/登录/验证由用户在原页处理；可见页不是全量岗位。',
      '先按来源稳定岗位ID定位真实卡片，打开职位并核对主体、资格和企业指定报名入口；普通平台立即投递只代表平台简历申请，不自动认定企业ATS。跳转外站保留实际观察的入口和岗位ID，继续用浏览器Agent核对申请表/附件/最终确认，不能仅靠域名或成功字样判断。',
      '智联create添加platform:zhilian-campus，applicationRoute可先unknown，企业/岗位/URL必须真实；最终receipt必须补platform-resume或employer-ats。聊天单独action:interaction，event:chat-started（或redirected/draft-saved），附observed/observedAt/url/reference/text证据，不标submitted。',
      'typed receipt仍要求ready→begin-submit→原attemptId与evidence；另外在body顶层给routeObservation:{event:platform-delivered,observed:true}或{event:ats-submitted,observed:true,employerDesignated:true}及applicationRoute。企业指定第三方托管ATS有效，但须有企业指定依据。成功回执自动进入投递管理；unknown/聊天不冒充正式网申。旧无类型成功保留为历史/未分类，不重写或重投。',
      '投递管理统一刷新：用户要求刷新后，POST /v1/career/refresh {accountId,profileId,confirmRead:true,reconnect:true}；按report逐项汇报局部邮箱覆盖/官网已核对/待核对，不把未覆盖当成功。仅核对已支持且打开的官网，不重投。简称匹配先由Agent读正文确认唯一申请，再POST /v1/career/mail-match {accountId,profileId,id,mailId,observedAt,evidence}；只确认单封，不全局模糊匹配。',
      '国聘观察可POST /v1/applications/iguopin/inspect（url,text,buttons,successDialogVisible,successDialogText），区分已申请、成功弹窗、确认、专属模板、缺资料与验证；该接口只判断Agent观察，不点击、发短信或提交。',
      '最终提交须用户授权并核对字段、资格和附件；begin-submit只登记意图。断连先查原官网申请，不重复提交；只有带官网回执引用的receipt才登记submitted，回执标agent-reported，账本不独立验证网站。结果直接进入一键投递内部申请账本，已投递页展示账号、简历、缺项和回执；不回写OfferBiu。已有sync接口只兼容历史记录，不作为本流程必需步骤。99%为覆盖目标，当前无实测覆盖率。',
      '## 输出证据',
      '分别报告已完成、阻塞、待用户确认与下一步，附任务ID/来源；不要输出 Token、邮件正文或完整简历。'
    ].join('\n');
  }
  return { instructions: instructions };
});
