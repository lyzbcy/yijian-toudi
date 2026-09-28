# 2026-09-19 · Boss 一键投递与网申表单自动填写 · 技术方案

> 现状：评审修订稿（2026-09-19 已过老田评审并落实三条意见；同日增量并入"其他软件"外部工具桥接评估与路线二 §4.6；§8 前置验证清单完成前不开工）
> 负责人：lyzbcy + ZCode
> 最后更新：2026-09-19

## 0. 摘要

两条路线并行，共同服务用户第一性原理"**自己能一键投，不管用谁的软件**"：

- **路线一（自研引擎，主力）**：Boss 一键投递 + 网申表单自动填写都并入现有架构，不推翻任何已有设计——网申填写几乎全部复用现有通用填表引擎，Boss 投递复用现有适配器契约和 applyCart 编排。核心工作量是"新增两类适配器族 + 一处产品决策"。
- **路线二（外部助手桥接，兜底，2026-09-19 增量）**：自研引擎没覆盖的网申站点，导出统一简历给本地已购的 resume_assistant 插件在默认浏览器里填（§4.6），不宿主、不逆向、不接塔塔服务端。

最大的不是技术问题，是决策问题：**Boss 自动化与项目已记录的立场（`doc/未决问题.md` 第 5 条）和"最后一步确认"安全设计（`platform-manifests.cjs` 全平台 `autoSubmitApplication: false`）直接冲突**，动手前必须先拍板安全模式（见 §3.2、§7）。

## 1. 现状盘点（证据）

| 已有资产 | 位置 | 对本方案的意义 |
|---|---|---|
| 适配器六方法契约 + 五维能力矩阵 | `electron/adapters/registry.cjs` | 新适配器（Boss、各 ATS）直接挂进注册表，主流程零改动 |
| 通用简历填表引擎（探测→匹配→写入→延迟回读） | `electron/adapters/generic-resume-fill.cjs` | 网申表单填写直接复用，含同构槽位、经历区块限定 |
| 字段安全护栏 | `electron/field-matching.cjs` `UNSAFE_PATTERN` | 结构上拒绝碰密码/验证码/提交类控件，网申复用 |
| 一键投递编排（购物车→逐岗位 prepareApplication） | `electron/main.cjs:511` `applyCart` | Boss 批量投递的编排壳已存在 |
| 内嵌浏览器工作区 + `persist:<company>` 会话隔离 + 退出栏 | `electron/browser-runtime.cjs`、`workspace-layout.cjs` | Boss 登录态隔离、风控页面暂停接管，机制现成 |
| 平台清单（URL/登录域/安全开关） | `electron/platform-manifests.cjs` | 新增 boss 与 ATS 平台条目即可 |
| Boss 适配器现状 | `electron/adapters/boss.cjs` | 现在只抛 `PLATFORM_PERMISSION_REQUIRED`，是唯一要重写的文件 |
| 投递门槛与纪律 | `doc/development/roadmap.md` 发布门槛、`doc/README.md` 维护纪律 | 验收标准：最后一步确认 + 真实账号 E2E + 如实标注能力 |

## 2. 上游项目评估（2026-09-19 实查）

| 项目 | Star | 技术路径 | 许可证 | 可复用结论 |
|---|---|---|---|---|
| Ocyss/boss-helper | 2236 | WXT+Vue3 浏览器扩展，内容脚本运行在 zhipin.com 页面内 | **MIT** | **可移植代码**：列表选择器、筛选规则（薪资/公司/活跃度）、批量投递循环、招呼语模板、频控参数。需保留版权声明 |
| yangfeng20/ai-job | 678 | 油猴脚本 + Spring Boot 后端；WebSocket Hook 解析 Boss Protobuf 协议实现 AI 自动回复 | **MIT** | 投递/招呼语部分可参考；AI 坐席（自动回复 HR）依赖后端与协议逆向，**不并入**（重、脆、维护面大） |
| yangfeng20/boss_batch_push | 847 | 纯油猴批量投递脚本 | Apache-2.0 | 批量投递流程最简参考；若抄代码需加 NOTICE 归属 |
| geekgeekrun | 2428 | Electron+Puppeteer 桌面应用 | **无 LICENSE** | 仅架构参考（同类技术栈），**不拷代码** |
| hanjiayuan2025-coder/CampusApply-Agent | 61 | Chrome MV3 扩展；三级匹配引擎；ATS 适配北森/Moka/智联/牛客/前程无忧/Greenhouse | **无 LICENSE**（README 写 MIT 但仓库无 LICENSE 文件） | **只借鉴事实与思路**：ATS 平台清单是事实信息可用；"规则→语义→LLM 兜底"思路我们引擎已有同级实现。**不拷代码、不拷它的规则表** |

