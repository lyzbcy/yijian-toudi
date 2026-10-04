# 反馈服务部署验收

当前候选 v0.5.44；完整交付尚未完成。部署入口和协议见 [服务包说明](../../support/README.md)，归档包含 11 个文件，不含实际环境配置、密钥或用户数据。下文39运行记录保持历史版本范围。

## 44隔离备份恢复与并发补验

直接加载封存44归档内的服务模块，Windows本机真实回环HTTP通过4组集成验证。200请求同时发起，按20个明确的代理客户端地址样本、每个默认10次限额运行；通知传输用20毫秒延迟样本，预期180 sent、10 failed、10 unknown全部落盘。每个客户端第11次请求均429，healthz仍可用。并发批次416毫秒完成，p95为382毫秒；此数值只属于本机与该通知样本，不是生产吞吐承诺。

停服务后复制整个数据目录和无密钥的私有配置样本，共401文件；将原目录移离后恢复到全新目录，每文件字节/hash一致。恢复服务读取全部200收据、并发重放原请求均保持原结果；failed/unknown不能重发，通知调用增量为0。相同ID不同内容拒绝，原诊断内容及text/plain/nosniff/noindex/no-store保留，恢复目录全部字节仍一致。

报告见 [44备份负载补验](../../verification/2026-10-04-recovery/feedback-backup-load-v44-windows.json)。封存反馈归档SHA仍为 `ecd9b1f39050f47771f28725f690ee3f5ee75084817702ec354c2b850f14c5a7`；产品源码、11文件归档、16项草稿资产与既有manifest不改写。本补验未覆盖生产权限/私有密钥保管、真实反代客户端、真实企微、公网负载或公网恢复，也不构成独立代表性的产品bug率证据。

复现命令（在开发工作树运行，样本数据只写入忽略的 `.local-data/`）：

```sh
node test/feedback-backup-load.cjs release/yijian-toudi-feedback-server-0.5.44.tar.gz release/yijian-toudi-feedback-server-0.5.44.sha256 0.5.44 .local-data/feedback-backup-load-v44.json
```

## 已验证的运行机制

Linux CI [37189853837](https://github.com/lyzbcy/yijian-toudi/actions/runs/37189853837) 实际解压独立归档后运行其服务 main，没有替换产品模块或发送新通知。

- 原 systemd 模板仅替换 Node 安装路径及隔离测试目录；DynamicUser 非 root、代码不可写、PrivateTmp/ProtectHome/ProtectSystem/NoNewPrivileges 均实际核对。过期日志清理、未知收据保留、服务重启、SIGKILL 故障自动恢复与 31 毫秒正常停止通过。
- 原 Caddy 反代及来源 IP 覆盖规则实际运行；测试域名为 localhost，使用独立本地 CA。显式信任测试 CA 可以读取真实服务健康版本，系统默认信任会拒绝该证书。未关闭证书校验。
- HTTPS 下诊断读取保留 text/plain、nosniff、noindex、no-store；11 次各自伪造不同 X-Forwarded-For 的收据读取仍共享真实连接方 10 次限额，第 11 次返回 429。
- Compose 实际启动、重启、未知收据持久化、非 root 与只读代码文件系统继续通过。

封存归档 SHA-256 为 `90d098f55f096cc79a7e95de0f9bde3fed44f8345ebf7ad70682249aa7581778`，11 个源文件仍匹配，原 v0.5.39 包及云端 18 项资产均未覆盖。追加报告见 [部署补验](../../verification/2026-10-04-recovery/feedback-deployment-supplement-v39.json)。

首轮 Caddy 测试因 Node24 DNS 回调忽略 `options.all` 报 `Invalid IP address: undefined`，修复测试客户端后通过。失败报告保留，不能以最终成功抹掉它。

## 生产现场仍需通过的项目

| 项目 | 所需真实证据 |
|---|---|
| 主机与域名 | 维护者可部署的主机，DNS 指向正确公网入口，真实 443 服务与受信证书 |
| 服务私有配置 | 服务器内配置实际企微机器人，权限 600；不将环境文件或密钥打包/提交 |
| 运行与持久化 | 生产主机现场健康版本、写入权限、重启后防重收据、日志清理、备份恢复和负载记录 |
| 公网反馈 | 经授权的明确测试反馈；实际企微完整留言、版本、官方 errcode=0 及回执一致 |
| 异机诊断 | 从另一台公网设备读取随机诊断长链接；取消日志不生成链接；未知结果先查收据不重发 |
| 默认客户端地址 | 已通过验收的生产 HTTPS endpoint，当前新装默认配置；客户无需自行填作者服务地址 |

本地 CA、同机反代、CI 容器和样本收据不能替代这些项目。当前 App 初始 `feedbackEndpoint` 为空；这是尚未完成的交付门槛，不能称为已经送达开发者。实际 `support/README.md` 保留随封存包的历史说明，本页记录较新的运行证据及其范围。

需要重跑隔离验收时，由 GitHub 运行 `.github/workflows/candidate-feedback.yml`；独立脚本为 `test/feedback-systemd-runtime.cjs` 和 `test/feedback-caddy-runtime.cjs`。它们只适用于隔离 Linux CI 主机，不应在已有生产 systemd/Docker 服务上直接运行。
