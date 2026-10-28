---
name: yijian-toudi-dev
description: 一键投递桌面应用、Agent API、操作 Skill 和发布流程的开发维护入口。
---

# 一键投递开发入口

- 2026-10-26 档案恢复更正：同名 AppData 路径在 Codex/MSIX 子进程与日常软件中心入口下可能对应不同文件。日常入口空档案已恢复为原简历/111条投递/双邮箱，并重开核验。此前95验收只覆盖Codex启动环境，不能替代日常入口验收；后续真实档案操作先读[恢复与路径诊断](doc/progress/2026-10-26-profile-recovery.md)，禁止把工具看到的 `%APPDATA%` 自动当作日常进程实际文件。本次无程序改版。

- 2026-10-26 / 0.5.95：Agent引导/排障、Windows主题与主题安装器已交付；源码/Skill/本机实际0.5.95，保留111条与双邮箱；未公开。见[本轮](doc/progress/2026-10-26-agent95.md)。


## 项目一句话
Electron本地求职工作台，聚合岗位、简历、邮件与本机Agent API；`skill/yijian-toudi/`是独立交付的操作Skill，不包含浏览器引擎或个人数据。

## 技术栈
Node.js 20+、Electron、原生JavaScript、pnpm。Windows NSIS入口 `pnpm dist:win`；macOS独立构建验收，不从Windows结果推断。

## 目录地图
- `electron/`：主进程、API、平台适配与批量任务；`src/`：桌面界面与内置Agent契约。
- `skill/yijian-toudi/`：用户操作入口及按需资料；`site/`：介绍页；`test/`：回归；`scripts/`：构建/发布。
- `doc/README.md`：唯一文档导航，先读相关模块而非全部历史；`reference/`：深度资料；`verification/`：分阶段证据，不作为运行状态源。
- 浏览器/官网问题读 `doc/integrations/ai-browser.md`；Agent官网协作读 `doc/integrations/agent-applications.md`；简历事实读 `doc/integrations/resume-data-model.md`；发布读根README和 `doc/development/mvp-acceptance.md`。

## 开发流程
1. 先读doc导航、路线图与本次模块，检查实际源码/运行版本及未提交改动；旧根路径先解析到分类目录，不复制新项目。源码回滚只备份本次改动文件，不全量复制Electron/浏览器/项目或用户档案。
2. 代码、文档、版本同步；`package.json#version`唯一源，操作Skill的version.json保持一致。版本元数据、源码标签与已构建Windows资产标签分开，已存在归档不覆盖。
3. 每项实质改动记录 `doc/progress/`，更新 `doc/coordination/sy-202608111736.md` 并运行 `node doc/coordination/snapshot.cjs`；失败按实记录，不伪造Git状态。
4. 主要回归：`pnpm test:background`、`pnpm test:site`、`pnpm pack:skill`；真实官网能力看 `pnpm test:live-jobs`，不把fixture/单测当官网成功。按实际执行范围与失败记录验收；公开发布前核对完整MVP矩阵。
5. 双设备组合先读 `doc/coordination/README.md`，保留双方源码/旧包/失败证据，核实共同基点并按功能实测合入，不按版本号/时间全文件覆盖；私有配置/简历/登录态不进交换材料。

## 当前状态
- 源码/操作Skill/Windows本机0.5.95已交付，未公开；状态与验收分账见[当前状态](doc/current-state.md)。
- Agent引导/排障、主题与安装器见[95模块](doc/progress/2026-10-26-agent95.md)；统一刷新/邮箱边界见[94模块](doc/progress/2026-10-26-refresh94.md)。
- 历史版本与旧设备事实从[历史导航](doc/README-before-navigation-20261026.md)按需读取，不当作当前待办或正在运行任务。真实投递/未知回执仍按原账本核查，不自动重放。
- 本轮只整理文档入口/规范快照，不改程序、操作Skill归档、安装、用户档案或公网元数据，不制造96版本。

## 自包含规范与验收
- [共享规范快照](reference/software-development/快照说明.json)记录上游与本地SHA；[日志](reference/software-development/软件组件/日志系统.md)、[更新新鲜度](reference/software-development/软件组件/自适应更新检测.md)、[AI-Native](reference/software-development/软件组件/AI-Native.md)、[反馈](reference/software-development/软件组件/用户提意见&反馈.md)均在项目内。
- [美化](reference/software-development/推广&美化/美化设计.md)、[原创素材](reference/software-development/推广&美化/润物细无声.md)、[图标规范](reference/software-development/推广&美化/图标logo.md)与登记只读快照供后续核对；本轮不重选logo、不修改上游登记。
- 日志/反馈/15天提示见[模块](doc/integrations/feedback.md)，其中旧版段落是历史实现与部署记录；95实测范围见当前状态，不凭引用规范勾完成。
- 构建、安装/冷重开及版本来源分别记录，公网查新与本地开发升级不混同。只改文档不重装；后续功能更新必须本机实际升级、保留设置与回退。

## 轻量开发与红线
- Agent API只监听127.0.0.1；Token/简历/Cookie/Webhook私钥不进仓库、包、公开Prompt或日志。
- Boss批量启动与停止门禁位于 `electron/main.cjs`、`electron/boss-batch.cjs`；涉及改动必须验账号隔离、限额、dryRun、停止与未知回执。未观察成功证据不记已投递。
- 更新器与发布资产变更单独记录原因与测试；App ID/安装身份/更新SHA等不变量保留。
- 官网调试保持招聘父页、同一会话及SSO回跳；内嵌AI预览用 `scripts/ai-browser.cjs`，外部浏览器按Kimi WebBridge说明操作。不要把iframe单独打开或默认用桌面坐标。
- 预览沿用 `zeen-tools/一键本地预览.bat` 与成对关闭入口；只向核验同进程的唯一预览窗正常关闭，不强杀原个人/客户窗口。缓存、依赖、运行数据与历史资产不纳入默认搜索监听。
