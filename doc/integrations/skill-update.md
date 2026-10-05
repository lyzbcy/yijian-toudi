# Skill 每日静默更新
现状：source24本机候选；真实新公开版本升级、云端调度待验收
负责人：项目维护者
最后更新时间：2026-10-04

## 原因与入口
满足项目自包含规范 `reference/software-development/skill 组件/skill 静默更新.md`：每日首用自动检查，本次不等待、不打断，失败继续旧版、次日再查。不是桌面自动更新器，也不操作浏览器或投递接口。

每次从安装主目录调用 `scripts/use.cjs`；返回有效 version/root/instructions/deployment/dailyScript。主目录只作为稳定引导器；`version.json` 是其出厂版本，不等于升级后的有效版本。每日命令仍调用返回的主目录 dailyScript，它把整套入口/业务引擎委派到有效版本，而非只替换一个模块。

## 模块与状态
- bootstrap：规范安装标识、校验指针与完整缓存文件、固定本次快照；隐藏 detached/unref 子进程，仅继承更新配置，不传 API/企微秘密。
- update-worker：上海日期 attempt/success 分记、PID/token 排他锁、下载校验与缓存提交。活进程锁不以时间强拆；确认ESRCH才恢复。当天失败不连刷，次日重试。
- release-source：数字版本比较；默认匿名公开 stable，preview 显式开启；精确资产名、HTTPS/TLS、跳转源、大小与20秒总超时限制。
- package-files：11必需文件，tar头/路径/类型/重名/协议校验；写入独立 staging，完成验证后改名为不可变版本槽；再原子替换 current.json。旧槽不删除，在途调用继续旧快照。
- boss-engine：原业务版本/账号/上限/每日防重；requiresReview在写标记和POST前停止。更新不越过这个停止条件。

状态默认 `~/.local/state/yijian-toudi-skill/updates/<安装目录标识>/`；YJTD_STATE_DIR可设私有持久目录。配置、禁用和镜像格式详见包内 `references/update.md`，不把用户密钥写进发布资源。

## 发布与验收
先准备draft全套桌面/Skill/校验资产、读回验证，再publish。工作流手动分支仅上传已有draft；published分支只下载审计，不晚补包。package-skill拒绝覆盖归档，--verify要求源/预期版本一致并验证真实资源。

34个静默更新回归覆盖下载失败/哈希错误/旧版本/锁/事务错误/保持旧快照/完整新版入口/后台不阻塞。约1.7秒慢HTTP使用的是本机测试资源，不是公众新release。真实archive解包运行与匿名官方元数据另见progress；全量回归和实际安装求职闭环分开记。

不能把默认目录version.json仍旧说成没升级，也不能把Skill已更新说成桌面已升级。版本不同业务暂停，用户配对更新后再演练。旧版无引导器须手动首次安装；不宣称23会自行装24。

```text
接续Skill验收：从SKILL.md进入本文件及progress/2026-10-04-skill-update.md。
先校验已有archive，勿覆盖；用隔离STATE_DIR从真实包运行use/daily入口。
公开源只读检查，记录实际tag/状态；本机未来版fixture另列，不冒充公网更新。
证明当前调用不等待、旧快照保留、下次整套入口生效，失败不丢旧版。
发布仍须真实Windows安装升级、账号保存/申请回执与公网反馈完整验收。
```
