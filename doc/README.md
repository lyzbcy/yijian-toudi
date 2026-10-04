# 一键投递 · AI Memory

53腾讯校招隔离草稿27控件最终一致、37项人工；26文本DOM相等，其中24个已检查Vue模型相等，133无关控件保留。397单测/27套后台通过，Windows125源文件匹配、实际52→53升级8检查及旧中文附件七平台4/6离线队列通过。学校/学历/日期及官网保存待验；52Mac双架构已回读并追加原52草稿18资产，首次Intel上传失败保留。完整交付与整体低于1%未证明。

这里是项目的渐进式维护入口。先读本页，再按当前任务进入对应文档，不需要一次性加载全部资料。

## 当前状态



- 当前为 **v0.5.53 接续开发候选，未正式发布**，修复旧附件名、补独立作者页及Windows视觉调整，百度/阿里隔离草稿、京东52学校已核对；字节/小米可见隔离窗口读到表单，53腾讯结构/语言隔离填写及Windows包已验；52Mac双架构已回读并备份，53原生/完整交付验收继续进行；45封存包/视频保留原版。运行代码从v0.5.33 ASAR校验恢复；原设备聊天/会话不可访问。当前事实与交付门槛以[接续进度](progress/2026-10-04-recovery-delivery.md)和[当前验收矩阵](development/mvp-acceptance.md)为准。以下v0.5.15等条目保留为历史来源，不能当作当前完成状态。

- v0.5.15 京东延迟扫码：[计时修复与真实登录态对照](progress/2026-10-02-jd-delayed-auth.md)。

- v0.5.14 京东真实loginRelay中转补齐，接续 [父子框架验收](progress/2026-10-02-jd-frame-fix.md)。

- v0.5.13 京东父子框架回跳：[修复与现场验收](progress/2026-10-02-jd-frame-fix.md)。

- v0.5.12 Windows 稳定性候选：[本轮修复与验收](progress/2026-10-02-mvp-hardening.md)。

- v0.5.11 京东自动扫码回跳候选：精确 SSO 落地页与父工作区同步，见 [京东验收](progress/2026-09-30-jd-login.md)。

- v0.5.10 同会话 AI 网页调试：随机本机 CDP、DOM/Shadow DOM、iframe/popup、JSON 请求文件与成对 bat 启停；见 [integrations/ai-browser.md](integrations/ai-browser.md)。

- v0.5.10 京东真实扫码后 `qq.jd.com` 回跳和子页面 OAuth 学习修复：[京东登录验收](progress/2026-09-30-jd-login.md)。

- v0.5.7 Windows 本地源码预览：[本地开发说明](../zeen-tools/本地开发说明.md)。

- v0.5.6 现场回跳与附件确认修复：[progress/2026-09-29-live-window-fixes.md](progress/2026-09-29-live-window-fixes.md)。

- v0.5.5 登录与上传修复：[integrations/login-upload.md](integrations/login-upload.md)；验收见 [progress/2026-09-29-login-upload.md](progress/2026-09-29-login-upload.md)。

- v0.5.4 批量简历更新：[progress/2026-09-29-resume-batch.md](progress/2026-09-29-resume-batch.md)；选择/全选、历史时间、4/6 平铺窗口。实现设计见 [integrations/resume-batch.md](integrations/resume-batch.md)。

- 2026-09-29 MVP P0 实施与剩余门槛：[progress/2026-09-29-mvp-p0.md](progress/2026-09-29-mvp-p0.md)。工作树 v0.5.3 开发候选，真实投递保持暂停。

- v0.4.0（2026-09-20）：企微通知 + Kimi 桥控制层 + Boss 批量投递引擎（实验）已并入，设置页可配置；详见 [specs/2026-09-19-Boss一键投递与网申自动填写-design.md](specs/2026-09-19-Boss一键投递与网申自动填写-design.md) §9-§10 与 CHANGELOG

