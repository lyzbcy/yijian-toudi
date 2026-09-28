# Boss 批量投递 & Kimi 桥 & 企微通知

> 现状：v0.4.0 实验特性（2026-09-20 固化，基于 2026-09-19 深夜真机逆向与 90 笔实测）
> 负责人：lyzbcy + ZCode ｜ 最后更新：2026-09-20

## 模块清单

| 模块 | 文件 | 作用 |
|---|---|---|
| 企微通知 | `electron/wecom-notify.cjs` | 群机器人 Webhook 推送；仅信任 qyapi.weixin.qq.com；18 条/分钟频控 |
| Kimi 桥 | `electron/kimi-bridge.cjs` | WS 服务端(10086)，Kimi 扩展主动连接；协议 hello/hello_ack + tool_call/tool_result；MV3 断连自动重试 + ping 保活 |
| Boss 批量引擎 | `electron/boss-batch.cjs` | 搜索→筛选→逐岗沟通循环；规则库沉淀自实测事故回归 |

## 关键约定

1. **协议**（逆向自 Kimi 扩展 v2.0.9，无官方文档承诺；升级需重新校验）：
   - 扩展→Agent：`{"type":"hello"}`，Agent 回 `hello_ack`
   - Agent→扩展：`{"type":"tool_call","requestId":X,"payload":{"name","args"}}`
   - 扩展→Agent：`{"type":"tool_result","responseToRequestId":X,"payload"}`
   - 权限：`permission_requested` → `permission_resolved(approve_for_me)`
2. **筛选规则**在 `boss-batch.cjs` 顶部正则（TRACK/TECH/EXCL）。修改必须同步 `test/wecom-notify.test.cjs` 的回归用例——历史上漏过陪玩/美术/项目申报类岗位，教训见技术方案 §9。
3. **城市-轨道配对**是用户口径（2026-09-20）：武汉=只投实习；上海/苏州/无锡=27 届校招。
4. **安全**：遇 Boss「安全验证」页立即全线停止并推企微；dryRun 不点「立即沟通」。
5. IPC：`wecom:test` / `kimi:status` / `kimi:restart` / `boss:batch:start|stop|status`；设置存 `settings.wecomWebhook`、`settings.kimiBridgeEnabled`。

## 已知限制

- 桥的 session 标签如停留在非 Boss 页（官网投递混用），引擎会重导航一次；极端情况仍可能零命中，看日志 `non-boss page` 行。
- dryRun 演练不计入已投统计（UI 显示 0 属正常，改进项）。
- 测试：`node --test test/wecom-notify.test.cjs`（协议往返/通知体/筛选回归 4 组）。
