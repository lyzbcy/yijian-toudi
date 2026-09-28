# 一键投递

一个 macOS 优先、面向未来跨平台的本地求职工作台。它把招聘岗位、统一简历、招聘邮件和自动化任务放在同一个桌面应用里，并提供仅监听本机的 Agent API。

> 当前版本：[v0.5.0 Windows x64 测试预发布](https://github.com/lyzbcy/yijian-toudi/releases/tag/v0.5.0)；最近稳定 Release：`v0.3.1`。腾讯、百度、字节跳动、小米、京东、美团的岗位抓取已有真实实现；QQ 邮箱同步、本地简历保存、安全备份、Agent API、更新检查和可见浏览器工作区可运行。Windows 安装与核心 API 已实测；macOS 0.5.0 安装及真实账号投递仍以各自验收记录为准。

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

使用独立临时数据目录和隐藏 Electron 窗口，不显示应用、不占用正式 Agent API 端口、不启动自动岗位刷新。运行单元测试、静态检查、八组界面/同步流程回归；报告写入 `test-output/background-tests.json`，每组保留日志。测试失败立即停止，不以重试掩盖问题。

`pnpm test:live-jobs` 仅匿名读取六家官网的社招岗位，验证真实分页、数据规范化和重复 ID；不登录、不保存简历、不投递。报告写入 `test-output/live-jobs-full.json`。这不等同于已覆盖所有岗位或账号写入验收。

稳定性修复与剩余验收边界见 [2026-09-09 后台稳定性打磨](doc/progress/2026-09-09-后台稳定性打磨.md)。

## 同版本 Skill 与通用部署

`pnpm pack:skill` 从 `skill/yijian-toudi/` 生成 `release/yijian-toudi-skill-<版本>.tar.gz` 和 SHA256；版本必须与 `package.json` 一致。发布 GitHub Release 时，`release-skill.yml` 会自动附加同版本 Skill 包。发布前先跑 `pnpm test:background`、`pnpm test:site`、`pnpm pack:skill`，并在 macOS 上验证 DMG/ZIP 安装与真实账号链路；不能把本机测试通过当成 macOS 安装验收。

Skill 解压到使用者的 Agent skills 目录，例如 `$HOME/.codex/skills/`。桌面应用和已登录浏览器继续运行；云端 Skill 只做定时触发与监控，不保存登录态。异机时，从桌面建立仅云端回环可访问的 SSH 反向隧道：

```sh
ssh -N -o ExitOnForwardFailure=yes -R 127.0.0.1:153147:127.0.0.1:53147 USER@SERVER
```

云端以私有环境配置提供 `YJTD_API_TOKEN`（从应用「连接 AI Agent」页取）、`YJTD_BASE_URL=http://127.0.0.1:153147`、`YJTD_ACCOUNT_ID=default`、`YJTD_TARGET=100`。先设 `YJTD_DRY_RUN=1` 运行 `node $HOME/.codex/skills/yijian-toudi/scripts/daily-boss.cjs`，确认账号、筛选、通知和状态；再移除 dryRun，让服务器在 `Asia/Shanghai` 每天 10:00 调用同一命令。单次触发会按上海日期防重；启动成功只表示任务开始，不保证投满 100。客户账号上限 50，默认自用账号上限 120。完整步骤与故障处理见 [Skill 部署说明](skill/yijian-toudi/references/deploy.md)，应用「连接 AI Agent」页也有部署摘要。