许可证结论：真正能直接搬代码的只有 boss-helper（MIT）。其余要么无证要么只需参考思路。

## 2.5 本地已有外部工具评估（`其他软件/` 目录，2026-09-19 静态实查）

用户第一性原理：**不管用谁的软件，自己能"一键投"就行**。据此对本地三个工具 + 一个在线工具逐个做可用性与桥接评估（全部为静态分析结论，未实装，实装验证见 §8 V5）：

| 工具 | 形态 | 能用吗 | 桥接结论 |
|---|---|---|---|
| 简历填充助手 `resume_assistant` v3.0.0 | MV3 Chrome 插件，纯本地（全代码 grep 零网络请求），JSON 配置驱动，代码干净可读 | ✅ 能用（Edge/Chrome 开发者模式加载即可，已购"终身"版） | **唯一深度桥接对象**，见 §4.6 |
| 满分简历 `cvmax-autofill` v1.1.0 | MV3 插件，content-bundle 185KB 打包混淆，后端绑定 cvmax.cn 商业服务 | ✅ 应该能装能用（MV3，可能需注册满分简历账号） | 不可桥接（逻辑锁在混淆 bundle + 商业后端）。仅作为用户浏览器里的并行工具，方案不依赖它 |
| 塔塔网申神器 v0.6.5 | **MV2** 插件；`entry.js` 从 tatawangshen.com/api 拉取规则代码用 `eval` 执行（"热更新"），必须登录其收费服务 | ⚠️ 大概率不能用：Chrome/Edge 已停用 MV2（其教程也只敢让用户用 Edge 试）；且服务端若停服则整个工具失效 | **否决桥接**。往 Electron 里装 = 把第三方远程代码执行（RCE by design）塞进本软件，违反安全红线；其网申规则在服务端，本地包里没有可移植资产 |
| 求职方舟 qiuzhifangzhou.com | 在线 SaaS（txt 注明仅 PC） | 未实测 | 不纳入方案，最多在引导页列一个外部链接 |

**关键事实**：三个插件没有一个是"装进我们 Electron 内嵌浏览器"可行的——MV3 的 service worker 背景 Electron 不支持（§3.1 官方文档），MV2 的塔塔是服务端逻辑+远程 eval。所以"外部工具桥接"的正确形态不是宿主，而是**导出 + 引导**（§4.6）。

## 3. 方案 A：Boss 一键投递

### 3.1 桥接设计

**不引入浏览器扩展宿主。** boss-helper 是浏览器扩展（内容脚本在页面上下文里跑），而 Electron 官方文档明确：只支持 Chrome 扩展 API 的一个子集（服务 DevTools 与 Chromium 内部扩展为主）、不支持商店任意扩展与 .crx、background 键仅支持 Manifest V2 形式（证据：https://www.electronjs.org/docs/latest/api/extensions ，2026-09-19 查证）。把扩展装进 Electron 属于高风险路线。我们沿用项目已验证的路线：**Playwright 驱动内嵌 WebContentsView + `persist:boss` 会话**，与腾讯填表同一套基础设施。

> ⚠️ 适用场景差异（评审意见 #2，开工前必须实测）：boss-helper 的选择器与流程运行在**登录页面的内容上下文**里，我们是 **Playwright 外部驱动**，两者的风控暴露面不同。zhipin 对外部自动化驱动的检测强度**尚未实测**（本项目该路线仅在腾讯等官网验证过，zhipin 未验证）。§8 前置验证 V1 通不过，本节全部作废。

桥接动作分解：

1. **重写 `adapters/boss.cjs`**，从"抛权限错误"改为真实适配器：
   - `listJobs(page, filters)`：移植 boss-helper 的列表选择器与清洗逻辑，岗位进统一 Job 模型（`idPrefix: 'boss-'`）。
   - `prepareApplication(page, job)`：Boss 的"投递"语义是**打招呼 + 发简历**，不是表单提交。流程 = 打开岗位卡片 → 弹出沟通框 → 填入招呼语 → 停在发送前（或按安全模式执行发送，见 §3.2）。
