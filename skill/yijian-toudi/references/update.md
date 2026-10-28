# 每日首次静默更新

Node20+。从**安装主目录**调用`scripts/use.cjs`或`scripts/daily-boss.cjs`；两者先固定本次有效版本，再启动隐藏后台检查。本次进程沿用旧版快照，不等待下载；新版供下一次调用使用。

主目录作为稳定引导器不被更新任务重命名；新包写入独立版本缓存，校验所有文件后原子替换`current.json`指针，旧缓存不自动删除，避免打断当前使用。`use.cjs`输出的`version/root/instructions/deployment`才是当前有效版本与文档；主目录`version.json`标记引导器出厂版本。后续命令仍走输出的`dailyScript`（主目录入口），不要把缓存目录当另一个安装目录重复启动更新。

默认匿名检查`lyzbcy/yijian-toudi`公开Release，稳定通道排除draft/prerelease；可设置`YJTD_SKILL_CHANNEL=preview`显式含测试版。仅数字版本升级，不降级。必须同Release有精确命名的Skill tar.gz与.sha256；校验归档大小、SHA、可选GitHub digest、协议1、版本、Skill名、路径/类型、必需文件，下载HTTPS显式验证TLS。通用镜像可用`YJTD_SKILL_RELEASES_URL`，须提供相同Release JSON格式和同源HTTPS资源；fork可用`YJTD_SKILL_REPO=OWNER/REPO`。

状态在`YJTD_STATE_DIR/updates/<安装目录标识>/`，默认`~/.local/state/yijian-toudi-skill/`。按上海日期每天首次检查，attempt与success分开记；失败本日不反复请求、次日再检查，指针不变继续旧版。有效PID锁不凭时间强拆；退出/失去进程后下一次可接续。后台进程只继承运行所需和更新配置变量，不继承API Token、企微密钥或NODE_OPTIONS；更新不会请求投递API。

`YJTD_SKILL_AUTO_UPDATE=0`关闭检查。公开CLI不打印后台状态；排障查看本机`state.json`。`YJTD_SKILL_TEST_LOCAL=1`仅用于本机HTTP验收，正式镜像仍使用HTTPS。

桌面/Skill版本仍成对使用。Skill后台更新不升级桌面；若下一次桌面版本尚未匹配，有意返回version mismatch，不自动投递。首次安装旧的无引导器Skill需手动安装新包；旧版本本身没有本机制，不宣称可以自动升级到它。
