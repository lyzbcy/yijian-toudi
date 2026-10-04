# 登录回跳与附件解析确认

## 2026-10-04 v0.5.46 本人登录后只读核对

用户确认七家都登录后，在同一个个人开发进程中逐家打开校招简历页，未填写、上传或保存。腾讯、字节、阿里、美团、京东、小米均见到简历表单；百度登录入口重复ERR_ABORTED/about:blank，仍待查明。登录入口此前只为京东保留campus参数，新版对各平台均尊重传入方向；修复后的真实重开另验。

字节实际UD组件的姓名/邮箱标题在输入框第七层所属`.ud-formily-item`中；美团`.mtd-form-item`的标准caption可为空，真实标题位于所属body的`.label`。字段识别取所属caption，去除必填星号与尾部冒号，不借用相邻字段标题。UD/MTD组合选择器内的搜索输入保留人工选择，不能把输入文字当成选项已经提交。更新识别脚本在同一字节会话中只读核对，匹配由1项变为8项，包含姓名/手机/邮箱/专业；这不是实际填写或官网保存证明。日期、多段区块与自定义选项的完整覆盖仍待核对。

原始表单、简历与会话只保留忽略的本机目录；公开证据仅留字段计数、key、匹配布尔值和脱敏路径。七家登录的用户陈述与实际六家表单观察分开记录。原旧附件确实存在但被生成文件名规则拒绝的问题已修复，原附件名不改写。
现状：v0.5.11 修复候选；网页级真实入口诊断与离线回归已执行，账号端完整登录仍待验收。
负责人：项目维护者。
最后更新：2026-09-30。

## 登录窗口
- `login-manager.cjs` 允许来自受信官网的空白 SSO 子窗口，随后所有导航仍检查平台域名。保留 opener/postMessage，不用另开系统浏览器替代回调。
- 子窗口及嵌套子窗口沿用同公司持久分区；退出时 flush 原始 Cookie/Storage，不自行改 Cookie 有效期或 SameSite。
- 美团官网实际二维码使用 `open.weixin.qq.com/connect/qrconnect`，其 redirect_uri 指向 `https://zhaopin-login.meituan.com/official-login-pc/`。旧允许列表漏了这个回调域；新版本显式补入。
- 去掉硬编码 macOS Chrome132 UA 与手改客户端提示头，使用实际 Electron/Chromium 的 Windows 平台和版本信息。不是验证码自动通过或风控绕过功能。
- 字节微信登录按钮的实际跳转也指向 `open.weixin.qq.com/connect/qrconnect`，旧版同样漏允许域；按现场证据补入。
- 字节官网首次访问出现“AI 求职搭子”介绍遮罩，覆盖登录表单。只在同时匹配这段介绍、“线上咨询”“个性化荐岗”时点击“稍后再说”；不处理同意协议或验证码。
- 被拦截导航/弹窗与主框架加载错误，记入最近诊断并显示在平铺窗口顶部。日志只留 origin，不记录 URL 查询参数、验证码、Cookie 或个人字段。

## 上传后的刷新确认
`resume-upload.cjs` 在百度/阿里的简历核对页安装观察器，兼容程序上传和用户在保留页面手动上传。

1. 捕获简历附件 input change，或在已授权的简历核对页发现明确的待确认附件弹窗时激活；45 秒有界等待，不刷新网站。
2. 处理可见 dialog/alertdialog，以及同时含覆盖与仅替换附件按钮的短文本局部容器内“根据简历/附件刷新、更新或覆盖信息”的明确提示。
3. 只点击唯一、可见、未被遮挡的“确定/确认/刷新/覆盖/是，覆盖掉”等精确按钮。不扫描全页随便点确定；申请、投递与协议提示不进入确认分支。
4. 点击后等待弹窗消失、解析忙碌提示/加载遮罩消失，并观察到字段/简历内容区变化或明确解析成功提示，再等待表单值稳定，再返回 ready。超时/歧义转人工，停止后续自动字段写入。
5. 修正文件 change 后 input 被 React 清空时读取 `files[0].name` 的错误：文件名从注入前保存值返回。
6. 通用适配器先上传和解析，再识别字段、填写、回读，避免附件解析随后覆盖刚填好的数据。阿里删除旧的主动“取消刷新”逻辑。

本模块不把文件选中、确认解析、字段回读标成服务器保存成功。账号里最终保存/申请仍按现有流程独立核对。

## 回归
`test/ui-login-upload.cjs` 使用独立用户目录、原生 Electron 窗口与内存 HTTPS 页面，覆盖介绍遮罩、空白弹窗、同源回调、Cookie 保持、文件 input 重置、百度/阿里解析确认与申请弹窗反向用例。

`test/login-upload.test.cjs` 覆盖美团域名边界、解析就绪/超时、取消异常、先解析后填写及阿里取消逻辑删除。真实页面原始证据位于 `verification/2026-09-29-login-upload/`。

## v0.5.6 现场补充
- 实际字节回跳为 `job.bytedance.com`（不是入口 `jobs.bytedance.com`），已按现场诊断补入。
- 每个工作区创建独立 OAuth 回调映射。仅从已允许来源进入已允许站点时读取 redirect_uri/redirect_url/redirectUrl；仅接受 manifest 显式列出的本公司根域下 HTTPS、无账号密码、标准端口的回调。只放行 origin+pathname，10 分钟有效，最多 16 条；查询参数不记录、不持久化。主框架、弹窗、嵌套弹窗共用这个工作区策略。
- 百度现场按钮是“覆盖 / 仅替换简历”；阿里是“是，覆盖掉 / 否，仅替换附件”，UIA 暴露提醒对话框。此前只有“确定”的模拟测试漏掉了这两个场景。
- `test/ui-live-window-fixes.cjs` 使用现场原文构造原生 Electron 离线页面，覆盖已出现的弹窗、用户上传、幂等、只读解析区及反向用例；并非官网保存证据。

