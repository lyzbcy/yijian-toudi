# Agent 交接任务书：把每日自动投递实战经验固化进「一键投递」软件

> 你将接管一个已经跑通实战的求职自动化 Electron 应用的增强开发。
> 本文档自包含你需要的全部上下文。项目根目录：`E:\共享\创业\一键投递`。
> 先通读本文档和 `doc/specs/2026-09-19-Boss一键投递与网申自动填写-design.md`（尤其 §9-§12），
> 再动手。开发规范见根目录 `agent.md` 与 `doc/` 渐进披露结构。

## 一、项目现状（你接手时已存在的能力）

**技术栈**：Electron（CommonJS，main/preload/renderer 三层）+ Node 24 + ws + playwright-core（备胎）。测试用 node:test，版本 0.5.0，schemaVersion 5。

**已固化的三大能力**（都已实测，不要重做）：
1. **Boss 批量投递引擎** `electron/boss-batch.cjs`：纯脚本无 AI 在环。城市码+查询词+三组筛选正则（TRACK/TECH/EXCL）+25-45s 频控+安全验证自停。三天实战 180+ 笔。
2. **Kimi 浏览器桥** `electron/kimi-bridge.cjs`：WebSocket 服务端 ws://127.0.0.1:10086，接管用户 Edge 里的 Kimi 扩展（月之暗面官方扩展的私有调试协议，2026-09-19 逆向）。协议：hello/hello_ack + tool_call/tool_result（requestId 配对）+ ping/pong。含 MV3 断连重试。
3. **多账号代投** v0.5.0：state.accounts[] 账号档案 + 独立 Edge 实例（--user-data-dir + --load-extension）+ 手机号探测绑定 + 首日 50 限额 + Agent API（/v1/boss/*）。操作手册已沉淀为用户级 skill `~/.agents/skills/boss-daitou/`。

**尚未固化的（= 你的任务）**：官网网申（腾讯/字节/京东/美团/小红书等校招官网的搜岗→填表→传简历→提交）目前是**临时脚本+人工驱动**，每天要 AI 手写几十次浏览器调用。你要把它产品化。

## 二、可参考的脚本与文件（全部在项目内，动手前逐个读）

| 路径 | 是什么 | 关键实现 |
|---|---|---|
| `scripts/bd-apply-full.py` | 字节校招申请表 9 步全自动管线（2026-09-21 实测打穿到滑块） | argparse 参数化、个人信息读 state.json、身份证号仅环境变量 YJTD_IDNUM |
| `scripts/cdp-app.cjs` / `cdp-app-file.cjs` | 经 CDP 9222 在 app renderer 执行 JS 的外驱入口（后者绕 Windows 32KB 命令行限制） | 所有 base64 分块推送都靠 file 版 |
| `scripts/boss-batch-monitor.cjs` | 批量进度监控（60s 轮询，落盘 Temp/boss-batch-state.json） | AI 低成本监控的样板 |
| `scripts/extract-kimi-extension.cjs` | 从日常 Edge 提取 Kimi 扩展到 app 目录（客户浏览器依赖） | 按 manifest name 匹配，不写死扩展 ID |
| `scripts/kimi-run.cjs` | 桥式收尾工具集（美团意向选择等历史工具） | — |
| `electron/playwright-bridge-adapter.cjs` | Kimi 断供备胎（同契约 navigate/snapshot/click 三方法） | 只备未切 |
| `doc/specs/2026-09-19-*.md` | 主设计文档：§9.2 桥协议、§11 官网三板斧、§12 多账号 | 最重要的参考 |
| `doc\招聘官网汇总.md` | 各公司官网 URL/API 清单（美团列表 API、岗位详情 URL 格式等） | — |
| `test/boss-account.test.cjs` | 多账号/迁移/引擎回调的测试样板 | fake bridge 注入三段式快照 |

**数据档案**：`%APPDATA%/yijian-toudi/state.json`（schemaVersion 5）——resume.basic 有姓名/手机/邮箱（身份证号绝不落盘，仅 YJTD_IDNUM 环境变量）；resumeFile 指向 resumes 目录的当前简历（2026-09-23 起为软件开发工程师版 3.4MB）。

## 三、实战经验库（四天 180+ 笔投递换来的，违反任何一条都会浪费时间）

### 3.1 桥的 24 工具与使用纪律

`navigate, find_tab, find, evaluate, network, snapshot, read_page, click, fill, mouse_click, cdp, key_type, send_keys, screenshot, scroll, save_as_pdf, upload, close_tab, list_tabs, close_session, wait, dialog, select_option, hover, drag`

- `click(selector)`：JS 合成事件（isTrusted=false）。京东 React、小红书表单接收；**字节整页 React 拒收**（点击落 DOM 但零请求）。
- `cdp(method, params)`：chrome.debugger 直发，isTrusted=true，**后台标签页唯一可靠点击**。坐标用 CSS 像素，点击前必须重读 rect。
- `mouse_click` / `send_keys`：动真实 OS 鼠标键盘，**禁用**（会误点且干扰用户）。
- `upload`：被 MV3 文件权限挡（需用户在 edge://extensions 开权限），有替代方案见 3.3。
- `network {cmd:start/list/detail}`：抓投递 API 验证是否真发出（字节"手机未验证"就是靠它定位的）。
- `screenshot()`：返回 `data.data` 嵌套 base64，后台页调试利器。
- `dialog {action:accept/dismiss}`：页面有 beforeunload 守卫时导航前必处理。

### 3.2 后台标签页三板斧（强反 bot 站点必用）

1. **焦点仿真**：`Emulation.setFocusEmulationEnabled {enabled:true}` + `Page.setWebLifecycleState {state:'active'}`。字节投递按钮对 hasFocus()=false 的后台页静默吞事件。
2. **坐标补偿**：点击前 scrollIntoView → 重读 getBoundingClientRect → 算中心 → 立即点击（虚拟列表会重排，隔一次 evaluate 坐标就漂）。埋 capture click logger 验证落点。
3. **bringToFront**：标签页被压后台后渲染层隐藏、点击落空（扩展报错 no pointerdown fired）。`Page.bringToFront` 或 Win32 恢复窗口。**症状：点击"完全无反应"时先查这个**。

### 3.3 简历/照片上传管线（京东/字节/小红书/Boss 四站验证）

扩展 upload 工具被挡时的替代链路：
1. 文件读 base64，按 130KB 分块，经 evaluate 推 `window.__b64parts`（命令行超 32KB 必须用 cdp-app-file.cjs）
2. 页内组装 `atob → Uint8Array → new File([bytes], 'x.pdf', {type})`
3. ant-design 站：找 `span.ant-upload` 的 React fiber（`__reactInternalInstance$` 键 → `.return.stateNode`）直调 `inst.uploadFiles([file])`
4. 普通站：`input.files = DataTransfer.files` + dispatchEvent('input'/'change') 即可（Boss 和小红书吃这套）
5. **`input.files+change 对京东/字节的 rc-upload 无效**，必须走 3 的实例直调

### 3.4 React 受控组件填充

insertText 会追加不清旧值。清空+重填的正确姿势：
```js
const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
setter.call(input, newValue);
input.dispatchEvent(new Event('input', { bubbles: true }));
```
（小红书日期字段、Boss 各处已验证。注意字段索引会随 DOM 动态漂移，**每次填前按 label/placeholder 重新定位，不要缓存索引**。）

### 3.5 各站坑位表（2026-09-19~24 实测）

| 站点 | 已打穿到 | 关键坑 |
|---|---|---|
| 字节 | 提交→滑块 | 职位链接用数字 ID（列表页 a[href]），显示码拼 URL 是空页；渠道问卷是多选，误选带出幽灵必填；最终拦在"手机号未验证"滑块 |
| 京东 | 保存→滑块 | 详情页 window.open('/#/details?id=')；城市选"江苏"（无无锡）；rocket-select 自家组件 |
| 小红书 | **全流程投出✅** | 登录后才能点岗位卡；详情 URL /campus/position/<id>；生日从证件号自动带出；字段索引漂移严重 |
| 美团 | 详情页+立即申请 | 列表走 POST api/official/job/getJobList（页面上下文 fetch）；详情 URL /web/position/detail?jobUnionId=<id>（从 window.open hook 挖出）；未登录时按钮点击零请求静默 |
| 腾讯 | 登录墙 | 只支持微信/QQ 社交登录（无手机验证码）；岗位卡无 a 链接 |
| Boss | 全流程✅ | 会话列表虚拟滚动；附件上传走 input.files+change；聊天点击失效先查 bringToFront |
| 阿里 | 0 岗 | 27 届常规批疑似未开放（freshman/graduate 都空） |

### 3.6 两条红线（写进代码的硬约束）

1. **滑块验证码永远交给人**。京东/字节/PDD 实测机器拖拽被轨迹检测拒绝（拟真曲线+抖动+停顿也没用）。检测到滑块 → 停止 → 企微通知账号主人。
2. **身份证号不落盘**。只从环境变量 YJTD_IDNUM 或用户当次输入读，内存用完即弃。

## 四、你要固化的功能（按优先级）

### P0：官网网申管线产品化（对标 bd-apply-full.py 的路径，但做成软件内建能力）

1. **网申任务模型**：state 增加 `siteApplications[]`（公司/岗位/URL/状态机：pending→form-filling→waiting-login→waiting-captcha→submitted/failed/timeout）。UI 在"投递购物车"页增加官网岗入口。
2. **站点适配器层** `electron/adapters/site-apply/`：每站一个适配器，实现统一接口 `searchJobs(keyword)` / `openDetail(jobId)` / `fillForm(profile)` / `uploadResume(file)` / `submit()`。字节/京东/小红书/美团/Boss 五站先行——所有路径都已在上面坑位表里验证过。
3. **表单填充引擎**：字段映射表（统一简历字段 → 各站字段），用 3.4 的 React setter + 按 label 定位（禁索引缓存）。填充结果回读校验（项目已有 field-matching.cjs 可复用）。
4. **登录墙检测与协作**：识别"登录按钮存在/点击零请求"（美团模式）→ 暂停任务 → 企微通知用户扫码/验证码 → 轮询登录态恢复 → 自动继续。腾讯走微信扫码弹窗引导。
5. **验证码守卫**：检测滑块特征（canvas/captcha 类名、"拖动滑块"文案）→ 状态机置 waiting-captcha → 企微通知 → 人滑后继续。

### P1：每日投递例程编排

一个"今日投递"面板：Boss 批量（已有）+ 官网任务队列 + 消息处理提醒，一键启动；进度和日报统一走企微（wecom-notify.cjs 已有，扩展消息类型）。

### P2：投递记录统一

siteApplications 与 state.applied、accounts[].boss.applied 合并视图；CSV 导出加官网维度。

## 五、验收标准（老田式，结果导向）

1. **结果证据**：每个站点适配器在真实站点走通至少一次 dry-run（到提交前一步）+ 一次真实提交（小红书可重复投不同岗验证）。附企微截图/状态 JSON。
2. **测试**：适配器接口契约测试（fake bridge 注入，参考 test/boss-account.test.cjs 的三段式快照法）；表单填充引擎的映射回归。
3. **文档三同步**：CHANGELOG + 设计文档新 §13 + agent.md，版本升 0.6.0。
4. **不破坏现有**：全套 node --test 不新增失败（当前基线 222/229，5 个预存环境类失败见 CHANGELOG v0.5.0 注记）。

## 六、边界（不要做）

- 不做滑块自动破解（红线）。
- 不做多账号并发（串行架构是既定决策，见设计 §12.1）。
- 不动 boss-batch 的频控参数（25-45s 是风控安全边际）。
- 不把任何凭据/身份证号写入 state.json 或日志。
- Kimi 扩展协议不可修改（扩展是别人家的），桥侧只做兼容层。
