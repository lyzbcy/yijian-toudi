---
name: yijian-toudi
description: 操作一键投递应用的本地 Agent API，查询岗位与投递状态，并在用户配置后执行 Boss 批量投递或定时任务。适用于连接已运行的一键投递，不替代桌面应用或浏览器登录。
---

# 一键投递

本 Skill 是客户端，不是招聘网站自动化引擎。应用和已登录浏览器负责抓取、筛选、投递；Skill 通过本机回环 API 发命令。先读取 `version.json`，确认应用 `/v1/status` 的版本一致。

## 接入

- 从应用「连接 AI Agent」页取得 Base URL 与 Token。Token 只放本机私有环境变量，不写进对话、仓库或 Skill 包。
- API 只监听 `127.0.0.1`。异机部署时先建立到运行应用的机器的 SSH 回环隧道，Skill 仍访问服务器本机回环地址；不要把 API 直接暴露公网。
- 部署与每日 10 点示例见 [references/deploy.md](references/deploy.md)。

## 操作

1. GET `/v1/status`，核对版本；GET `/v1/boss/accounts` 核对账号；GET `/v1/boss/batch/status` 避免重复任务。
2. 查询岗位、脱敏简历、邮件与任务分别用 `/v1/jobs`、`/v1/resume`、`/v1/messages`、`/v1/tasks`。本地命令走 `/v1/commands`，写命令带唯一 `Idempotency-Key`。
3. Boss 批量任务可用 `POST /v1/boss/batch/start`，请求中明确 `accountId`、`target`、`dryRun`。先 dryRun 核对目标、登录态与 `previewed`（只预览，不发送也不计入 `applied`），再按用户给定日程启用正式发送。客户账号单次上限 50，自用默认账号单次上限 120。
4. GET `/v1/boss/batch/status` 监控；遇 `security-check`、`login-required`、`search-mismatch`、`send-unverified`、`persist-failed` 或异常立即停止后续日程并通知用户处理。结束后按实际 `applied` 回报数量，不能把目标数或 `previewed` 当结果。

## 定时入口

`scripts/daily-boss.cjs` 是零依赖的定时触发器：验证版本、账号、目标上限、空闲状态和当日防重后才调用启动 API。正式运行需要 `YJTD_API_TOKEN`；可选 `YJTD_BASE_URL`、`YJTD_ACCOUNT_ID`、`YJTD_TARGET`、`YJTD_STATE_DIR`、`YJTD_DRY_RUN=1`。它只提交一次任务，不代表已投出目标笔数；后续状态由应用和监控流程确认。
