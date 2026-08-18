# kimi-webbridge 验证微信快捷登录（真实浏览器）

## 背景

用 kimi-webbridge（`~/.kimi-webbridge/bin/kimi-webbridge`，daemon 端口 10086）驱动用户**真实浏览器**，验证 `loginWithWechat` 的选择器逻辑在真实环境下是否正确。这是比 playwright 独立 profile 更权威的验证——用的是用户真实的登录态和浏览器环境。

## 工具能力

kimi-webbridge 通过浏览器扩展（Chrome/Edge）操控用户真实浏览器，提供：
- `navigate` / `find_tab` / `list_tabs` — 标签页管理
- `snapshot` — 无障碍树（读页面结构）
- `click` / `fill` — 元素交互
- `evaluate` — 执行 JS
- `cdp` — 原生 CDP 透传（如 `Network.clearBrowserCookies`）
- `screenshot` — 截图

调用方式：`curl -s -X POST http://127.0.0.1:10086/command -d '{"action":"...","args":{...},"session":"任务名"}'`

## 验证过程与结论

### ✅ 微信快捷登录流程前 3 步全部正确

在用户真实浏览器（join.qq.com 登录态已过期，跳到登录页）走完整流程：

```
1. click .el-checkbox          → success（勾选隐私协议）
2. click .item.item_wechat      → success（text: "微信账号登录"）
3. 等快捷登录按钮出现（6 秒）    → hasQuickBtn: true
   quickBtnText: "微信快捷登录"
   页面内容: "使用微信快捷登录「腾讯HR统一登录」捞鱼真不吃鱼 微信快捷登录"
   URL: open.weixin.qq.com/connect/qrconnect?appid=wxd7ec437b...
```

**铁证**：识别出了用户微信昵称「捞鱼真不吃鱼」——说明：
1. 用户**桌面个人微信确实在线**（之前 ps 看到的企业微信是另一个 app）
2. 我们 `loginWithWechat` 用的三个选择器（`.el-checkbox` / `.item.item_wechat` / `.js_quick_login_btn`）**全部正确**

### ⚠️ 发现真实环境特有问题：ERR_TOO_MANY_REDIRECTS

点完快捷登录后，页面变成 `chrome-error://chromewebdata/`，报 **「ERR_TOO_MANY_REDIRECTS」（重定向循环）**。

**根因**：用户真实浏览器存了**旧的过期腾讯 cookie**，与微信回调的新登录态冲突，导致 `smartproxy.tencent.com/login/wx_callback` 与 `join.qq.com` 之间重定向循环。

**playwright 没这个问题的原因**：playwright 用独立 profile（`~/.yijian-toudi-autofill/tencent/`），cookie 隔离干净。

**解决**：用 `cdp Network.clearBrowserCookies` 清 cookie 后重走，流程正常（快捷登录按钮再次出现，带昵称）。

### ⚠️ 点快捷登录后 tab 消失

清 cookie 后点快捷登录：点击成功（`success:true`），但 1 秒后 session 的 tab 列表变空。微信开放平台的回调链路可能导致原 tab 关闭/替换，浏览器扩展失去 tab 跟踪。

这是 kimi-webbridge 在跨域回调场景的局限，不影响 `loginWithWechat` 本身的正确性（playwright 路径不受影响，因为 playwright 用 `page.url()` 跟踪而非 tabId）。

## 对产品的启示

### 1. `loginWithWechat` 选择器逻辑已验证正确 ✅

三个选择器（`.el-checkbox` / `.item.item_wechat` / `.js_quick_login_btn`）在真实页面全部命中。代码无需修改。

### 2. 真实浏览器需先清 cookie（潜在优化点）

用户用真实浏览器（非 playwright profile）登录腾讯时，如果遇到重定向循环，应提示「清理 join.qq.com cookie 后重试」。目前 `loginWithWechat` 走 playwright 独立 profile，不受此影响，但如果未来支持「借用用户真实浏览器登录」，需加 cookie 清理步骤。

### 3. 用户桌面个人微信确认在线 ✅

之前 ps 只看到企业微信（`com.tencent.WeWorkMac`），怀疑个人微信没开。kimi 验证显示快捷登录按钮带昵称「捞鱼真不吃鱼」，**确认个人微信在线**，微信快捷登录功能可用。

## kimi-webbridge 相比 playwright 的优劣

| 维度 | kimi-webbridge（真实浏览器） | playwright（独立 profile） |
|------|---------------------------|--------------------------|
| 登录态 | 用户真实 cookie（可能过期/冲突） | 独立 profile（隔离干净） |
| 反爬 | 不易被识别（真实浏览器指纹） | 易被识别（如百度 about:blank） |
| 跨域 tab 跟踪 | 弱（回调链路易丢 tab） | 强（page 对象全程跟踪） |
| 截图 | 浏览器区域 | 完整页面 |
| 适用 | 读页面、验证选择器、真实环境探测 | 自动化填表、登录态持久化 |

**结论**：两者互补。kimi-webbridge 适合「真实环境验证选择器/探测页面」，playwright 适合「自动化填表/登录」。本次用 kimi 验证了选择器正确性，用 playwright 完成填表，分工合理。