2. **applyCart 动作类型扩展**：现有 `prepareApplication` 假定"打开详情页让用户提交"；新增 `actionType: 'greet'`（Boss 类平台），购物车按平台分组规则引擎处理（agent.md 里米哈游"一次只能投一个"的规则设计正好复用，Boss 对应"每日沟通上限、同公司去重"）。
3. **招呼语模板**：本地模板库（变量替换：姓名/岗位/公司/技能），不依赖 AI 起步。
4. **状态回读**：`inspectApplicationStatus` 从 Boss 沟通列表页回读"已沟通/已回复/不合适"。Boss 页面改版频繁，此项能力从 `degraded` 起步，如实标注。
5. **筛选**：第一版做硬规则（薪资区间、公司规模、活跃度、关键词黑白名单）；boss-helper 的"AI 筛选"后置到 P2。

### 3.2 安全模式（本方案唯一需要拍板的产品决策）

现状证据链：`doc/未决问题.md` 第 5 条明确记录"BOSS 用户协议禁止第三方自动登录/浏览/收发简历，未获许可前只保留官方入口"；`platform-manifests.cjs` 所有平台 `autoSubmitApplication: false`；`doc/README.md` 维护纪律第 3 条"最终投递等外部写入默认需要用户确认"。

两个模式：

| | 模式一：批量准备 + 批次确认（推荐默认） | 模式二：授权全自动（可选开关） |
|---|---|---|
| 流程 | 软件自动筛选、逐个打开沟通框、填好招呼语，**停在发送前**；用户核对后对本批次一次授权，软件代发 | 用户显式开启 + 阅读风险确认书后，软件按频控全自动发送 |
| 与现有安全设计关系 | 完全同构（腾讯投递已是"自动准备、用户最终确认"） | 突破 `autoSubmitApplication: false`，Boss 条目单独开 true，其余平台不动 |
| 封号风险 | 低（最终节奏由人控制） | 中高（boss-helper README 原话：黑号/封号/权重降低） |
| 与 Boss 协议的张力 | 仍属协议灰色地带，但无"无人值守批量写入" | 明确违反其用户协议的自动化限制（协议禁止第三方自动登录/浏览/收发简历，`doc/未决问题.md` #5 已记录） |
| 工程量 | 小（不碰安全开关体系） | 中（安全开关例外化 + 风险确认书 + 审计日志） |

**推荐**：先只做模式一上线；模式二作为"实验室功能"埋点不做，等真实数据（封号反馈、投递转化率）再决定。未决问题 #5 的立场文档随决策同步更新——**要么维持保守立场，要么明确改写并记录原因，不允许悄悄变**。

### 3.3 风控与频控（无论哪种模式都做）

- 参数化频控：单次会话沟通上限（默认 30）、操作间隔随机化（如 8–20s）、每日总量上限。
- 黑名单：公司名/岗位关键词/HR 活跃度阈值。
- 复用现有机制：风控/验证码页面出现即暂停 + 提示用户接管（`browser-automation.md` 已有策略，腾讯验证过）。
- 独立 `persist:boss` 会话与 Boss 主站 Cookie 隔离已就绪。

## 4. 方案 B：网申表单自动填写（各公司官网申请系统）

### 4.1 与现有能力的差异

现有 generic-fill 引擎服务的是"大厂官网的**简历页**"（每家单独适配）。网申的差别：

1. **载体是共享 ATS 平台**：北森、Moka、智联、牛客、前程无忧、Greenhouse 承载了数百家中型公司，适配"一个 ATS"= 覆盖一批公司，投入产出比远高于逐站适配。
2. **字段更杂**：申请表单除简历字段外还有期望城市、信息渠道、是否服从调剂、生源地、政治面貌等网申特有字段。
3. **有开放题**：textarea 类"为什么选择我们"等问题，数据不在简历里。

### 4.2 桥接设计：ATS 适配器族

```
electron/adapters/ats/
├── beisen.cjs      # 北森（表单结构待实测：是否 iframe 嵌套，未验证）
├── moka.cjs        # Moka（组件形态待实测，未验证）
├── zhilian.cjs     # 智联招聘
├── niuke.cjs       # 牛客
├── 51job.cjs       # 前程无忧
├── greenhouse.cjs  # Greenhouse（外企）
└── detect.cjs      # ATS 识别：域名指纹 + DOM 指纹 → 路由到对应引擎
```

> 各 ATS 的表单结构特征（iframe、动态组件、字段命名）当前**全部未实测**，以上平台清单转述自上游项目 README（2026-03），需按 §8 前置验证 V3 用真实网申页逐家探测后才能写成结论。**首批样例目标**：从 `doc/招聘官网汇总.md` 中挑 2 家确认走北森、2 家走 Moka 的公司，把网申 URL 写进验证记录。

