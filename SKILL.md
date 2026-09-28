---
name: yijian-toudi-dev
description: 一键投递桌面应用的开发与发布入口。修改应用、Agent API、Skill 包或发布流程时使用。
---

# 一键投递开发入口

## 项目一句话
一键投递是 Electron 本地求职工作台，聚合岗位、简历、邮件与本机 Agent API；`skill/yijian-toudi/` 是独立发布的操作 Skill。

## 技术栈
Node.js 20+、Electron、原生 JavaScript、pnpm；macOS 与 Windows 分别构建。Windows NSIS 入口为 `pnpm dist:win`，打包回归见发布文档。

## 目录地图
`electron/` 主进程与 API；`src/` 应用界面；`site/` 介绍页；`test/` 回归；`skill/yijian-toudi/` 用户 Skill；`scripts/` 构建发布；`doc/README.md` 是文档导航。

## 开发流程
先读 `doc/README.md` 和相关模块文档，保留现有未提交改动。改动同步代码、文档、测试与版本号。版本以 `package.json#version` 为唯一源；Skill 的 `version.json#version` 必须一致。先运行 `pnpm test:background`、`pnpm test:site`、`pnpm pack:skill`；真实网站能力另看 `pnpm test:live-jobs`。发布流程见根 README。

## 当前状态
v0.5.0 Windows x64 测试预发布已发布；最近稳定 Release 为 v0.3.1。Windows 安装实测记录见 `doc/progress/2026-09-28-release-readiness.md`；macOS 仍需单独构建验收。

## 红线
Agent API 只监听 127.0.0.1；不要把 Token 放进仓库、包或公开 Prompt。Boss 批量启动与安全验证停止逻辑在 `electron/main.cjs`、`electron/boss-batch.cjs`，改动后必须测账号隔离、限额、dryRun 与停止。未观察到成功证据不得记为已投递。更新器与发布资产变更必须在文档记录测试结论。
