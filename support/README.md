# 通用反馈服务部署
现状：零第三方运行时依赖的 Node20+ 服务；HTTPS公网验收另列发布门槛
负责人：一键投递维护者
最后更新：2026-10-10

## 组成
`support/feedback-server.cjs`、`electron/feedback.cjs`、`electron/diagnostics.cjs`、`electron/wecom-notify.cjs` 四文件保持相对目录一起部署。不需要桌面会话、招聘账号或简历文件。Windows/Linux/macOS 均可运行 Node20+。

```text
部署一键投递反馈服务：安装Node20+，复制support/feedback-server.cjs及其3个electron依赖文件。
设置YJT_FEEDBACK_PUBLIC_URL=https://你的域名/、YJT_FEEDBACK_WEBHOOK=私有企微链接、YJT_FEEDBACK_DATA=持久存储目录。
运行node support/feedback-server.cjs，使用Caddy/nginx在HTTPS443反代127.0.0.1:8096。
发布者在构建前配置公共默认地址，粉丝不用逐人填写；自部署用户可在App设置自己的服务地址。
从真实公网客户端发送一条明确标记测试的反馈，
核对群消息版本/留言、回执、长链接可读，未知回执不重发。密钥只留服务端，禁止写入安装包或公开配置。
```

Linux环境示例（值由部署者设置，不含项目私钥）：
```sh
export YJT_FEEDBACK_PUBLIC_URL='https://你的域名/'
export YJT_FEEDBACK_WEBHOOK='你的私有企微机器人链接'
export YJT_FEEDBACK_DATA='/var/lib/yijian-feedback'
node support/feedback-server.cjs
```
Windows PowerShell使用 `$env:变量名='值'` 设置同名变量。正式服务进程用系统服务管理器保活，不把终端密钥截图上传。

Caddy示例：
```caddyfile
你的域名 {
  reverse_proxy 127.0.0.1:8096
}
```
程序本身仅监听回环。配置文件及存储目录仅服务账号可读；日志链接用随机256位标识，7天到期，返回text/plain、nosniff、noindex与no-store。每日清理7天前的日志与收据前先核对是否有unknown/sending；未知发送状态须先核对群回执，别通过删记录解除去重。

## 协议和失败恢复
- v0.5.23保留1000字符单位的完整备注：按UTF-8字节在text/markdown间选择，完整信封超过4096或非法Unicode在落发送记录前拒绝；不静默截断。依赖文件应同版本一起更新。
- `POST /v1/feedback`：UUIDv4 requestId、版本、kind=bug/review、category（可空）、message、可选logs。最多32KiB；每连接IP每分钟10请求，放在反代后为共享限额，需大规模部署时另加边缘限流。
- 服务先持久记录sending，再通知企微；官方errcode=0才返回sent。相同ID/同内容不会再次通知；相同ID/不同内容拒绝。
- `GET /v1/feedback/<requestId>`：只回发送状态/日志链接，不回留言。客户端超时先核对收据；服务unknown/sending不自动重试。
- `GET /diagnostics/<随机标识>.txt`：只读脱敏结构日志。默认附加，用户取消后不创建日志链接。
- `YJT_FEEDBACK_ALLOW_LOCAL=1`仅用于回环测试，PUBLIC_URL为http://127.0.0.1:端口/。**本机链接不证明粉丝或公网开发者可访问。**

## 分发前必须核验
准备真实HTTPS域名、可靠持久存储/备份、WeCom密钥部署、客户端服务地址，然后从另一台公网机器实发/读取长链接，核对重启与限流。App未配置服务地址时明确提示，不伪造已发送；仓库不内置示例域名作正式地址。

依赖包不包含私有`.local-data`、反馈存储、群密钥、简历或浏览器Cookie。企业微信个人投递通知和开发者反馈服务是两个独立配置：前者App本机，后者服务端。

## 发布者打包默认地址（0.5.72）

先部署以上服务，核验真实公网HTTPS域名，再在项目根执行（替换HTTPS_ENDPOINT为自己的完整 /v1/feedback URL）：

```sh
node scripts/configure-feedback.cjs --set HTTPS_ENDPOINT
node scripts/configure-feedback.cjs --check-public
node scripts/release.cjs NEW_VERSION
# 使用新、未占用的版本构建Windows、Skill，资产不覆盖
```

只有公共地址进入electron/public-defaults.json；不要放WeComWebhook、Token或私有配置。配置验证原子写入，拒绝已知私网IP/保留域名、凭证/query/hash与非标准路径；HTTP回环自定义仍只用于本机测试，不作为分发默认。地址策略参考[IANA IPv4](https://www.iana.org/assignments/iana-ipv4-special-registry)、[IANA IPv6](https://www.iana.org/assignments/iana-ipv6-special-registry)、[RFC2606](https://datatracker.ietf.org/doc/html/rfc2606)、[home.arpa](https://www.rfc-editor.org/rfc/rfc8375.html)。域名文本校验不证明DNS/证书或服务可达。

新用户自动得到默认地址；旧空设置仅未明确禁用时补齐，自定义地址及主动清空保持。保存其它设置不会把未修改空URL变成禁用。未知反馈保留原回执地址且只GET核对，不因改地址重发。

公开前手动运行--check-public，并核对实际NSIS/ZIP中app.asar的public-defaults.json与冻结源码一致；从独立公网客户端完成发送、企微回执、日志读取、重启/限流测试。CLI仅检查源码公共地址，不检查资产或整个MVP。release-skill.yml的published步骤是发布后审计，不拦截GitHub手动publish按钮；draft允许空候选。当前72候选地址为空，--check-public exit1，尚未正式公网验证。改变已构建不可变包的地址须用新版本重构建，不能只改源码后复用旧包。