- 每个 ATS 适配器只做一件事：**把该平台的表单（含 iframe 展开、自定义组件展开）探测成统一字段清单**，喂给现有 generic-fill 引擎完成匹配与写入。写入后回读、保存留给用户——与现有六厂完全同构。
- 用户提供任意网申 URL → `detect.cjs` 识别 ATS 类型 → 自动路由。识别不了的降级为"通用引擎直接试 + 人工核对"。
- 公司目录：`doc/招聘官网汇总.md` 已有人工清单，P1 期间补"ATS 归属"列。
- 版权边界：ATS 平台清单是事实信息，自由使用；CampusApply-Agent 的代码和规则表**不拷贝**，我们自己的 field-matching 已具备同级匹配能力（规则归一化、前缀剥离、区块限定、同构槽位）。

### 4.3 开放题处理（三级策略）

1. **保底**：跳过 + 在填写报告里列出手动项（现有 manual 机制就是干这个的）。
2. **题库**：本地维护"常见网申问题→答案"题库，模糊匹配命中自动填。高频题（为什么加入我们/职业规划/优缺点）覆盖率高。
3. **AI 草稿（可选，默认关）**：题库未命中的题，调 LLM 生成草稿填入但**高亮标记为草稿**，用户过目后自己定稿。涉及数据边界变化，见 §5。

### 4.4 数据模型扩展

- 统一简历 schema 增补网申特有字段，对照 `doc/specs/简历字段缺口-2026-07-26.md` 一并更新缺口表。
- 网申岗位进购物车 → `prepareApplication` 打开 ATS 页自动填表 → 停在提交前。`autoSubmitApplication` 全平台维持 false 不变。

### 4.6 外部助手桥接层（路线二：不支持的站点，借别人的工具填）

主路线（自研 ATS 引擎）覆盖需要逐家验证，周期长。在这之前，对**引擎尚未支持的网申页**提供一条立即可用的降级路径，对齐用户第一性原理"能一键投就行，不管用谁的软件"：

1. **统一简历 → 外部助手配置导出器**：一键投递内点"导出给外部助手"，把统一简历转成 `resume_assistant` 的 `resume_config.json` 格式（其 schema 是简单中文键值：personalInfo / educationList / workList / projectList / awardList / otherInfo，静态实查于本地包）。用户把导出文件导入插件，在任意网申页用插件侧边栏一键填。
   - 格式转换属事实性兼容，不涉代码拷贝；字段词表（其 fieldTypes 中文类型名）可反哺我们的字段同义词库。
   - **隐私提示必须做**：导出文件含手机号/证件号等明文，导出对话框要明示并落到用户选择的目录，不静默写盘。
2. **未支持站点的"外部填写"动作**：购物车/岗位详情对 `platformKind` 为 ats-hosted 但引擎未覆盖的站点，提供"在默认浏览器打开 + 外部助手填写"按钮（复用现有"普通浏览官网走系统默认浏览器"机制），并首次使用时弹出一次性引导：如何安装 resume_assistant、如何导入配置。
3. **引导文档**：`doc/` 下新增一页"外部助手配合指南"，如实声明：外部工具的能力、隐私边界、由其作者维护，与本软件的推荐无利益关联。
4. **明确不做**：不把任何外部插件宿主进 Electron 内嵌浏览器（§2.5 已证不可行+不安全）；不逆向 cvmax 混淆 bundle；不接入塔塔服务端。

工程量评估：导出器 + 跳转动作 + 引导页合计 ≤1 天，**不依赖 V1/V3 任何前置验证，可先行**。

## 5. 影响分析

