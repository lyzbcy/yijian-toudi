# 架构总览

## 为什么选择 Electron

首版需要同时具备桌面 UI、本地数据、系统安全存储、浏览器控制和未来 Windows 支持。Electron 能让 macOS 与 Windows 复用绝大多数业务代码，减少双系统维护分叉。

## 运行结构

```text
Renderer（src）
  └─ 只负责界面，通过 preload 白名单调用功能
       ↓ IPC
Main Process（electron）
  ├─ JsonStore：本地原子写入
  ├─ Mail：QQ IMAP + 邮件分类
  ├─ WebContentsView：招聘登录/简历核对，共用 persist:<company> 会话并保留退出栏
  ├─ Browser collectors：少数动态岗位页使用 Playwright 渲染采集
  ├─ AgentServer：127.0.0.1 本地 HTTP API
  └─ Update：GitHub Releases 检查
```

## 数据边界

- `state.json` 位于 Electron `userData` 目录，不进入项目仓库。
- QQ 邮箱授权码由 Electron `safeStorage` 使用系统能力加密后保存。
- Agent API 只监听 `127.0.0.1`，并要求随机 Bearer Token。
- Agent/导出脱敏快照会删除 Token、联系方式、身份、家庭、合规和邮件正文；仍保留教育/工作/项目内容供求职分析，不等同匿名公开简历。

## 跨平台约束

- 路径统一用 Node `path` 处理。
- 招聘浏览器可执行文件按 macOS / Windows / Linux 候选路径探测。
- 安装包由 electron-builder 同一份配置产出 macOS DMG/ZIP 与未来 Windows NSIS。
- 平台专有安装脚本放在 `installer/`，不进入业务代码。
