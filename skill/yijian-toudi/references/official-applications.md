# 任意企业官网 · Agent 协作

目标是扩大企业覆盖，不要求每家公司先开发专用适配器。桌面已有适配器优先；未知官网交用户已配置的浏览器 Agent。Agent 使用自己的受支持浏览器工具读取和操作网站，本机 API 仅管理持久任务/资料缺口/回执，不提供任意网页控制。没有浏览器工具时保留任务等待用户处理。

## 可直接复用的提示词
```text
先核对一键投递 /v1/status 与有效 Skill 同版本，读取 /v1/skill。
用本次用户明确指定的 ACCOUNT、PROFILE、简历附件与投递要求，不沿用其他客户的资料或登录态。
读取 references/official-applications.md。由我的浏览器工具处理企业官网，本机 /v1/applications 只做账本。
先核对资格硬条件与地区偏好，优先在已登录且简历核对完成的平台连续处理多家匹配企业，再走简历直投/短表单，最后处理需独立注册的复杂官网；平台复用不放宽资格。每站设时间预算，阻塞只暂停该站。
在用户已授权的身份、筛选、数量和预算内持续推进，不每完成几家就停等“继续”；达到目标/预算、用户要求停止、身份错配或账号级限制时停止。进度可阶段报告，但不把报告当中断点。
逐页观察字段、动态选项、年月精度、附件解析及重复经历；写后回读，不猜必填事实。新问题追加到缺口清单，不覆盖已确认答案。
遇登录、短信、验证码暂停该站，请我接管，不自动重发短信。保留正在登录、待补资料和未知回执页，别因清理标签丢会话。
最终提交前核对企业主体、岗位ID、资格、字段、最新附件和有效提交授权；用户已明确授权的批次可在原范围内连续执行，范围变化或需新确认的声明则暂停。先登记 begin-submit，再只提交一次。
断连或不确定登记 submission-unknown，只查询官网我的申请，不再次点击提交。看到官网成功回执才登记 submitted，并附官网URL、观察时间、回执文本与本地截图/记录引用。
OfferBiu仅作为多个岗位信息来源之一，不向其写入投递记录。官网结果、证据及资料缺口直接登记一键投递内部账本；最终按不同企业去重，分别列官网成功、待补资料、未知和跳过。
```

## 持久账本 API
全部接口要求本机 Bearer Token；每次 POST 带唯一 `Idempotency-Key`，网络重试使用原键与原 JSON，跨动作使用新键。CLI 在有效 Skill root 执行：
```powershell
node scripts/applications.cjs list ACCOUNT PROFILE
node scripts/applications.cjs write PRIVATE_JSON_FILE STABLE_KEY
```
不把密钥写入 JSON/回执/命令参数。CLI Token 来自私有 `YJTD_API_TOKEN`；本机地址来自 `YJTD_BASE_URL`。更新后从有效root运行，旧APP版本不匹配时停止写入。

- GET `/v1/applications?accountId=ACCOUNT&profileId=PROFILE`：只读任务、缺口与计数。严格限定本次身份范围；真实浏览器身份仍须Agent在官网检查。
- POST `/v1/applications`：以下动作均带 `accountId/profileId`。除create外带返回的 `id/revision`；409先GET核对并发，不盲改revision重放动作。
- create：`{"action":"create","accountId":"ACCOUNT","profileId":"PROFILE","company":"企业完整招聘主体名称","role":"电气工程师","jobKey":"官网稳定岗位ID","url":"https://招聘官网/岗位路径"}`。公司全称+岗位ID按身份去重；集团子公司分别记主体，不用集团简称合并。同公司不同岗位可登记，但成功企业数仅算一家。
- checkpoint：`status` 为 in-progress / waiting-login / waiting-verification / waiting-materials / waiting-review / skipped，带 `reason`；可带 `tabId` 和 `missingFields:[{field,reason}]`。只记问题，不记身份证号、密码、验证码或答案；公司专属答案仍按原简历模块保存。
- ready：带 `eligibilityConfirmed/factsConfirmed/fieldsReviewed/attachmentsReviewed:true` 与 `missingFields:[]`。附件解析可能拆出重复学校，必须核对修正；未知考试满分/年月/年薪月薪单位不能当确认值。
- begin-submit：仅ready允许，带 `userAuthorized:true`；返回唯一 `attemptId`。它只登记提交意图，不会点击网站。进程退出后submitting仍视为未知，先查询原官网。
- receipt：带原 `attemptId`、`outcome:submitted|submission-unknown|not-submitted`。已提交/明确未提交均须 `evidence:{observed:true,url,reference,text,observedAt}`；observedAt用当前实际观察ISO时间，不填计划时间。not-submitted回到waiting-review，重新人工核对才可ready。未知状态只查询，不能checkpoint/ready重新开启提交。
- sync（历史兼容，不属于当前默认流程）：仅submitted允许；带 `status:pending|synced|failed,destination,reference`。synced的reference引用外部平台刷新后可回读的记录；不把新增待投递卡当已投递。同步操作由Agent自己执行，本接口只是登记结果。

