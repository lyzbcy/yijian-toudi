---
name: yijian-toudi
description: 操作一键投递应用的本地 Agent API，查询岗位与投递状态，并在用户配置后执行 Boss 批量投递或定时任务。适用于连接已运行的一键投递，不替代桌面应用或浏览器登录。
---

# 一键投递

京东v0.5.52通过官网学校只读搜索选择精确候选，字段需要整条结束后回读。月份/至今仍不能当具体日，相关人工项需本人补充。阿里校招v0.5.51只暂存分区，不自动保存。项目事实可能带标签合并到描述，报告明确列出表示方式；日期、下拉、组织名与缺失工作组需本人核对。回读通过不等于官网保存。

本 Skill 是客户端，不是招聘网站自动化引擎。应用和已登录浏览器负责抓取、筛选、投递；Skill 通过本机回环 API 发命令。

## 每次使用的入口

先从安装主目录运行 `node scripts/use.cjs`。它立即返回本次有效`version/root/instructions/deployment/dailyScript`，后台静默检查更新，不等待下载。读取返回的有效instructions/deployment（若仍是本文件无需重复读），再核对应用`/v1/status`与有效version一致。主目录version.json是引导器出厂版本，不用它覆盖缓存有效版本。后续定时调用仍走返回的dailyScript主目录入口；更新原理、通道/镜像/关闭与失败记录见[references/update.md](references/update.md)。

```text
操作一键投递Skill：先执行安装主目录scripts/use.cjs，按返回路径读取有效文档并使用有效版本。
更新不等待、不发投递命令；桌面版本不匹配或批次requiresReview时停止启动，保留已运行任务。
```

## 接入

- 从应用「连接 AI Agent」页取得 Base URL 与 Token。Token 只放本机私有环境变量，不写进对话、仓库或 Skill 包。
- API 只监听 `127.0.0.1`。异机部署时先建立到运行应用的机器的 SSH 回环隧道，Skill 仍访问服务器本机回环地址；不要把 API 直接暴露公网。
- 部署与每日 10 点示例见 [references/deploy.md](references/deploy.md)。

## 操作

0.5.21 云端SSH反向端口示例为15347（合法范围1～65535），APP/README/本Skill保持一致；20版本的153147示例非法，请按references/deploy.md修正，先只读状态再dryRun，不直接正式投递。

0.5.20 新增桌面反馈/真实评价与诊断。通用反馈服务部署见软件仓库support/README.md；用户投递企微通知和开发者反馈是独立配置，群密钥只留服务器，不放Skill包。正式反馈公网部署与全部求职闭环仍需实测。

0.5.19 的 JD 控件候选不等于七家真实端到端完成。官网字段只依据用户事实填写；缺枚举选项、日期只有年月/至今需要核对，不按官网显示100%判成功。打开页面不计已保存/申请，回读字段不计投递回执。

1. GET `/v1/status`，核对版本；GET `/v1/boss/accounts` 核对账号；GET `/v1/boss/batch/status` 避免重复任务。
2. 查询岗位、脱敏简历、邮件与任务分别用 `/v1/jobs`、`/v1/resume`、`/v1/messages`、`/v1/tasks`。本地命令走 `/v1/commands`，写命令带唯一 `Idempotency-Key`。
3. Boss 批量任务可用 `POST /v1/boss/batch/start`，请求中明确 `accountId`、`target`、`dryRun`。先 dryRun 核对目标、登录态与 `previewed`（只预览，不发送也不计入 `applied`），再按用户给定日程启用正式发送。客户账号单次上限 50，自用默认账号单次上限 120。
4. GET `/v1/boss/batch/status` 监控；遇 `access-restricted`、`security-check`、`login-required`、`search-mismatch`、`send-unverified`、`persist-failed` 或异常立即停止后续日程并通知用户处理。`access-restricted` 须等待网站提示的恢复时间，不要反复刷新。结束后按实际 `applied` 回报数量，不能把目标数或 `previewed` 当结果。

## 定时入口

### 异常复核（v0.5.3）

`status.requiresReview=true` 时停止日程，先向用户展示 stopReason、runId 与 pending；不得自动清除。用户明确完成复核后，可 POST `/v1/boss/batch/resolve`，body 为 `{"runId":"当前状态中的ID","action":"acknowledge-and-skip-unknown"}`。该动作只解除暂停，未知公司继续跳过、不计成功、不自动启动；后续启动是独立动作。`running=true, stopping=true` 表示旧任务仍在收尾，不启动新任务。

`scripts/daily-boss.cjs` 是零依赖的定时触发器：验证版本、账号、目标上限、空闲状态和当日防重后才调用启动 API。正式运行需要 `YJTD_API_TOKEN`；可选 `YJTD_BASE_URL`、`YJTD_ACCOUNT_ID`、`YJTD_TARGET`、`YJTD_STATE_DIR`、`YJTD_DRY_RUN=1`。它只提交一次任务，不代表已投出目标笔数；后续状态由应用和监控流程确认。
