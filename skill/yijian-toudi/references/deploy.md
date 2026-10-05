# 通用部署：Skill 在云端，应用在已登录的桌面

Skill 包包含操作说明、定时触发器和静默更新引导器，不包含简历、Token、Cookie、浏览器扩展或应用二进制。应用在 Windows/macOS 桌面运行（本轮Windows实测优先，macOS仍须单独构建验收）；云服务器只负责在约定时间通过加密隧道调用本机 API，不承载浏览器登录态。桌面应用、浏览器、Agent API 和到云端的隧道必须在任务期间保持运行。

## 1. 安装同版本 Skill

从同一次 Release 下载 `yijian-toudi-skill-版本.tar.gz` 和 `.sha256`，校验 SHA256 后解压到目标 Agent 的 skills 目录（例如 `$HOME/.codex/skills/`）。包内 `version.json` 应与桌面应用 `/v1/status` 的 `version` 一致。不同 Agent 的目录规则以它自己的文档为准。

```sh
tar -xzf yijian-toudi-skill-VERSION.tar.gz -C "$HOME/.codex/skills"
cat "$HOME/.codex/skills/yijian-toudi/version.json"
node "$HOME/.codex/skills/yijian-toudi/scripts/use.cjs"
```

每次使用先调用use.cjs取得有效版本/文档路径；每天首次后台检查，不等待。本次固定旧快照，新版供下次调用，失败继续旧版。主目录作为稳定引导器保留，版本缓存和原子指针在私有STATE_DIR；详见[静默更新](update.md)。首次旧版无引导器包须手动安装24及后续版本；自更新不升级桌面，桌面仍需匹配有效版本。

## 2. 建立仅回环可见的连接

应用在桌面运行并开启 Agent API。桌面到云端建立**反向** SSH 隧道；云端的 15347 转发到桌面的 53147。保持 SSH 会话存活，重连机制由服务器管理员配置。

```sh
ssh -N -o ExitOnForwardFailure=yes -R 127.0.0.1:15347:127.0.0.1:53147 USER@SERVER
```

在云端私有环境配置中设置 `YJTD_BASE_URL=http://127.0.0.1:15347` 和 `YJTD_API_TOKEN`，然后只读检查状态。Token由桌面应用显示，只保存在私有环境配置（文件权限600），不把展开后的值写进命令参数、crontab或日志；以下命令参数仅含环境变量名：

```sh
node -e "fetch(process.env.YJTD_BASE_URL+'/v1/status',{headers:{Authorization:'Bearer '+process.env.YJTD_API_TOKEN}}).then(async r=>{if(!r.ok)throw Error('API status '+r.status);const s=await r.json();console.log(JSON.stringify({version:s.version,ok:true}));}).catch(e=>{console.error(e.message);process.exitCode=1;})"
```
若应用与Skill在同一台机器，跳过隧道，BASE_URL改用`http://127.0.0.1:53147`。远端端口15347在合法TCP范围内；端口冲突时选1～65535范围内未占用端口并同步BASE_URL。

## 3. 先演练，再启用日程

为定时器提供 `YJTD_API_TOKEN`、`YJTD_BASE_URL=http://127.0.0.1:15347`、`YJTD_ACCOUNT_ID=default`、`YJTD_TARGET=100`。先设置 `YJTD_DRY_RUN=1` 并手工运行一次：

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

仓库 `pnpm pack:skill` 生成与 `package.json` 同版本的 Skill tar.gz 和 SHA256，已存在归档不覆盖。先创建draft，上传桌面/Skill/校验资源、读回校验，再publish版本；`release-skill.yml`的workflow_dispatch只往现有draft准备Skill，published只下载审计不事后补包或覆盖。应用版本和 Skill 应成对升级、校验、演练；不匹配时暂停投递，不自动升级桌面。
