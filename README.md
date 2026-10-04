# 一键投递

**AI 本地调试**：双击 `zeen-tools/一键AI调试预览.bat`，用 `node scripts/ai-browser.cjs list` 直接操作当前软件的网页/Shadow DOM/iframe/子窗口；关闭用 `zeen-tools/关闭AI调试预览.bat`。操作格式与可复用 AI 提示词见 [AI 网页调试](doc/integrations/ai-browser.md)。普通本地预览不启用 CDP。

当前源码为 **v0.5.40 接续开发候选**：从共享文件与完整性校验通过的 v0.5.33 ASAR 恢复运行代码，并在独立工作树继续开发。原设备的聊天、登录会话和未同步修改尚未恢复。修复与当前验收见 [接续交付进度](doc/progress/2026-10-04-recovery-delivery.md)，全部交付要求见 [MVP 验收矩阵](doc/development/mvp-acceptance.md)。当前候选未正式发布，整体 bug 率低于 1% 尚无充分证据。

一个 macOS 优先、面向未来跨平台的本地求职工作台。它把招聘岗位、统一简历、招聘邮件和自动化任务放在同一个桌面应用里，并提供仅监听本机的 Agent API。

> 源码当前为 v0.5.40 Windows 交付候选；最近公开版本为 [v0.5.1 Windows x64 测试预发布](https://github.com/lyzbcy/yijian-toudi/releases/tag/v0.5.1)，最近稳定 Release 为 `v0.3.1`。2026-10-04 匿名读取六家官网社招岗位均通过，共 4159 条；这不代表官网简历保存或投递已验收。macOS 安装仍需单独验收。

2026-09-28 Windows 真实账号实测：v0.5.1 首批确认 25 笔，安全验证后续批确认 6 笔，本轮新增 31 笔；网站随后返回 403 并提示限时恢复，未达到 100 笔。v0.5.2 候选修复访问受限分类及空查询限速，待打包版复验。腾讯校招简历自动填写回读 11 项，但未验证官网保存。详见 [实测记录](doc/progress/2026-09-28-release-readiness.md)；每日 100 份计划未启用。

## Windows 本地预览
双击 `zeen-tools/一键本地预览.bat` 运行最新源码；关闭用 `zeen-tools/关闭本地预览.bat`。无需安装新包。沿用本机简历与登录态，不自动刷新岗位或启动批量任务；先关已安装版再启动。详见 [本地开发说明](zeen-tools/本地开发说明.md)。

## 快速开始

开发环境需要 Node.js 20+。

```bash
pnpm install
pnpm start
```

macOS 用户也可以双击 `zeen-tools/一键启动应用.command`。

## 打包

```bash
pnpm pack:mac
pnpm dist:mac
```

未签名内测包可与 `installer/一键安装.command` 一起分发。安装脚本会复制应用到 `/Applications`、移除 quarantine 属性并启动应用。

Windows x64 可在 Windows 开发机运行：

```bash
pnpm pack:win        # 生成 release/win-unpacked/
pnpm dist:win        # 生成 release/yijian-toudi-setup-<版本>.exe
```

两条命令复用已安装的 `node_modules/electron/dist`，避免重复下载 Electron。发布前用独立用户数据目录启动打包程序、检查本机 Agent API，并对 NSIS 安装与卸载做一次闭环；不能只运行开发模式测试。

## 目录

- `electron/`：桌面主进程、数据存储、QQ 邮箱、浏览器入口、本地 Agent API
- `src/`：桌面应用界面
- `site/`：GitHub Pages 介绍页（图片源唯一存放在 `src/assets/`，部署时同步）
- `doc/`：AI memory 与开发文档
- `installer/`：未签名 macOS 内测包安装授权脚本
- `zeen-tools/`：一键开发预览与关闭脚本

维护入口见 [doc/README.md](doc/README.md)。

## 后台回归测试

```bash
pnpm test:background
```

使用独立临时数据目录和隐藏 Electron 窗口，不显示应用、不占用正式 Agent API 端口、不启动自动岗位刷新。运行单元测试、静态检查、17 组界面回归（包含三个窗口宽度、导航及凭证显示/复制）；报告写入 `test-output/background-tests.json`，每组保留日志。测试失败立即停止，不以重试掩盖问题。

`node test/windows-install-upgrade.cjs` 是显式安装集成验收：当前用户已有注册安装时停止；使用独立中文安装目录与样本用户数据，真实 NSIS 安装旧版、通过实际 IPC 更新入口下载校验候选、升级重启、保留数据并卸载，最后恢复原快捷方式与安装缓存。更新网络响应是受控样本，不算官方公网下载验收。需先保留 v0.5.35 安装包，并设 YJT_BASELINE_VERSION=0.5.35并构建当前候选，运行时关闭其他打包版测试实例。

`pnpm test:live-jobs` 仅匿名读取六家官网的社招岗位，验证真实分页、数据规范化和重复 ID；不登录、不保存简历、不投递。报告写入 `test-output/live-jobs-full.json`。这不等同于已覆盖所有岗位或账号写入验收。

稳定性修复与剩余验收边界见 [2026-09-09 后台稳定性打磨](doc/progress/2026-09-09-后台稳定性打磨.md)。

## 同版本 Skill 与通用部署

`pnpm pack:skill` 从 `skill/yijian-toudi/` 生成 `release/yijian-toudi-skill-<版本>.tar.gz` 和 SHA256；版本必须与 `package.json` 一致。`pnpm pack:feedback` 生成独立反馈服务与校验文件，部署见 [反馈说明](support/README.md)。`release-skill.yml` 只为已有草稿准备配套包；正式 published 事件只下载审计，不追加资产。macOS 候选工作流在真实 Mac runner 构建 DMG/ZIP、审计 ASAR 并启动可见应用；安装与信任提示另验。发布前先跑 `pnpm test:background`、`pnpm test:site`、`pnpm pack:skill`，并在 macOS 上验证 DMG/ZIP 安装与真实账号链路；不能把本机测试通过当成 macOS 安装验收。

Skill 解压到使用者的 Agent skills 目录，例如 `$HOME/.codex/skills/`。桌面应用和已登录浏览器继续运行；云端 Skill 只做定时触发与监控，不保存登录态。异机时，从桌面建立仅云端回环可访问的 SSH 反向隧道：

```sh
ssh -N -o ExitOnForwardFailure=yes -R 127.0.0.1:15347:127.0.0.1:53147 USER@SERVER
```

云端以私有环境配置提供 `YJTD_API_TOKEN`（从应用「连接 AI Agent」页取）、`YJTD_BASE_URL=http://127.0.0.1:15347`、`YJTD_ACCOUNT_ID=default`、`YJTD_TARGET=100`。先设 `YJTD_DRY_RUN=1` 运行 `node $HOME/.codex/skills/yijian-toudi/scripts/daily-boss.cjs`，确认账号、筛选、通知和状态；再移除 dryRun，让服务器在 `Asia/Shanghai` 每天 10:00 调用同一命令。单次触发会按上海日期防重；启动成功只表示任务开始，不保证投满 100。客户账号上限 50，默认自用账号上限 120。完整步骤与故障处理见 [Skill 部署说明](skill/yijian-toudi/references/deploy.md)，应用「连接 AI Agent」页也有部署摘要。

### v0.5.4 批量更新简历（候选）
在 APP「简历 → 批量更新简历」勾选平台，支持全选、记住选择。选 4 个（2×2）或 6 个（2×3）独立窗口；每个窗口可最大化，Alt+Tab 返回主窗口管理。窗口保留供登录/人工核对，关闭后为下一平台补位；同一公司不同招聘方向串行，避免登录态冲突。

每行显示上次更新与尝试时间。用户在官网保存后可点「我已在官网保存」，记录标注为用户确认；只有平台适配器提供保存证据才标为官网确认。关窗、字段回读都不算保存。历史只在本机，简历内容变更会提示；各平台官网仍需独立登录与实测。详情与 Windows 验收见 `doc/progress/2026-09-29-resume-batch.md`。

### v0.5.5 登录与附件解析修复（候选）
美团微信回调、字节微信登录跳转补齐现场确认的受信域；空白 SSO 子窗口保留 opener 和原平台会话。字节 AI 介绍遮罩自动选择“稍后再说”。百度/阿里在简历附件变更后处理明确的“是否使用附件刷新信息”确认，等待解析稳定再核对字段；申请/投递/协议弹窗保持独立。

完整说明见 `doc/integrations/login-upload.md`；真实扫码后的登录保持与官网保存仍需账号端验收，候选回归记录见 `doc/progress/2026-09-29-login-upload.md`。
