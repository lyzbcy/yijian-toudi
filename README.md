# 一键投递

一个 macOS 优先、面向未来跨平台的本地求职工作台。它把招聘岗位、统一简历、招聘邮件和自动化任务放在同一个桌面应用里，并提供仅监听本机的 Agent API。

> 当前版本：`0.1.0 MVP`。岗位数据默认是明确标注的演示数据；QQ 邮箱同步、本地简历保存、Agent API、真实浏览器入口和更新检查已经有可运行实现。各招聘网站的抓取、填表和投递仍需逐站适配与实测。

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

## 目录

- `electron/`：桌面主进程、数据存储、QQ 邮箱、浏览器入口、本地 Agent API
- `src/`：桌面应用界面
- `docs/`：GitHub Pages 介绍页
- `doc/`：AI memory 与开发文档
- `installer/`：未签名 macOS 内测包安装授权脚本
- `zeen-tools/`：一键开发预览与关闭脚本

维护入口见 [doc/README.md](doc/README.md)。