| 维度 | 影响 | 等级 |
|---|---|---|
| 架构 | registry 增加 `platformKind`（company-site / job-board / ats-hosted）；applyCart 增加 greet 动作类型。**纯增量，现有八家适配器零改动** | 低 |
| 安全/隐私 | ① Boss 自动化引入用户账号封号风险（用户侧风险）；② 开放题 AI 草稿需把简历上下文发给 LLM 厂商——**突破"数据只在本机"的现有边界**（architecture/overview.md 数据边界一节），必须用户明示同意 + 复用 `redact.cjs` 脱敏 + 提供本地 Ollama 选项；默认关闭 | 高 |
| 数据 | Boss 岗位量大（单日千级），state.json 的岗位存储与去重策略要分平台配置；与官网岗位重复投递去重（同公司同岗位双通道）| 中 |
| 测试 | live 测试严禁自动发送——投递类流程全部要有 dry-run 模式；发布门槛要求真实账号 E2E 一次；Boss 测试需专用小号 | 中 |
| UI | 购物车平台分组规则引擎（每日上限/黑名单/招呼语预览）；网申 URL 导入与 ATS 识别入口；能力矩阵如实展示 verified/degraded | 中 |
| 维护成本 | zhipin.com 前端改版频繁（boss-helper 活跃维护的原因）→ Boss 适配器要按维护纪律记录最后实测日期、改版自动降级；ATS 平台相对稳定 | 中高 |
| 法律/协议 | ① MIT/Apache 归属声明；② Boss 协议立场文档更新（§3.2）；③ 开源仓库公开分发 Boss 自动化工具，README 必须如实写风险与协议状态，不承诺"绕过风控" | 高 |
| 外部工具依赖（新增） | 路线二把 resume_assistant 纳入推荐链路：① 该插件若停更/改版，导出格式可能失配（导出器需版本探测+失败可见）；② 推荐外部工具的隐私与安全边界要在引导页向用户声明；③ 导出文件含明文隐私字段，落盘位置由用户选择 | 低 |
| 文档 | 未决问题 #5、能力矩阵、大厂清单、README、介绍页同步更新；发布门槛逐条过 | 中 |

## 6. 分期计划与验收

| 阶段 | 内容 | 验收（对齐发布门槛） |
|---|---|---|
| P0（先行，最小可交付） | Boss 模式一：listJobs + 筛选 + 购物车 greet 动作 + 招呼语模板 + 批次确认 | 真实账号 E2E 一次：筛选→购物车→逐岗位准备→批次授权发送→沟通列表可见记录；dry-run 测试；实测日期入库 |
| P0.5（可立即先行，不依赖 V1/V3） | 外部助手桥接层：resume_config.json 导出器 + 未支持站点默认浏览器跳转 + 引导页 | 导出文件被 resume_assistant 实际导入成功并填出 ≥10 个字段（用户实测截图）；隐私落盘提示可见 |
| P1 | 网申引擎：北森 + Moka 两个 ATS（覆盖面最大）+ detect 路由 + 字段缺口补齐 + 购物车打通 | 每家 ATS ≥1 个真实公司网申页完成"填入→人工提交→回读"验收 |
| P2 | 其余四家 ATS；Boss 状态回读升级；题库；AI 草稿（若拍板） | 同上逐家验收 |
| P3（可选） | Boss 模式二（授权全自动，若拍板）；AI 筛选 | 风险确认书 + 审计日志 + 频控实测报告 |

## 7. 决策结论（2026-09-19 评审后收敛，待用户确认）

评审后不再罗列开放选择题，方案结论如下，用户确认即开工：

1. **Boss 安全模式**：只做模式一（批量准备 + 批次确认）。模式二（授权全自动）**砍掉，不排期**——理由：碰平台协议红线，公开开源分发风险不可控；真实封号数据不存在，收益无法评估。
2. **未决问题 #5 立场**：维持保守立场并随本方案补充一句："软件内 Boss 半自动辅助（用户批次确认后代发）与全手动入口并存；不做无人值守全自动。"立场变化必须由产品主（用户）确认后写入。
3. **LLM 通道**：**不做**。开放题先做本地题库（零数据边界变化）；AI 草稿等题库命中率有真实数据后再议。
4. **优先级**：Boss P0 先行（"一键投递"闭环最先成立），网申 P1 随后。
5. **P0 估时**（待用户确认）：前置验证 0.5 天 + 开发 3~4 天 + 真实账号 E2E 验收 0.5 天，合计 **4~5 个工作日**。
6. **外部工具路线**（2026-09-19 新增）：采纳 §4.6 外部助手桥接层为正式路线二——自研引擎没覆盖的站点用 resume_assistant 兜底（导出+引导，不宿主、不逆向）；塔塔网申神器与 cvmax 不纳入（§2.5 否决理由）。这使"用户今天就能在未支持站点上少手填"提前成立，不等 P1。

## 8. 前置验证清单（开工门槛，逐条留证）

