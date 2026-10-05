# 2026-09-28 发布就绪度实测

> 现状：0.5.0 Windows x64 测试预发布已发布 ｜ 负责人：维护者 ｜ 最后更新：2026-09-28

## 已验证

- Windows/Node 24.14.0、pnpm 10.12.1：`pnpm test:background` 基线通过，单测、静态检查和 8 组界面/同步回归全绿。
- `pnpm test:live-jobs` 匿名只读实测全绿：腾讯 1431、百度 12、字节 605、小米 229、京东 1121、美团 1213 个岗位；结果在 `test-output/live-jobs-full.json`。这是匿名读取，不是账号写入验收。
- `pnpm test:site` 在 Edge + 本地预览服务（4300 端口）通过：桌面/移动端图片均完整，移动端横向溢出 0px。默认 4173 端口处于本机 Windows 保留端口段，故改用 4300。
- 介绍页原下载按钮曾指向不存在的 0.2.0 中文 ZIP；已改为最近公开 Release 页面，`PAGE_V` 与 `site/version.json` 同步到 7，修改后站点测试再次通过。
- Skill 日程触发器单测覆盖时区、dryRun、当日防重、账号限额、版本不一致、回环 API；本机 AgentServer 实 HTTP dryRun 集成通过。`pnpm pack:skill` 成功，SHA256 与包体一致，`quick_validate.py` 通过。
- `pnpm dist:win` 在 Windows x64 上成功构建 NSIS；补齐 `build/icon.ico` 后不依赖远端图标包，产物名与 `latest.yml` 的 URL 均为 `yijian-toudi-setup-0.5.0.exe`。
- 最终安装包在工作区隔离目录静默安装 exit 0，已安装 exe 的 UI、119 个简历字段、Boss 默认账号、Agent API v0.5.0 与未授权 401 检查通过；静默卸载 exit 0，目录清除。安装包 SHA256：`6b6f02ee8cfd67f5d142c6044cc1b432bf8437e3c64fd8ee0c92296c4113610b`。
- 回归复跑 `pnpm test:background` 全 10 组通过；候选提交仅选择应用、Skill、文档与测试文件，未把辅助资料、第三方目录和本机验证文件整体加入。
- 可见 Windows 包截图暴露了更新检查误把 0.3.1 当作 0.5.0 的新版本；已修成语义版本比较与按平台挑选安装资产，新增 3 组回归测试。修复后已重新构建并再次完成安装、启动、API 与卸载闭环。

## 尚未覆盖的验收

1. 当前执行环境是 Windows；`pnpm pack:mac` 实跑返回 exit 1：`Build for macOS is supported only on macOS`。0.5.0 的 macOS DMG/ZIP 未验收，Windows 测试版不宣称覆盖 macOS。
2. 未使用真实已登录账号验证 Boss dryRun 的筛选结果、100 份正式投递或安全验证停止。自动日程未启用；Skill 在云端的 SSH 隧道也未实机连通。
3. 客户独立浏览器需要预先提取 Kimi 扩展；当前安装包没有内建「准备扩展」按钮，客户账号链路仍是实验特性。默认自用账号路径不依赖这个步骤。
4. 介绍页仍标 v0.3.1，与最近公开稳定 Release 对应；0.5.0 Windows 测试预发布不替换 macOS 最新稳定版入口。

