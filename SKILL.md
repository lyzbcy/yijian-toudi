---
name: yijian-toudi-dev
description: 一键投递桌面应用的开发与发布入口。修改应用、Agent API、Skill 包或发布流程时使用。
---

# 一键投递开发入口

55候选修复ATSX学校搜索/日期展示误入文本计划，实际包8检查、401单测/30套后台、Windows127文件及实际54→55升级8检查/旧中文附件离线队列通过。隔离SDK字节8/78、小米7/79控件DOM一致/事实人工，不计完整语义或官网保存。54Mac双架构已回读并备份18资产，55原生另验；Windows NotSigned，首次版本格式失败保留。完整交付与整体低于1%未证明。

## 项目一句话
一键投递是 Electron 本地求职工作台，聚合岗位、简历、邮件与本机 Agent API；`skill/yijian-toudi/` 是独立发布的操作 Skill。

## 技术栈
Node.js 20+、Electron、原生 JavaScript、pnpm；macOS 与 Windows 分别构建。Windows NSIS 入口为 `pnpm dist:win`，打包回归见发布文档。

## 目录地图
`electron/` 主进程与 API；`src/` 应用界面；`site/` 介绍页；`test/` 回归；`skill/yijian-toudi/` 用户 Skill；`scripts/` 构建发布；`doc/README.md` 是文档导航。

## 开发流程
浏览器调试优先读 `doc/integrations/ai-browser.md`，用显式 AI 源码预览与 `scripts/ai-browser.cjs` 读取同会话 DOM、open Shadow DOM、跨域 iframe、导航请求；不要默认用桌面坐标或把 iframe 单独打开。外部浏览器使用 Kimi WebBridge，与内嵌登录验收区分。

先读 `doc/README.md` 和相关模块文档，保留现有未提交改动。改动同步代码、文档、测试与版本号。版本以 `package.json#version` 为唯一源；Skill 的 `version.json#version` 必须一致。先运行 `pnpm test:background`、`pnpm test:site`、`pnpm pack:skill`；真实网站能力另看 `pnpm test:live-jobs`。发布流程见根 README。

## 当前状态



当前权威状态为 v0.5.55 接续开发候选，未正式发布，goal仍active。ATSX通用规划/执行守卫及Windows包/升级/队列已验；54Mac双架构取回并备份，55原生另验。完整官网账号、公众分发、当前完整视频和总体bug率门槛均保留，旧包与视频保持原版。见 `doc/progress/2026-10-04-recovery-delivery.md` 和 `doc/development/mvp-acceptance.md`，以下旧状态仅作历史线索。

当前工作树已推进到 v0.5.15 Windows 延迟扫码计时修复候选：最新失败与对照见 `doc/progress/2026-10-02-jd-delayed-auth.md`；京东同框架回跳修复见 `doc/progress/2026-10-02-jd-frame-fix.md`；本轮窗口竞态与批量按钮修复见 `doc/progress/2026-10-02-mvp-hardening.md`；京东真实扫码后的 `qq.jd.com` 回跳修复见 `doc/progress/2026-09-30-jd-login.md`；此前现场证据见 `doc/progress/2026-09-29-live-window-fixes.md`；登录回跳与附件解析确认见 `doc/integrations/login-upload.md`。继承 v0.5.4 的批量平台选择、准确更新时间记录、4/6 独立窗口；见 `doc/progress/2026-09-29-resume-batch.md`。继承 v0.5.3 的停止可中断、单活跃批次、发送前持久记录、重启异常复核。开发与验收优先看 `doc/progress/2026-09-29-mvp-p0.md`；下段是上一版实测基线，不代表新版本已发布。
工作树为 v0.5.2 Windows 修复候选；v0.5.1 已发布。Windows 满量实测本轮 Boss 新增确认 31 笔后遇 403，未达 100；腾讯校招 11 字段回读但尚未验证官网保存。修复及实测记录见 `doc/progress/2026-09-28-release-readiness.md`。macOS 仍需单独构建验收。

## 红线
Agent API 只监听 127.0.0.1；不要把 Token 放进仓库、包或公开 Prompt。Boss 批量启动与安全验证停止逻辑在 `electron/main.cjs`、`electron/boss-batch.cjs`，改动后必须测账号隔离、限额、dryRun 与停止。未观察到成功证据不得记为已投递。更新器与发布资产变更必须在文档记录测试结论。
