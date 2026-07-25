# 一键投递

一个 macOS 优先、面向未来跨平台的本地求职工作台。它把招聘岗位、统一简历、招聘邮件和自动化任务放在同一个桌面应用里，并提供仅监听本机的 Agent API。

> 当前开发版基于 `0.1.0 MVP`。腾讯、百度、字节跳动、小米、京东、美团的岗位抓取已有真实实现；QQ 邮箱同步、本地简历保存、Agent API、更新检查和可见浏览器工作区可运行。腾讯简历填写与投递已接入“自动准备、用户最终确认”流程，仍需要使用真实账号完成最终外部写入前的人工验收；其他公司的简历与投递继续逐站适配。

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
- `site/`：GitHub Pages 介绍页（图片源唯一存放在 `src/assets/`，部署时同步）
- `doc/`：AI memory 与开发文档
- `installer/`：未签名 macOS 内测包安装授权脚本
- `zeen-tools/`：一键开发预览与关闭脚本

维护入口见 [doc/README.md](doc/README.md)。