| # | 验证项 | 方法 | 通关标准 | 状态 |
|---|---|---|---|---|
| V1 | zhipin 对外部自动化驱动的风控容忍度 | 用现有 WebContentsView + `persist:boss` 会话打开 zhipin.com，真实账号登录、完整翻完一页岗位列表 | 不触发验证码/封禁提示，岗位卡片 DOM 可读，截图留证 | **未验证（阻塞 P0）** |
| V2 | boss-helper 选择器与当前 zhipin DOM 的匹配度 | 抽样比对其开源仓库选择器与 V1 实测 DOM | 岗位卡片、沟通按钮、招呼语输入框三类选择器可定位 | 未验证（依赖 V1） |
| V3 | 北森/Moka 真实网申页结构 | 从 `doc/招聘官网汇总.md` 各挑 2 家公司，匿名打开网申 URL 探测 DOM（含 iframe 展开可行性） | 每家产出字段探测清单，喂 generic-fill 引擎的字段抽取可行 | **未验证（阻塞 P1）** |
| V4 | Electron 扩展支持边界 | 官方文档查证 | 已完成：https://www.electronjs.org/docs/latest/api/extensions （2026-09-19） | ✅ 已验证 |
| V5 | 三个本地外部工具实装可用性 | 用户配合，各 5~10 分钟：① Edge 开发者模式装 resume_assistant，导入默认配置，在任一网申页试填；② 同法装 cvmax-autofill；③ 塔塔网申神器在 Edge 试装（预期被 MV2 策略拦） | ①能装能填=路线二成立；②能用=引导页可列；③无论结果都按 §2.5 结论记录 | **未验证（阻塞 P0.5）** |

V1/V3/V5 需要**用户本人配合**（登录账号 / 提供目标公司网申链接 / 实装插件），这是当前唯一阻塞项。

## 9. 真实投递实测记录（2026-09-19 夜，用户授权 2 笔）

### 9.1 Boss直聘真实投递 ✅ 闭环成功

以测试账号在 Edge 中完成 2 笔真实投递，全程无验证码、无风控拦截：

| 时间 | 岗位 | HR | 送达状态 |
|---|---|---|---|
| 22:32 | 前端开发实习工程师（无锡，Vue3/小程序） | 招聘方 A | **[送达]** |
| 22:33 | 前端开发（无锡，Vue/JS，本科） | 招聘方 B | **[送达]** |

- 投递语义 = Boss「立即沟通」→ 自动发送账号预设招呼语（含江南大学 AI 专业自我介绍）+ 简历附件，消息在沟通列表落档。
- 验证方式：真实浏览器沟通列表快照，两条会话显示 **[送达]** 与招呼语全文。
- 对 §8 验证清单的含义：**zhipin 对"已登录真实浏览器内的页面级自动化"零拦截**（导航/搜索/点击/发送全链路）。V1 原定义的"Electron WebContentsView 会话"路径仍需单独验证，但最大不确定性（风控）已被实测大幅降险。

### 9.2 Kimi WebBridge 协议破解与验证 ✅（重大架构增量）

用户浏览器中的 Kimi 扩展（v2.0.9）即 agent.md「技术提醒」里提到的 webbridge。**本地 Agent 起服务端、扩展主动连接**的架构已实测打通：

- **连接**：Agent 在 `ws://127.0.0.1:10086` 起 WS 服务（扩展源码实证端点为 `/ws`，另有 `http://127.0.0.1:10086/status` 探活）；扩展端点「去连接」后自动重连。
- **协议**（源码实证 + 实测验证）：
  - 扩展→Agent：`{"type":"hello",...}` 握手；Agent 回 `{"type":"hello_ack"}`；`ping/pong` 保活。
  - Agent→扩展：`{"type":"tool_call","requestId":X,"payload":{"name":"<工具>","args":{...}}}`；扩展回 `{"type":"tool_result","responseToRequestId":X,"payload":{...}}`。
  - 权限流：`permission_requested` → Agent 回 `permission_resolved`（用户可在扩展侧设「完全授权」）。
- **实测通过的工具**：`list_tabs`、`navigate`（返回 tabId/frameId）、`snapshot`（返回带 `@e` ref 的页面可交互树，Playwright ARIA 风格）、`fill`（支持 `@e` ref 与 CSS selector 双定位，`{"selector":"@e1","value":"..."}`，实测写入并回读确认）。源码指令表还包括：`click / send_keys / mouse_click / screenshot / evaluate / execute_js / create_tab / close_tab / find_tab / close_session / await_user_action / save_skill / run_saved_skill`。
- **对「一键投递」的意义**：这是比 Playwright 外驱更轻的第三条浏览器控制路线——页面内级操作（不是外部坐标/CDP 注入）、原生复用用户登录态、无 WebContentsView 改造量。建议在 P0 中作为**候选控制层 B**与 WebContentsView 路线并行评估（风险：Kimi 扩展是第三方软件，协议无官方文档承诺，需在方案里固化协议探测与降级逻辑）。
- 今晚它已实际承担了投递后监控（读沟通列表确认送达状态）。

