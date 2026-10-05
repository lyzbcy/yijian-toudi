# 京东父子框架与loginRelay修复 v0.5.14
现状：真实父页面丢失已复现和修复；本人扫码后的招聘登录验收待完成。
负责人：当前维护任务。
最后更新时间：2026-10-02。

## 根因证据
- 匿名Edge直接从campus.jd.com点击登录和微信，官方二维码确实写“京东商城”，但校招父页保持；记录verification/2026-10-02-jd-url-check/official-flow.json。
- 软件旧view曾变成顶层open.weixin.qq.com，父校招页面丢失。
- 原生离线HTTPS站点返回真实HTTP302：iframe从HTTPS跳到HTTP的受信回调时，旧will-redirect用WebContents.loadURL升级HTTPS，误替换主页面；popup中的iframe同样破坏popup父页。
- 本轮原生反例5项：旧版1通过4失败；修复版5/5。不是直接把断言改成商城首页，也不是仅用JS模拟成功。

## 修复
主框架才loadURL；子框架使用原WebFrameMain执行location.replace，保留查询参数和会话。优先事件frame，旧事件用processId/routingId；失效frame记录失败，不改父页。
JS发起的受信HTTP子框架回调也只升级原frame。HTTPS域名策略与拒绝未知redirect保持不变，不开放整个商城。

## 下一步验收
1. 修复版打开真正campus父页中的微信二维码，记录扫码前后frame树。
2. 本人扫码，手机提示已登录即回读招聘官网状态，不要求固定确认按钮。
3. 完成官网回跳与简历/账号页面核验后，关闭重开检查持久性；扫码或Cookie存在不算已登录。
4. 成功后才继续简历上传、解析覆盖、字段回读和官网保存回执；不自动投递。

## 接续提示词
```text
先读本文件与verification/2026-10-02-jd-frame-fix/VERIFICATION.txt。
用ai-browser.cjs读取同一Electron target与子框架，记录document跳转及Cookie被阻止的原因，不记录Cookie值。
扫码后核对父页保持campus、账号/简历状态；关闭重开复核后才登记真实登录成功。
```

## 现场追加：最小化后新工作区尺寸为零
当前App主页面1426×849，但新建内嵌校招页0×0，使微信按钮在viewport之外。补restore/show时重新布局，打开工作区恢复最小化父窗口，0尺寸不覆盖有效bounds。恢复回归旧版7项中1项失败、修复版7/7。重开修复预览后现场内嵌校招页1426×797、微信二维码在子框架，父页仍是campus.jd.com。没有以强制DOM点击绕过看不见的控件。

## v0.5.14 真实扫码后中转补齐
2026-10-02T13:39:17Z记录QQ callback请求，随后13:39:18Z navigation-blocked指向/new/wx/loginRelay.action。此时父页campus保持，证明父框架修复有效，但登录仍未完成。补该精确中转路径；新JD回归使用HTTP302覆盖此链，继续同框架升级。旧版34项基线与新版本结果见VERIFICATION。

## 最终本地结果
全量单测278/278，后台17/17组；JD链路34/34，原框架HTTP升级5/5，窗口生命周期/恢复7/7。
打包版原框架5/5、退出栏正常；ASAR中manager、frame-navigation、manifest SHA256逐字节匹配源码，实际与侧栏版本0.5.14。
NSIS候选：`release-candidate-0.5.14\yijian-toudi-setup-0.5.14.exe`，104141613 bytes，SHA256 `142a52c348e881156f36bc9fb6b1987d98f8886585c3632f8c9f3cc8b6e96b4c`。同版本Skill重读验证成功。
扫码13已真实暴露并修正loginRelay缺失；14当前仍等待本人新扫码，官网认证/关闭重开持久性未成立，不写为登录成功；无保存或投递。
安装/卸载及公开Release未执行。
