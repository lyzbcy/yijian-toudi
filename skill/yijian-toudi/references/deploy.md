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

## 3. Boss账号、演练与定时

先GET `/v1/boss/accounts` 与 `/v1/boss/batch/status`，核对指定账号身份、旧runId/pending及空闲状态；POST `/v1/boss/batch/start` 明确 accountId/target/dryRun。客户账号单次上限50，default自用上限120；先演练再在用户授权内正式执行。previewed不等于applied。遇access-restricted/security-check/login-required/search-mismatch/send-unverified/persist-failed等停止该账号后续日程，按网站恢复时间等待，不反复刷新。

requiresReview=true先报告stopReason/runId/pending；用户完成复核后才可POST `/v1/boss/batch/resolve`，携带当前runId与action=acknowledge-and-skip-unknown。它只解除暂停，未知公司仍跳过、不计成功、不自动启动。running/stopping=true时等待收尾。

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

### 异常启动、跨日防重与账号互斥

`YJTD_DRY_RUN=1`才是演练；`0`或未设置是正式，`true/false/yes/01`等其它值明确报错，不静默变成正式。API不跟随重定向。任务status须有明确布尔值`running/stopping/requiresReview`；停止中、待复核或未知pending不启动新任务。成功启动回执须同时确认`accountId/target/dryRun/runId`，不是最终投递数量。

正式请求前写`YYYY-MM-DD-账号.json`私有标记；收到完整回执后才从`starting`改为`started`。回执丢失、错误模式、缺runId或标记损坏/旧标记回执不完整时，即使到了次日也返回`{"skipped":"unconfirmed-start","marker":"具体文件名"}`，不发新的启动请求，演练也暂停。不同账号的标记互不影响。停止任务不删除防重记录。

收到`unconfirmed-start`后，先读取APP的batch状态、runId、pending及实际已投/未知账本；对未知岗位按APP明确复核流程处理，不重发。用户完成复核、确认允许继续之后，备份并移走输出指向的那一个私有标记，再重新核对账号/版本/登录态及日程。不要批量删除标记或设置定时自动清理；完整`started`标记当天仍防重，翌日允许下一次。标记缺失的旧任务依然以APP账本/待复核状态为准。

账号级`launch-账号.lock`覆盖状态读取、标记扫描、POST与回执落盘，两个触发进程不能跨日期各自拿着旧扫描发送。锁冲突返回`start-locked`和锁文件名；锁不因时长而自动删除。正常结束仅释放本次ownerToken匹配的锁。脚本崩溃遗留锁时，先确认没有仍运行的触发进程并核对APP实际账本，再由用户备份移走输出指定的锁。移锁不清除独立的`starting`记录，也不授权重新投递未知岗位。历史target为0、负数或超出本账号上限时视为未确认。

## 4. 版本发布

仓库 `pnpm pack:skill` 生成与 `package.json` 同版本的 Skill tar.gz 和 SHA256，已存在归档不覆盖。先创建draft，上传桌面/Skill/校验资源、读回校验，再publish版本；`release-skill.yml`的workflow_dispatch只往现有draft准备Skill，published只下载审计不事后补包或覆盖。应用版本和 Skill 应成对升级、校验、演练；不匹配时暂停投递，不自动升级桌面。

## 普通APP原生工作区诊断
APP与有效Skill版本相同后，`node scripts/workspace-status.cjs`读取已有工作区状态；复用私有YJTD_BASE_URL/YJTD_API_TOKEN与既有SSH回环隧道，不需要或开启浏览器调试端口。结果不含表单值，usable=false表示blank/登录/验证/无表单/读取不可用等当前状态；不要依据旧回读或目标数量记已保存/投递。脚本不打开页面，不在版本不符时继续业务。

## 桌面WebBridge接入（0.5.45）
APP现在作为官方daemon HTTP客户端复用127.0.0.1:10086/command，不另建同端口WebSocket。先安装官方WebBridge/浏览器扩展；APP设置页重连只重建客户端，普通正式APP可启动已安装官方binary，不关闭浏览器或停止daemon。云端仍通过既有SSH回环隧道访问APP API，云端Skill不拥有桌面浏览器登录态。连接成功不当投递；先只读状态与dryRun，官网限制时停止。

## 0.5.59 任务历史提示
APP重新启动后，旧执行中/旧网页等待任务会标为interrupted；定时Skill必须读取实际Boss status与去重账本，不以历史任务状态推定已投递或自动重发未知回执。运行APP/有效Skill版本必须匹配；升级前保留档案，旧任务不自动续做。

## 0.5.72 公众反馈机制（0.5.73沿用）与Skill部署边界

Skill沿用上述私有环境/回环隧道与同版本检查；无需持有开发者企微密钥。发布者在桌面构建前配置公共反馈URL，步骤见仓库support/README.md。APP页设置支持自部署地址/主动清空，未知反馈仍查旧地址不重发。当前源码候选默认URL为空，公共URL检查失败，不宣称粉丝反馈已可送达；published工作流仅事后审计，公开前仍须手动核对资产与真实公网回执。

## 0.5.73 桌面筛选体验
桌面城市/收藏筛选不会提交岗位；公司、排序、搜索可组合。Skill部署/SSH/每天10点触发流程不变，运行APP与Skill须同版本；布局修复与受控SAMPLE回归不是官网成功或投递授权。包准备与后续Windows/公网验收分列，以仓库进度为准。

## 0.5.74 简历目录
桌面目录含11节与AI应用技能，点击只跳转本机表单，不保存或提交。云端SSH/每日10点触发流程沿用上文，运行APP/Skill须同版本；目录SAMPLE回归不代表云部署、官网简历或真实投递成功。候选测试见仓库本轮记录。

## 0.5.75 核对报告
报告关闭后不参与页面布局，打开仍走本机核对；不增加官网自动保存权限。云端安装/SSH/每日10点触发与同版本APP规则不变，APP须在已登录桌面运行。受控SAMPLE报告与真实官网/公网交付分列，以本轮进度为准。

## APP退出与连接中断（76）
软件关闭时先停止新写并等待已开始请求，未完连接不会无限阻塞退出。云端遇断连或503/agent_api_stopping，应保留runId/幂等键，待应用重开先查询旧状态/回执；未知结果不计成功、不换键重发。该说明不代表云端已部署或官网已投递。

退出等待最多2秒处理连接，不保证长业务已经结束。此前已受理的请求可能仍是pending/未知；软件重开后核对原记录，不能把网络断开或退出当成功，也不换键重发。
