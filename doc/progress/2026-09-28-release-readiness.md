# 2026-09-28 发布就绪度实测

> 现状：0.5.0 Windows x64 测试预发布已发布 ｜ 负责人：维护者 ｜ 最后更新：2026-09-28

## 已验证

- Windows/Node 24.14.0、pnpm 10.12.1：`pnpm test:background` 基线通过，单测、静态检查和 8 组界面/同步回归全绿。
- `pnpm test:live-jobs` 匿名只读实测全绿：腾讯 1431、百度 12、字节 605、小米 229、京东 1121、美团 1213 个岗位；结果在 `test-output/live-jobs-full.json`。这是匿名读取，不是账号写入验收。
- `pnpm test:site` 在 Edge + 本地预览服务（4300 端口）通过：桌面/移动端图片均完整，移动端横向溢出 0px。默认 4173 端口处于本机 Windows 保留端口段，故改用 4300。
- 介绍页原下载按钮曾指向不存在的 0.2.0 中文 ZIP；已改为最近公开 Release 页面，`PAGE_V` 与 `site/version.json` 同步到 7，修改后站点测试再次通过。
- Skill 日程触发器单测覆盖时区、dryRun、当日防重、账号限额、版本不一致、回环 API；本机 AgentServer 实 HTTP dryRun 集成通过。`pnpm pack:skill` 成功，SHA256 与包体一致，`quick_validate.py` 通过。
- `pnpm dist:win` 在 Windows x64 上成功构建 NSIS；补齐 `build/icon.ico` 后不依赖远端图标包，产物名与 `latest.yml` 的 URL 均为 `yijian-toudi-setup-0.5.0.exe`。
- 最终安装包在工作区隔离目录静默安装 exit 0，已安装 exe 的 UI、119 个简历字段、Boss 默认账号、Agent API v0.5.0 与未授权 401 检查通过；静默卸载 exit 0，目录清除。安装包 SHA256：`6b6f02ee8cfd67f5d142c6044cc1b432bf8437e3c64fd8ee0c92296c4113610b`。
- 回归复跑 `pnpm test:background` 全 10 组通过；候选提交仅选择应用、Skill、文档与测试文件，未把辅助资料、第三方目录和本机验证文件整体加入。
- 可见 Windows 包截图暴露了更新检查误把 0.3.1 当作 0.5.0 的新版本；已修成语义版本比较与按平台挑选安装资产，新增 3 组回归测试。修复后已重新构建并再次完成安装、启动、API 与卸载闭环。

## 尚未覆盖的验收

1. 当前执行环境是 Windows；`pnpm pack:mac` 实跑返回 exit 1：`Build for macOS is supported only on macOS`。0.5.0 的 macOS DMG/ZIP 未验收，Windows 测试版不宣称覆盖 macOS。
2. 未使用真实已登录账号验证 Boss dryRun 的筛选结果、100 份正式投递或安全验证停止。自动日程未启用；Skill 在云端的 SSH 隧道也未实机连通。
3. 客户独立浏览器需要预先提取 Kimi 扩展；当前安装包没有内建「准备扩展」按钮，客户账号链路仍是实验特性。默认自用账号路径不依赖这个步骤。
4. 介绍页仍标 v0.3.1，与最近公开稳定 Release 对应；0.5.0 Windows 测试预发布不替换 macOS 最新稳定版入口。

**判定：Windows x64 安装与核心 API 满足测试预发布门槛，[v0.5.0 pre-release](https://github.com/lyzbcy/yijian-toudi/releases/tag/v0.5.0) 已发布。** Release 附 Windows 安装包、校验文件与同版本 Skill；GitHub 的 Skill 附包与 Pages 工作流均成功。它不是跨平台稳定版；真实账号 Boss dryRun/正式投递、macOS 安装和云端隧道仍需各自实测。
