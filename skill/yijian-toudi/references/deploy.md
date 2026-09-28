# 通用部署：Skill 在云端，应用在已登录的桌面

Skill 包只包含操作说明与定时触发器，不包含简历、Token、Cookie、浏览器扩展或应用二进制。当前应用主要在 macOS 上运行；云服务器只负责在约定时间通过加密隧道调用本机 API，不承载浏览器登录态。桌面应用、浏览器、Agent API 和到云端的隧道必须在任务期间保持运行。

## 1. 安装同版本 Skill

从同一次 Release 下载 `yijian-toudi-skill-版本.tar.gz` 和 `.sha256`，校验 SHA256 后解压到目标 Agent 的 skills 目录（例如 `$HOME/.codex/skills/`）。包内 `version.json` 应与桌面应用 `/v1/status` 的 `version` 一致。不同 Agent 的目录规则以它自己的文档为准。

```sh
tar -xzf yijian-toudi-skill-VERSION.tar.gz -C "$HOME/.codex/skills"
cat "$HOME/.codex/skills/yijian-toudi/version.json"
```

## 2. 建立仅回环可见的连接

应用在桌面运行并开启 Agent API。桌面到云端建立**反向** SSH 隧道；云端的 153147 转发到桌面的 53147。保持 SSH 会话存活，重连机制由服务器管理员配置。

```sh
ssh -N -o ExitOnForwardFailure=yes -R 127.0.0.1:153147:127.0.0.1:53147 USER@SERVER
```

在云端检查 `curl --noproxy '*' http://127.0.0.1:153147/v1/status -H "Authorization: Bearer $YJTD_API_TOKEN"`。这里的 Token 由桌面应用显示，只保存在云端私有环境配置中（文件权限 600），不放在 crontab 文本、命令参数或日志里。若应用与 Skill 在同一台机器，跳过隧道，改用 `http://127.0.0.1:53147`。

## 3. 先演练，再启用日程

为定时器提供 `YJTD_API_TOKEN`、`YJTD_BASE_URL=http://127.0.0.1:153147`、`YJTD_ACCOUNT_ID=default`、`YJTD_TARGET=100`。先设置 `YJTD_DRY_RUN=1` 并手工运行一次：

```sh
node "$HOME/.codex/skills/yijian-toudi/scripts/daily-boss.cjs"
```

核查应用中的登录态、账号、岗位筛选、dryRun 结果及通知通道。正式运行时移除 `YJTD_DRY_RUN`。在云端设置 `TZ=Asia/Shanghai` 的每天 10:00 日程，命令仍是上面的 Node 脚本。例如支持 `CRON_TZ` 的 cron 可用以下模板；不支持的调度器先将系统时区设为上海，再使用同一时间表达式。`/home/USER/.config/yijian-toudi/env.sh` 是仅本人可读的私有文件，包含 `export YJTD_API_TOKEN='…'` 等变量，权限设为 600：

```cron
CRON_TZ=Asia/Shanghai
0 10 * * * . /home/USER/.config/yijian-toudi/env.sh; /usr/bin/node /home/USER/.codex/skills/yijian-toudi/scripts/daily-boss.cjs >> /home/USER/yijian-toudi-daily.log 2>&1
```

其他 Agent/调度器（包括“小龙虾”）只需在私有运行环境注入相同变量，并在 10:00 调用相同脚本。日志不输出 Token，但要限制日志文件读取权限；不要在计划项文本中明文写 Token。

触发器会为上海日期写入当日防重记录。若 API 不可达、版本不符、账号不存在、已有任务或超过账号上限，它返回非零或跳过，不补投；不要自动重试已开始的正式任务。启动只表示任务已交给应用，最终数量看 `/v1/boss/batch/status` 与应用记录。平台登录或安全验证需要用户在桌面处理。

## 4. 版本发布

仓库 `pnpm pack:skill` 生成与 `package.json` 同版本的 Skill tar.gz 和 SHA256。GitHub Release 发布后，`release-skill.yml` 将同版本 Skill 包附加到该 Release。应用版本和 Skill 包应成对升级、校验、演练；不能把旧版 Skill 直接指向新版 API 后立即恢复定时正式投递。
