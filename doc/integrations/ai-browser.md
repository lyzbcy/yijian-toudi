# AI 网页级调试与使用
现状：v0.5.10 Windows 源码预览；已测 DOM、跨域 iframe、子窗口与启动/关闭。
负责人：项目维护者。
最后更新：2026-09-30。

## 为什么这样接入
Electron 内嵌工作区本身是 Chromium 页面。用 Playwright/CDP 操作同一 WebContents，比桌面坐标更直接；官网原来的 `persist:<公司>`、iframe、opener、postMessage 保持不变。Kimi WebBridge 继续用于 Edge/Chrome 的外部官网页面；外部浏览器成功不能代替内嵌软件登录验收。

## 启动与关闭
双击 `zeen-tools/一键AI调试预览.bat`，或运行 `pnpm preview:ai`。先关闭普通预览；脚本不把普通运行误报成已接通 AI 调试。默认复用正式个人数据目录，临时测试可设置 `YJT_PREVIEW_PROFILE`。

窗口标题包含 `LOCAL PREVIEW · AI DEBUG`。仅该显式启动入口启用随机本机 CDP 端口，地址固定 `127.0.0.1`；普通入口仍不开调试端口。连接信息写进已忽略的 `.local-data/ai-preview.json`，不含 Token/Cookie。停止使用 `zeen-tools/关闭AI调试预览.bat` 或 `pnpm preview:ai:stop`；它先停止批量工作区，再关闭主窗口并确认端口释放。关闭会丢弃官网未保存的页面编辑，但不把关闭记为官网已保存。

## JSON 文件驱动的工具
先运行 `node scripts/ai-browser.cjs list`，返回明确的 `targetId`、网页标题、框架树。不要猜“第一个标签页”。其余命令把 JSON 保存为 UTF-8 文件，运行 `node scripts/ai-browser.cjs 请求.json`，兼容中文，避免命令行转义。

```json
{"action":"snapshot","targetId":"从list取得","framePath":[0]}
```
`framePath:[]` 表示顶层；`[0]` 表示第一个子框架，`[0,0]` 表示其第一个子框架。读取跨域 iframe 的自己的 DOM，不把 iframe 单独打开来破坏登录父页面。

snapshot 返回 `snapshotId` 和可见元素 `ref`（例如 e12），支持 open Shadow DOM，默认不读取 input 值。点击或填写沿用这次观察的 id/ref；刷新快照、导航或节点替换后旧引用报错，不自动重放。

```json
{"action":"click","targetId":"从list取得","framePath":[0],"snapshotId":"从snapshot取得","ref":"e12"}
```
```json
{"action":"fill","targetId":"从list取得","snapshotId":"从snapshot取得","ref":"e8","value":"本地测试"}
```
每次动作返回实际导航、`Page.frameRequestedNavigation` 和更新后的目标列表，方便跟进被拦截请求与新子窗口。点击只发送一次，不等待网站长链导航完成；之后按返回的目标和 App status 继续核对。错误也带回现场事件和目标，不自动重试。`expectUrl` 可固定上次观察的脱敏 origin+pathname；位置变更时先重新 list。URL 查询参数不出现在目标/事件输出中；输入密码保持人工操作。

`screenshot` 要给绝对 `path`，对选定网页直接截图，不截图整个桌面。保存/提交/投递等明确按钮默认要求请求中额外给 `confirmSubmission:true`；仍须有用户当次指令，工具不会代用户推断。复杂业务继续走 App 的专门 API，不新增任意远程执行 JS 的 HTTP 服务。

## App 业务入口
选中 list 的 `kind:app` 目标，调用：
```json
{"action":"app","targetId":"App目标id","command":"openLogin","companyId":"jd","recruitType":"campus"}
```
支持 `openLogin`、`closeLogin`、`status`；复用原有 IPC，status 回读真实工作区诊断。`shutdown` 要 `confirmDiscard:true`，用于显式关闭本轮预览。

## 给 AI 的复用提示词
```text
先用一键AI调试预览.bat启动当前源码。用scripts/ai-browser.cjs list识别App和招聘站targetId。
通过app.openLogin打开所需平台；读取顶层与登录iframe snapshot，按snapshotId/ref执行单个动作。
每个动作后核对导航事件及新窗口列表，遇新子页面重新list/snapshot，保留原有父页面和会话。
扫码/验证码交给用户；用官网已登录元素与关闭重开后的状态验收，扫码成功不等于登录成功。
仅在用户当次明确授权后点击保存/投递，并核对官网回执；错误引用不自动重试。
```

## 自动回归
`pnpm test:ai-browser`：原生 Electron 临时 profile + 内存 HTTPS 站点测跨域 iframe、中文填入、popup、脱敏导航、旧引用、提交确认与连接断开后 App 仍存活；另从真实 bat 入口测中文路径、重复启动、AI 标记、关闭和端口释放。该回归不是任何招聘账号登录成功证明。
