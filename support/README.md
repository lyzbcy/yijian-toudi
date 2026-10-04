# 通用反馈服务部署

现状：独立 Node20+ 服务，零第三方运行时依赖；真实 HTTPS 公网和企业微信发送仍需验收。
负责人：一键投递维护者
最后更新：2026-10-04

## 完整部署包

`pnpm pack:feedback` 生成同版本 `yijian-toudi-feedback-server-<版本>.tar.gz` 和 `.sha256`。解压后根目录为 `yijian-toudi-feedback-server/`，共 11 个文件：版本信息、本说明、服务、三个 electron 依赖，以及环境变量、Caddy、systemd、Dockerfile、Compose 五个模板。无需桌面会话、招聘账号、简历或 npm install。

先在源码开发机用 `node scripts/package-feedback.cjs --verify ARCHIVE CHECKSUM VERSION` 校验；服务器可用 `sha256sum -c yijian-toudi-feedback-server-<版本>.sha256` 后解压。历史同版本包不可改写，修订代码后递增版本。

## 直接运行

在部署根目录执行以下命令，真实值只填在服务器，禁止把密钥写入安装包、Git 或公开截图：

```sh
export YJT_FEEDBACK_PUBLIC_URL='https://你的域名/'
export YJT_FEEDBACK_WEBHOOK='你的私有企微机器人链接'
export YJT_FEEDBACK_DATA='/var/lib/yijian-feedback'
export PORT=8096
node support/feedback-server.cjs
```

Windows PowerShell 使用 `$env:变量名='值'`，数据目录改为服务账号可写的绝对路径。成功启动只输出回环端口，不输出 webhook。程序只监听 `127.0.0.1`。GET `http://127.0.0.1:8096/healthz` 返回服务名称和部署包版本；健康读取不消耗发送限额。此响应只证明 HTTP 进程可响应，不证明存储持续可写、企微送达或公网连通。

## Linux systemd 与 HTTPS

1. 安装 Node20+，确认 `/usr/bin/node --version`；实际 Node 路径不同需修改 ExecStart。
2. 将解压目录放到 `/opt/yijian-toudi-feedback-server`，代码由 root 持有且服务不可写。
3. 复制 `support/deploy/feedback.env.example` 到 `/etc/yijian-feedback.env`，填写真实域名与 webhook，保持数据路径 `/var/lib/yijian-feedback`，设为 root 所有、权限 600。
4. 复制 `support/deploy/yijian-feedback.service` 到 `/etc/systemd/system/`，执行 `sudo systemctl daemon-reload`、`sudo systemctl enable --now yijian-feedback`。DynamicUser 与 StateDirectory 创建受限的持久目录。
5. 用 `sudo systemctl status yijian-feedback`、回环 healthz 核对版本及启动；查看 journal 时不要公开环境配置。
6. 配置域名 DNS 和公网 443，安装 Caddy；将 `support/deploy/Caddyfile.example` 的无效占位域名换为真实域名，再校验配置并 reload。

模板将 `X-Forwarded-For` 覆盖为 Caddy 实际连接方 IP。只有明确启用 `YJT_FEEDBACK_TRUST_PROXY=1` 且连接来自回环时，服务才采用有效的转发 IP。不要把用户提供的头原样转发；若前面还有 CDN，这里会按 CDN 出口限流，需要另行设计可信边缘限流。默认不信任头，反代访问共享同一回环限额。不要直接将后端端口对公网开放。

## Linux Docker Compose 备选

需要 Linux Docker Engine、Compose 和同主机 Caddy；本模板使用 host networking，不能直接当作 Windows/macOS Docker Desktop 配置。

```sh
cd /opt/yijian-toudi-feedback-server/support/deploy
cp feedback.env.example feedback.env
chmod 600 feedback.env
# 在本机安全编辑 feedback.env，填写真实值后再启动。
mkdir -p feedback-data
sudo chown 1000:1000 feedback-data
chmod 700 feedback-data
docker compose up -d --build
docker compose ps
curl --fail http://127.0.0.1:8096/healthz
```

容器以 Node 镜像的 uid1000 用户运行，代码文件系统只读，数据绑定到 `feedback-data` 并跨重启保留，后端仍只监听主机回环；Caddy 配置同上。不要在同一个端口同时启动 systemd 和 Docker 实例。systemd/Caddy/Compose 模板尚未在真实 Linux 生产服务器执行，使用前需要现场验证权限、重启、TLS、备份与负载。

## 协议、保留与失败恢复

- `POST /v1/feedback`：UUIDv4 requestId、版本、kind=bug/review、category（可空）、message、可选 logs；最多 32KiB，每客户端 IP 每分钟 10 请求。收据与日志读取也计限额，healthz 除外。
- 保留 1000 字符单位完整备注；按 UTF-8 字节选择 text/markdown。完整信封超过4096字节或 Unicode 非法时在发送记录落盘前拒绝，不静默截断。
- 服务先持久记录 sending，再通知企微；官方 errcode=0 才返回 sent。相同 ID/同内容不再次通知；同 ID/不同内容拒绝。
- `GET /v1/feedback/<requestId>` 只回状态/日志链接，不回留言。客户端超时先查收据；unknown/sending 不自动重发，先人工核对群回执。不要删收据解除去重。
- `GET /diagnostics/<随机256位标识>.txt` 只读脱敏结构日志，7天到期，返回 text/plain、nosniff、noindex、no-store。用户取消附加日志则不创建链接。
- 启动前和每小时清理过期结构日志；无法读取日志目录则启动失败。畸形、无关文件和符号链接保留供排查。所有收据永久保留，包括 unknown/sending；磁盘预算和备份需包含收据。
- SIGINT/SIGTERM 关闭 HTTP 服务，最长10秒退出；正在发送时意外退出可能留下 sending，重启后继续去重且需人工核对。systemd/Docker 停止宽限为20秒。
- `YJT_FEEDBACK_ALLOW_LOCAL=1` 仅用于回环测试，PUBLIC_URL 为 http://127.0.0.1:端口/。本机日志链接不能证明粉丝可访问。

升级前备份整个数据目录和私有环境文件；停服务后复制 receipts/logs，再切换代码并启动，保留回滚版本。不得覆盖/重置去重收据。备份同样含私有信息，限制权限，不上传公开仓库。

## 分发前的真实验收

App 设置 `feedbackEndpoint=https://真实域名/v1/feedback`。从另一台公网客户端发送明确标记测试的反馈，核对群里的版本/完整留言、官方回执、外网日志长链接；再验证取消日志、断网后查收据、服务重启防重、限流与备份恢复。健康端点和离线通知样本不能代替此验收。

服务包不包含实际 feedback.env、数据、群密钥、简历或 Cookie。App 未配置服务地址时明确提示；仓库不内置虚假正式域名。个人投递企微通知由 App 本机配置，开发者反馈 webhook 由服务端配置，两者独立。