## v0.5.8 京东现场补充
当前 0.5.7 预览进程的内存日志直接记录京东 `navigation-blocked`，origin 为 `https://open.weixin.qq.com`，时间 2026-09-29 15:49:09 UTC。官方校园简历页实际加载 `https://campus.jd.com/passport/` 子页面，旧显式 JD 登录入口却指向社招。新版本按京东专属受信域、精确 JD 回调路径、校招/社招独立按钮处理；不把 WeChat 子资源域一概开放为可导航页面。回归见 `test/ui-jd-login.cjs`。

## v0.5.9 京东扫码后回跳
Windows 现场在校招简历页扫码成功后，工作区直接显示 `navigation-blocked https://qq.jd.com`。页面中微信 OAuth 的 `redirect_uri` 指向 `https://qq.jd.com/new/wx/callback.action`；v0.5.8 只监听主框架，未从京东登录 iframe 学到该回调。manifest 显式登记此精确回调路径；导航策略不放行 `qq.jd.com` 其他路径，且监听 `will-frame-navigate` 学习以后从受信子页面发起的精确 OAuth 回调。官网最终授权/持久登录仍需新进程实测。

## v0.5.10 网页级定位京东入口
通过新 AI 网页调试器读取实际京东 open Shadow DOM 的“微信登录”按钮，捕获 `Page.frameRequestedNavigation` 指向 `https://qq.jd.com/new/wx/login.action`。此前只允许 callback，遗漏扫码前的这条入口，表现为按钮点后没有跳转。新增 `jd.trustedAuthPaths` 的精确入口，保留精确 callback，其他路径不开放。当前真实源码预览已经观察到 login.action → open.weixin.qq.com/connect/qrconnect，页面提示“使用微信扫一扫登录 京东商城”，不把二维码打开算作已登录。diagnostic 增加 pathname，但查询参数不记录。网页级操作及跨域/Shadow DOM 回归见 `ai-browser.md`。

本人第一次在独立 passport 页扫码后，真实诊断显示被带向 `https://www.jd.com/`，校招未登录；该页面脱离了校招登录上下文。校招 login 改回官网外层 `https://campus.jd.com/#/resume?type=present`，保留网站自己生成的 passport iframe；当前网页级工具已观察到微信扫码页在子框架内导航、校招父页面保持原路由。未开放商城首页替代正确回跳；新的本人扫码授权和持久性继续核对。

最新真实验收：保留校招父页面的微信授权仍回向商城首页且被拦截，校招未登录。官网 ReturnUrl 已回读正确；顶层认证 popup 对照正在进行。登录完成和重启持久性均未确认，离线通过不作为账号成功证明。

## v0.5.11 自动扫码回跳
用户现场说明：扫码后手机直接提示登录，不存在固定的“允许”按钮。旧版内存诊断确认 iframe 和 popup 的最终 www.jd.com 根路径均被拦截，重开校招未登录。现仅放行该已观察的精确落地路径；只有合法 campus ReturnUrl、QQ callback、落地页面完成加载三者齐全，才一次性同步校招官方 login-callback。保留同一持久会话，不改 Cookie 属性；auth-return-resume 表示回跳处理，不表示认证成功。源码预览已升级 0.5.11，真实扫码验收与脱敏跳转跟踪进行中。见 verification/2026-09-30-jd-auto-return。

本轮最终离线回归：原生32项在v0.5.10备份为26通过/6失败，当前v0.5.11为32/32；覆盖自动iframe/popup回跳、父页同步和Cookie保留。真实登录回执不由该离线结果代替。

## 2026-10-02 v0.5.12 稳定性
补工作区身份绑定与关闭合并；京东回调加载失败保留弹窗。9月30日记录未获得v0.5.11真实扫码回执，10月2日接续时预览已停止，不能推断已登录。最新验收见 progress/2026-10-02-mvp-hardening.md。

## v0.5.13 原框架HTTPS回跳
实测证明旧升级逻辑把iframe的HTTP302回调交给主WebContents.loadURL，替换校招父页面。新增frame-navigation，依据isMainFrame/frame或processId/routingId只升级原框架；不存在的frame保留父页并记录失败，不猜测主页面。官网原生匿名流程显示微信应用名“京东商城”而父页保持campus.jd.com；这是应用名，不是招聘目标。见 progress/2026-10-02-jd-frame-fix.md。

## v0.5.14 现场loginRelay
真实扫码发现qq.jd.com/new/wx/loginRelay.action缺失，补精确路径；父页面已保持。原生回归覆盖HTTP302中转，账号登录及持久性仍按官网回读验收。

## v0.5.15 延迟扫码计时
JD tracker 只在首个实际 callback 到达后开启 10 分钟回跳 TTL；等待用户扫码不消耗这个时限，重复 callback 不续期。官网二维码自己的有效期保持不变。真实 v0.5.14 扫码仍未建立软件校招会话，手动官方 callback 恢复也未登录；真实浏览器已有登录态，软件无认证 Cookie，未复制值。完整证据见 [延迟扫码验收](../progress/2026-10-02-jd-delayed-auth.md)。
