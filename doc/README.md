# 一键投递 · AI Memory

这里是项目的渐进式维护入口。先读本页，再按当前任务进入对应文档，不需要一次性加载全部资料。

## 当前状态

- 版本：`0.3.0 内测版`
- 目标平台：macOS（Electron，架构保留 Windows 打包能力）
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
| 维护 QQ 邮箱同步 | [integrations/qq-mail.md](integrations/qq-mail.md) |
| 规划下一阶段 | [development/roadmap.md](development/roadmap.md) |
| 查看复用经验与坑 | [community/lessons.md](community/lessons.md) |

## 维护纪律

1. 不把演示数据描述成真实抓取结果。
2. 每增加一个招聘网站，必须记录登录方式、字段映射、选择器证据、失败页面、验证码策略和最后实测日期。
3. 最终投递、发送邮件等外部写入动作默认需要用户确认。
4. 登录态、邮箱授权码、简历原文默认只在本机保存。
   Agent 的“脱敏简历”会移除身份号码、联系方式、家庭、合规与邮件正文，但会保留求职所需的教育/工作/项目内容；它不是匿名化公开简历。
5. 修改静态介绍页时，同时递增 `site/index.html` 的 `PAGE_V` 和 `site/version.json` 的 `v`。介绍页与桌面界面共用 `src/assets/` 一份图片源，改二维码/表情只需改一处。