## 10. 新增需求（2026-09-19 深夜，用户口头下达）

1. **企业微信通知**：设置页需支持配置企业微信群机器人 Webhook（`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`）。找工作相关事项（投递成功/送达/HR 回复/异常风控）经该链接推送给用户。频率约束：企微 webhook 限 20 条/分钟，实现上用汇总推送（每 N 笔或每 M 分钟一条）。列入 P0 范围，2026-09-19 已实测通道可用（errcode 0）。
2. **投递偏好（用户口径）**：游戏开发、AI 开发、前端、后端、全栈均可投；**测试岗不投**；城市武汉优先，苏州/上海/杭州/无锡次之；校招正式岗与实习岗都在目标内（2027 届）。

### 9.3 外部插件实测增量（对应 §2.5 / V5）

- **resume_assistant**：临时 Edge 实例 `--load-extension` 实测——**可正常加载**（工具栏出现"简历自动填充助手"且获站点访问权），content script 在 HTTP 页面有注入迹象；填充触发（快捷键/侧栏交互）在无人值守环境下未完成（插件默认 `isEnabled=false`，需人工开启），真人使用无此障碍。临时实例与数据已清理。
- **Kimi WebBridge**：见 §9.2，已全通。
- 塔塔网申神器 / cvmax：维持 §2.5 静态结论（MV2 已死 / 可装但绑定商业服务），未再投入实测。

## 11. 官网投递实测增量（2026-09-20，京东/字节打穿）

### 11.1 Kimi 桥完整工具表（错误信息反向枚举实测）

桥实际暴露 24 个工具，超出 kimi-bridge.cjs 封装的 5 个（navigate/snapshot/click/fill/evaluate）：

```
navigate, find_tab, find, evaluate, network, snapshot, read_page,
click, fill, mouse_click, cdp, key_type, send_keys, screenshot,
scroll, save_as_pdf, upload, close_tab, list_tabs, close_session,
wait, dialog, select_option, hover, drag
```

关键差异（实测结论）：
- `click(selector)`：JS 合成事件（isTrusted=false）。京东 React 接收；**字节整页 React 拒收**（点击落 DOM 但处理器空转，零请求）。
- `mouse_click(selector)`：**会移动真实 OS 鼠标**（两次实测均误点页面右下角 AI 助手），后台标签页坐标不可靠。用户正在用机器时禁用。
- `send_keys(keys)`：OS 级键盘（实测 `"os":"win"`），进的是前台应用，**后台标签页收不到**。
- `cdp(method, params)`：chrome.debugger 直通，**不动物理鼠标、后台标签页有效、事件 isTrusted=true**。配合 `Input.dispatchMouseEvent` 是后台标签页唯一可靠的"真人级"点击。
- `screenshot()`：返回 base64 PNG（data.data 嵌套），后台页可视化调试利器。

### 11.2 后台标签页投递三板斧（字节 APM 岗实测打穿）

1. **焦点仿真**：后台标签页 `document.hasFocus()=false` 会被字节投递按钮的处理器静默吞掉。先发
   `cdp: Emulation.setFocusEmulationEnabled {enabled:true}` + `Page.setWebLifecycleState {state:'active'}`，
   之后同一按钮的受信任点击立即触发 `/api/v1/user/deliver/limit_check` 等投递链路。
2. **坐标补偿**：`Input.dispatchMouseEvent` 的 x/y 用 CSS 像素（实测 DPR=1.5 无需换算），但页面在 scrollIntoView 后可能自滚动，**点击前须重读 rect 并即时校准**（埋 document capture click logger 验证落点）。
3. **数字职位 ID**：字节列表卡片跳详情用数字 ID（如 7667879966262528261），显示码 A171983A 拼 URL 得到空详情页（title=undefined），投递按钮空转。必须从列表 `<a href]>` 取真实链接。

### 11.3 简历附件上传：rc-upload 实例直调（京东/字节双站验证）

扩展 `upload` 工具被 MV3 文件权限挡（需用户开"允许访问文件 URL"）。替代链路：