**判定：Windows x64 安装与核心 API 满足测试预发布门槛，[v0.5.0 pre-release](https://github.com/lyzbcy/yijian-toudi/releases/tag/v0.5.0) 已发布。** Release 附 Windows 安装包、校验文件与同版本 Skill；GitHub 的 Skill 附包与 Pages 工作流均成功。它不是跨平台稳定版；真实账号 Boss dryRun/正式投递、macOS 安装和云端隧道仍需各自实测。

## 2026-09-28 Windows 真实账号预检与 v0.5.1 候选

- 从 v0.5.0 Windows 打包程序启动：Agent API `/v1/status` 返回 `version=0.5.0`、`mode=live`，Kimi 桥 `connected=true`，默认账号已选中，批量状态空闲。
- 浏览器首次导航到 Boss 武汉实习搜索后，最终地址落在 `/web/geek/jobs?...&_security_check=...`，标题为「武汉招聘」，页面有“登录/注册”而没有匹配的岗位链接；因此首次运行没有发起真实投递。
- 默认账号绑定预检 `/v1/boss/accounts/verify` 返回 `Cannot read properties of undefined (reading 'replace')`，由无手机号匹配时访问 `m[0]` 导致。v0.5.1 候选修复了此错误和批量引擎的未登录城市页漏判；新增反例测试先红后绿。
- 随后 Edge 可见页面确认账号已登录，页面仍使用 `/web/geek/jobs` 和「武汉招聘」标题且页脚含“热门城市”。第一版修复过宽，v0.5.1 打包程序目标 1 的运行被误报 `login-required`，`applied=0`；第二版仍在页面加载中零链接时误报。现在只将明确登录提示视为掉线，分别加入已登录 SEO 页与加载中零链接的反例测试，均通过。
- 第三版 v0.5.1 Windows 打包程序运行默认批量 `target=1`：脚本走完搜索计划，日志 `boss-batch done applied=0 fails=2 stop=completed`；Agent API 却仍返回 `running=true`、`stopReason=null`。源代码已补正常完成状态终结和回归断言，待最终包复核。浏览器搜索多次回到旧查询，批量路径尚未观察到成功发送。
- 同一 Windows 应用的 Kimi 桥独立导航到“前端开发实习”后，人工核对岗位详情，再点击“立即沟通”；岗位页出现“已向BOSS发送消息”，Boss 沟通列表新增该公司会话并显示 `14:34 [送达]`。这是一笔**真实发送**，但不是默认批量引擎的成功，不能计作批量 `applied=1`。已把该笔经页面证实的记录写入默认账号档案并加入公司去重列表，防止后续重复投递；原账号状态另存本机临时备份，恢复演练在副本上通过。
- **当前判定：v0.5.1 仍是修复候选，不发布新 Release，也不启用每日 100 份日程。** Windows 应用桥可真实发送一笔；默认批量从搜索到落盘的端到端路径未通过。必须先解决搜索页旧查询/快照不稳定，并让批量自身产出 `applied=1`、持久记录和终结状态，才改判为可发布。
- 候选包收尾验证：`pnpm test:background` 10/10 组通过（unit 224/224）；`pnpm test:site` 在 Edge + 4300 端口通过，坏图 0、移动端溢出 0；`pnpm dist:win` 生成 `release/yijian-toudi-setup-0.5.1.exe`，SHA256 `a9de78aa4200f5f1178f039a0a7ea63d3ed1e19cdc47883111d1e47463f6132a`，`latest.yml` 的版本、URL 与 SHA512 匹配。独立目录静默安装 exit 0，已安装程序 UI/119 字段/API v0.5.1 smoke exit 0，静默卸载 exit 0 且目录移除。`pnpm pack:skill` 与 UTF-8 模式 `quick_validate.py` 通过；这些构建产物均只在本机，没有发布 v0.5.1。
- 最终打包程序重启后，Agent API 返回默认账号累计已投 1、批量空闲；Kimi 桥在后台测试结束后重启并重新连接。该 1 笔来自手工核实的应用桥发送，不能冒充默认批量引擎的成功。

## 2026-09-28 批量发布门槛修复与 Windows 复验

- 新增先红后绿的批量回归：结构化列表绑定公司、规范 `/web/geek/jobs` 搜索地址、旧查询快照重导航、已投公司点击前跳过、dryRun 目标数终止、发送无回执停止、落盘失败停止，以及 Kimi `newTab` 参数透传。定向测试 19/19、完整单测 230/230、`pnpm test:background` 10/10 组、`pnpm check` 均通过。
- 最新 Windows NSIS 安装包重新构建成功：`release/yijian-toudi-setup-0.5.1.exe`，104127454 bytes，SHA256 `521d24acc447a7ff2bd848cede145b05e10fe17756cdab8704cf6472462847e6`。隔离目录静默安装 exit 0、已安装程序 UI/API smoke exit 0（119 字段、API 0.5.1、默认账号）、静默卸载 exit 0 且目标目录清除。`pnpm test:site` 通过（坏图 0、移动端溢出 0），同版本 Skill 包生成且验证通过。
- 最新打包程序已启动，Agent API 返回 `version=0.5.1`、`mode=live`、批量 `running=false`，默认账号累计已投仍为 1（上一节人工核实记录）。Kimi 桥已重新连接。当前 Boss 快照仍显示“登录/注册”，无“简历 new”；尚未运行新版批量的真实 dryRun/正式投递。用户登录后先跑 `target=1` dryRun 核对 `previewed=1, applied=0`，再跑正式 `target=1` 并核对 Boss 送达、批量 `applied=1`、账号累计已投 2、`running=false`。这些观察发生前，v0.5.1 仍不发布。

### 登录恢复后的真实批量验收

- Edge 的 Boss 页面重新出现“简历 new”，登录提示消失。**最终打包版**默认批量 `target=1, dryRun=true`：`previewed=[{city:"武汉",title:"AI应用开发实习生",company:"中力海慧"}]`、`applied=[]`、`fails=0`、`stopReason=completed`；账号累计仍为 1。
- 同一打包版默认批量 `target=1, dryRun=false`：`applied=[{time:"16:42:34",city:"武汉",title:"AI应用开发实习生",company:"中力海慧"}]`、`fails=0`、`stopReason=completed`、`running=false`。Boss 沟通列表该公司最新会话显示 `16:42 [送达]`。账号档案累计由 1 增至 2，最新记录包含城市、岗位、公司、时间，公司已加入跨批去重列表。脱敏机读证据在 `verification/2026-09-28-boss-batch-release-gate/live-success.json`。
- **判定：v0.5.1 Windows x64 测试版满足发布门槛。** 本判定只覆盖 Windows 和目标 1 的批量端到端，不把单笔成功外推为每天 100 笔达成；每日定时计划仍未启用，macOS 仍未打包实测。安装包 SHA256 校验文件已按最终重构建结果更新，`sha256sum -c` 返回 `OK`。

## 2026-09-28 满量实测暴露缺陷与 v0.5.2 修复候选

- 用户授权 Windows 真实投递。v0.5.1 包以目标 100 启动，批量回执及默认账号落盘确认 25 家；第 26 条发送回执不明时停止，页面实际为“安全验证”。用户完成验证后，只读核查该岗位详情仍有“立即沟通”，没有成功提示，未记入已投。
- 历史公司去重后续跑目标 75，又确认 6 家；此后 Boss 返回 `/web/passport/zp/403.html`，页面提示“访问受限”“您的 IP 存在异常行为”“将于 2026-09-28 19:46 恢复正常”“请勿频繁提交刷新请求”。软件当时误报 `search-mismatch`；本轮确认新增共 31 家，账号历史累计 33 家。没有再次请求受限页面，剩余目标未完成。
- 原代码只有发送后 25–45 秒限速；连续空查询按 3–6 秒导航，因此可能加重访问频率。v0.5.2 候选增加搜索导航至少 30 秒间隔、403 独立停止原因，以及发送后安全验证的停止原因判别。频率是风险线索，不把它当作 403 的已证实唯一原因。待恢复后从已落盘公司去重继续验证，不能直接宣称已可每日 100 家。
- 腾讯校招已登录并打开 `resumeedit.html`，自动填写并回读核验 11 字段，27 字段待核对。网站原“接受其他城市分配=是”与用户“不接受”冲突，人工更正为“否”；简历未提交、未验证网站保存。候选版补该 0/1 单选映射，并把差异预览从关键词包含改成实际填写安全匹配器，以消除“姓名→紧急联系人”的错误建议。官网网申自动提交尚未产品化，`state.applied=0`。
- 回归新增 403 停止、不重复导航、空查询限速、发送后验证停止、腾讯 0/1 单选回读和紧急联系人排除用例；候选版需继续完整测试、Windows 打包与真实页面复验。每日 100 份日程仍未启用。
