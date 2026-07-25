# 一键投递 · AI Memory

这里是项目的渐进式维护入口。先读本页，再按当前任务进入对应文档，不需要一次性加载全部资料。

## 当前状态

- 版本：`0.2.0 内测版`
- 目标平台：macOS（Electron，架构保留 Windows 打包能力）
- 可真实使用：本地简历保存、收藏与筛选、QQ 邮箱 IMAP 同步、本机 Agent API、更新检查、真实浏览器入口，以及腾讯、百度、字节跳动、小米、京东、美团岗位抓取
- 已有安全闭环骨架：腾讯简历填写与投递在可见工作区运行，最终保存/提交由用户确认；无真实账号的自动验证不冒充真实投递成功
- 待完成真实验收与扩展：腾讯真实账号验收、其他平台简历/投递、投递状态刷新
- 最近进度：[progress/2026-07-25-腾讯闭环深化与复查修复.md](progress/2026-07-25-腾讯闭环深化与复查修复.md)（v0.3 阶段一：腾讯字段差异报告 + P0/P1 修复）
- 当前完整落地设计：[specs/2026-07-25-一键投递-完整落地-design.md](specs/2026-07-25-一键投递-完整落地-design.md)

## 按任务阅读

| 要做什么 | 先读 |
|---|---|
| 理解整体架构 | [architecture/overview.md](architecture/overview.md) |
| 开发招聘站自动化 | [integrations/browser-automation.md](integrations/browser-automation.md) |
| 查看支持哪些大厂 | [integrations/大厂清单.md](integrations/大厂清单.md) |
| 维护 QQ 邮箱同步 | [integrations/qq-mail.md](integrations/qq-mail.md) |
| 规划下一阶段 | [development/roadmap.md](development/roadmap.md) |
| 查看复用经验与坑 | [community/lessons.md](community/lessons.md) |

## 维护纪律

1. 不把演示数据描述成真实抓取结果。
2. 每增加一个招聘网站，必须记录登录方式、字段映射、选择器证据、失败页面、验证码策略和最后实测日期。
3. 最终投递、发送邮件等外部写入动作默认需要用户确认。
4. 登录态、邮箱授权码、简历原文默认只在本机保存。
5. 修改静态介绍页时，同时递增 `site/index.html` 的 `PAGE_V` 和 `site/version.json` 的 `v`。介绍页与桌面界面共用 `src/assets/` 一份图片源，改二维码/表情只需改一处。