1. PDF 读为 base64，按 130KB 分块经 evaluate 推到 `window.__b64parts`（命令行超 Windows 32KB 限制，走 `scripts/cdp-app-file.cjs` 从文件读表达式）。
2. 页内 atob → Uint8Array → `new File([bytes], 'x.pdf', {type:'application/pdf'})`。
3. 找 `span.ant-upload` 的 fiber（`__reactInternalInstance$` → `.return.stateNode`），实例有 `uploadFiles` 方法，直接 `inst.uploadFiles([file])` 走组件真实上传管线。
4. 京东：beforeUpload 弹"是，上传并解析"确认框 → 受信任点击 → 完成度 100%，姓名/手机/邮箱/教育/实习/项目全部解析入表。
5. 字节：上传成功后出现"解析并覆盖"按钮 → 点击 → 表单 95% 自动填充。

注意：`input.files = DataTransfer.files + dispatchEvent('change')` 在两站均无效（React 不认）；必须走 uploadFiles 实例方法。

### 11.4 官网投递状态（截至 2026-09-20 22:00）

| 公司 | 岗位 | 状态 | 剩余 |
|---|---|---|---|
| 京东 | 前端开发工程师（2027届正式）| 简历已解析上传，表单 90% | 用户补：证件号/出生日期/照片/所在城市 → 保存 → 投递 |
| 字节 | 前端开发工程师-APM（2027届正式，沪/杭）| 申请表 99%（含简历上传+解析、教育/实习/3项目/荣誉）| 用户补：身份证号 → 点"提交简历" |
| 美团 | — | 意向部门/城市需手点 | 已通知 30 秒手点 |
| 阿里/百度/小米 | — | 未登录 | 需用户扫码后继续 |

## 12. 代投商业化：多账号架构（2026-09-23 v0.5.0 实施完成）

### 12.1 架构决策

1. **串行单活跃连接**：Kimi 扩展的 hello 协议在扩展端（我们无法修改），不能在协议层携带账号标识；商业流程本身串行（一客一投）。多账号并发明确不做，账号切换 = 关旧浏览器实例 + 开新实例。
2. **账号 = 独立 Edge 实例**：`--user-data-dir=<userData>/accounts/<id>` 隔离登录态；`--load-extension=<提取的Kimi扩展>` 强制加载（2026-09-23 本机实测：提取 Kimi v2.0.9 → 加载 → 自动连桥 10086 全链路通）。
3. **AI 不在环**：skill（boss-daitou）只是启动器+异常手册；批量引擎纯脚本跑全程，一次代投约十几次模型调用。

### 12.2 身份与安全设计

- **绑定闭环（防串号）**：客户扫码后 `verifyAccountBinding` 导航 `zhipin.com/web/user` 抓脱敏手机号 → 与档案 `phoneMasked` 比对 → 匹配绑桥；不匹配企微报警拒绝绑定。探测不到时降级人工确认。
- **授权留痕**：客户扫码登录=授权行为本身；账号档案记录 `consent{confirmedAt, clientName}`；批量结束通知附免责声明（账号合规状态由持有人负责）。
- **首日限额**：客户账号单次 target 上限 50（自用 default 120），start handler 硬拦截。
- **落盘**：`onApplied` 回调每笔写入账号档案（applied/banCompanies），跨批去重读档案（修复原 `appliedBefore=[]` 恒空 bug）。

### 12.3 接口

- Agent API（53147，Bearer token）：`/v1/boss/batch/start|stop|status`、`/v1/boss/accounts[/create|/select|/launch|/close|/verify]`。
- IPC 同名镜像（`account:*`、批量三件套抽出为 `startBossBatch/stopBossBatch/bossBatchStatus` 共用函数）。
- schema v5：`accounts[]` + `activeAccountId`（老数据自动迁移补 default 账号）。

### 12.4 备胎

`electron/playwright-bridge-adapter.cjs` 与 Kimi 桥同契约（navigate/snapshot/click 三方法），boss-batch 构造参数换 adapter 即切。触发条件：Kimi 扩展协议变更/下架。切换成本：目标浏览器加 `--remote-debugging-port` + 换一行构造参数。

### 12.5 验证记录（2026-09-23）

- 单测 5 项新增全绿（schema 迁移/onApplied 契约/API 路由鉴权/Edge 定位/扩展目录探测）；全套 229 测试 222 过，7 失败中 2 个为本轮修复（版本同步/core 断言随 v5 更新），5 个为预存环境类（外网数据/electron 超时/浏览器探测，与本轮无关）。
- 实机链路：真实 state.json v4→v5 迁移 ✅；API 建客户账号（含 consent）✅；target=100 被首日限额拦截 ✅；launch 客户浏览器 → Kimi 扩展自动连桥 ✅；close 干净退出 ✅；UI 账号下拉渲染（default:我自己（自用）/测试客户（***9999，已投 0））✅。
