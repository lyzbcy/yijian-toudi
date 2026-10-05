# 京东延迟扫码与登录态对照 · v0.5.15
现状：回跳计时修复候选；软件真实登录与重开保持尚未验收成功。
负责人：项目维护者。
最后更新：2026-10-02。

## 现场失败，不计为成功
- v0.5.14 本人扫码：13:55:14 UTC 主框架到 QQ callback，服务器 302 到商城根页；商城显示页面异常。没有 auth-return-resume 诊断。
- 本轮扫码时间距二维码入口已超过 10 分钟。旧 tracker 把等待本人扫码时间算进回跳 TTL，因此即使新 callback 到达，也不会处理回跳。单测以虚拟时钟等待 11 分钟稳定复现，3/4 通过、1/4 失败。
- 同会话只执行一次官方 campus login-callback 恢复核验，仍回到未登录简历页，未观察到 pin/unick/pt_pin。此结果证明只修回跳路由不能宣称认证完成。
- 14:07 UTC 使用 Kimi WebBridge 检查真实浏览器官网：校招简历页无“登录”入口，有基本信息/简历附件，存在 pin/unick；软件仍有“登录”入口且无上述认证 Cookie。外部浏览器成功不代表软件成功，也不证明两处会话账号相同。本轮未导入、复制或修改 Cookie 值。
- 既有 trace 的 DomainMismatch 来自不同子域 Cookie，不作为认证失败根因；未观察到 SameSite/第三方 Cookie 拦截证据。

## 修复
`electron/jd-auth-return.cjs`：二维码入口只登记经过精确校验的 campus ReturnUrl，不提前启动 handoff TTL；首个实际 QQ callback 到达后，才启用 10 分钟回跳时限。
重复 callback 不续期；无合法入口、无 callback、过期、错误商城路径均不执行；消费一次后清空。工作区关闭会销毁本工作区 tracker。此修改不绕过官网二维码有效期，不重放 OAuth code，不把二维码扫描或回跳诊断当成已登录。

## 验收与下一步
完整后台首跑在批量按钮测试遇到 fixture 注册竞态：Electron loadURL 返回后 Playwright 尚未收到 window，立即 app.windows().find 返回 undefined。测试改为创建前等待 window 事件，随后等实际 data URL；不更改业务代码或放宽验收断言。首跑失败日志单独保留，完整后台重新执行。
回归和回滚记录：`verification/2026-10-02-jd-delayed-auth/VERIFICATION.txt`。
已观察：单测 281/281；京东原生离线 34/34；同框架回跳 5/5；批量按钮 6/6；介绍页 brokenImages=[]、overflow=0；App/Skill 均为 0.5.15，Skill 压缩包内版本已回读。
延迟扫码用例修改前 3/4、修改后 4/4；单独副本回滚后 3/4，原超时行为复现，11 个原文件 SHA256 全部一致。实际源码保持修复版。
继续使用 AI 网页控制读取同会话主页面/iframe/popup，保留脱敏 Document 跳转与 Cookie 拒收原因；修复版新扫码后必须由校招真实账号状态与关闭重开验证成功。无认证回执时停止标记成功，不进行最终保存/投递。
安装包、完整软件登录闭环、发布与低于 1% 的实测失败率分别验收；单测通过不是这些结论的证据。

## 下次接续提示词
```text
先读本页和 verification/2026-10-02-jd-delayed-auth/VERIFICATION.txt。
用 scripts/ai-browser.cjs list 核对运行版与明确 targetId，读取 live-trace.jsonl 最新 callback/回跳结果。
读取同会话 campus 主页面、iframe 和 App diagnostics；不可将已扫码、auth-return-resume 或外部浏览器已登录记成软件登录。
只有真实校招显示已登录且关闭重开保持，才完成京东登录验收；若仍失败，记录官网可见错误和脱敏跳转，停止盲目重复扫码。
不要保存/投递，不导入外部浏览器 Cookie，不重放 OAuth code。
```