账本回执标注 `agent-reported`，软件校验结构、身份、状态、修订与时间，不独立验证截图/官网真伪。计数是Agent带证据登记的结果，不是自动核验覆盖率。`coverage.measuredPercent:null` 表示尚无全企业抽样分母；99%是目标，不是当前验收结果。

## 会话与异常
1. 仅关闭本任务创建且已完成、已保存回执、无待登录/草稿/未知状态的标签；其他任务/用户原标签不动。
2. 验证码按站点和用途区分登录/注册，过期请用户处理，不把注册短信重用于登录。
3. 资料补充表按字段追加问题、来源公司和状态；先回读已有答案，用户明确修正值优先，矛盾标待核。
4. 邮箱直投先确认客户邮箱可用及授权；未登录或签字材料缺失则记待办，不因入口短就当可完成。集团/同ATS简历复用前核对主体与当前岗位，不把“已申请”提示用于新增计数。
5. API成功不代表官网成功。HTTP超时先用GET查原任务并复用原键；旧任务未知时不创建换ID重投。
6. 简历保存在本机、官网保存、正式申请、外部同步四层分别报告。对每站记录完整结果，再以实际抽样企业数计算覆盖率；纯人工接管与Agent闭环分列。

## 多来源岗位与国聘（0.5.85）
保留既有岗位来源；OfferBiu不是唯一源，也不是投递结果接收方。浏览器Agent读取当前正常可见的信息库页面，保存该页实际响应，不绕过预览限制，不宣称全量抓取。
```powershell
node scripts/applications.cjs source-import PRIVATE_SOURCE_JSON
node scripts/applications.cjs iguopin-inspect PRIVATE_OBSERVATION_JSON
```
来源JSON为 `{sourceUrl:"https://offerbiu.com/companies/",capturedAt:"实际观察ISO时间",observedPage:0,payload:实际成功响应,dryRun:true}`；observedPage是响应的零基页码，不是UI页码。先dryRun，核对后去掉dryRun正式入库。同一来源ID重复导入只更新来源字段，保留人工修改、收藏和其他来源。招聘公告不是一个已核验岗位，多个方向不拆成虚构职位；截断文本、资格、实际岗位ID必须去原招聘入口核对。跨源相同公司不代表同岗位，当前不自动合并跨源记录。
国聘观察JSON：`{url:"https://www.iguopin.com/job/detail?id=岗位数字ID",text:"当前可见文本",buttons:["申请职位"]}`。成功弹窗需要显式传 `successDialogVisible:true,successDialogText:"申请成功"`。只读分类返回 job-detail / confirmation / custom-template / waiting-* / already-applied / success-visible / unknown，不点击、不发短信、不生成投递回执；已申请不算本次新增。浏览器Agent负责真实填写/提交及独立证据，再通过原账本协议登记。

## 0.5.92 智联与路径分账
智联当前页读取/导入与正式typed回执见 [zhilian-campus.md](zhilian-campus.md)。interaction独立记录聊天/跳转/草稿，不记提交。新智联任务最终成功必须typed；旧unknown只保留历史口径。
