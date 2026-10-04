# 岗位刷新结果

主刷新循环在 `electron/main.cjs`，聚合与自动刷新间隔在 `electron/job-refresh.cjs`，持续提示在 `src/job-refresh-status.js`。

每家公司请求完成后记录读取数和成功/失败。全部正常即 `done`，包含零岗位；部分请求失败为 `partial`，全部失败为 `failed`。失败公司的旧岗位保留，成功公司的快照按原收藏规则替换。每次完成统一写 `lastRefreshAttemptAt` 和 `lastRefreshResult.at`，只有 `done` 推进 `lastRefreshAt`。

岗位页持续显示最近结果和失败公司，设置页分开最近尝试与上次完整抓取。旧版本只有尝试时间时保留其事实，不从错误文字推断公司状态。自动刷新使用最近尝试/完整成功中的较新时间，超过24小时才再次启动；手动重试不受这个间隔限制。

边界单测见 `test/job-refresh-status.test.cjs`；实际 Electron 主循环、IPC、持久化、冷重开和三宽度见 `test/ui-job-refresh-status.cjs`。后者显式注入平台请求函数，能验证客户端行为，不能证明招聘官网本轮可用。