- 后台稳定性修复与验收：[progress/2026-09-09-后台稳定性打磨.md](progress/2026-09-09-后台稳定性打磨.md)
- 0.5.0 发布就绪度实测：[progress/2026-09-28-release-readiness.md](progress/2026-09-28-release-readiness.md)

- 工作树版本：`0.5.53 接续开发候选`；最近公开预发布 `v0.5.1`，最近稳定 Release：`v0.3.1`
- 目标平台：Windows 与 macOS；当前机器执行 Windows 实测，macOS 门槛继续保留。
- 可真实使用：本地简历保存、收藏与筛选、QQ 邮箱 IMAP 同步、本机 Agent API、更新检查、真实浏览器入口，以及腾讯、百度、字节跳动、小米、京东、美团岗位抓取；阿里职位与 BOSS 受事实源/平台协议限制仅提供官方手动入口
- 已有安全闭环骨架：腾讯、字节、阿里简历在带退出栏的内嵌工作区进行高置信填写/核对；“全部都要”会拆成社招、校招两个方向逐站处理；保存、验证码和任何申请/投递按钮都由用户本人操作
- 多平台简历同步设计：[plans/2026-08-12-多平台简历同步与职位聚合设计.md](plans/2026-08-12-多平台简历同步与职位聚合设计.md)
- 本轮实现与验证：[progress/2026-08-12-多平台简历同步准确性收口.md](progress/2026-08-12-多平台简历同步准确性收口.md)
- 待完成外部验收与授权：[未决问题.md](未决问题.md)
- 最近进度：[progress/2026-07-25-体验与发布.md](progress/2026-07-25-体验与发布.md)（v0.3 阶段二/三/四：核心闭环 + 10 项体验 + 发布）
- 当前完整落地设计：[specs/2026-07-25-一键投递-完整落地-design.md](specs/2026-07-25-一键投递-完整落地-design.md)

## 按任务阅读

| 要做什么 | 先读 |
|---|---|
| 理解整体架构 | [architecture/overview.md](architecture/overview.md) |
| 开发招聘站自动化 | [integrations/browser-automation.md](integrations/browser-automation.md) |
| 查看支持哪些大厂 | [integrations/大厂清单.md](integrations/大厂清单.md) |
| 速查招聘官网网址 | [招聘官网汇总.md](招聘官网汇总.md) |
| 查简历字段缺口 | [specs/简历字段缺口-2026-07-26.md](specs/简历字段缺口-2026-07-26.md) |
| 部署反馈服务与验证生产门槛 | [integrations/feedback-deployment.md](integrations/feedback-deployment.md) |
| 维护Mac自动更新事务 | [integrations/macos-update.md](integrations/macos-update.md) |
| 维护岗位刷新结果与自动重试间隔 | [integrations/job-refresh.md](integrations/job-refresh.md) |
| 维护软件内作者页与二维码放大 | [integrations/author-page.md](integrations/author-page.md) |
| 维护 QQ 邮箱同步 | [integrations/qq-mail.md](integrations/qq-mail.md) |
| 规划下一阶段 | [development/roadmap.md](development/roadmap.md) |
| 发布 Skill 与云端定时触发 | [../skill/yijian-toudi/references/deploy.md](../skill/yijian-toudi/references/deploy.md) |
| 查看复用经验与坑 | [community/lessons.md](community/lessons.md) |

## 维护纪律

1. 不把演示数据描述成真实抓取结果。
2. 每增加一个招聘网站，必须记录登录方式、字段映射、选择器证据、失败页面、验证码策略和最后实测日期。
3. 最终投递、发送邮件等外部写入动作默认需要用户确认。
4. 登录态、邮箱授权码、简历原文默认只在本机保存。
   Agent 的“脱敏简历”会移除身份号码、联系方式、家庭、合规与邮件正文，但会保留求职所需的教育/工作/项目内容；它不是匿名化公开简历。
5. 修改静态介绍页时，同时递增 `site/index.html` 的 `PAGE_V` 和 `site/version.json` 的 `v`。介绍页与桌面界面共用 `src/assets/` 一份图片源，改二维码/表情只需改一处。
