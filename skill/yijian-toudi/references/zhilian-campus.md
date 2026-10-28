# 智联校园正式网申0.5.92
复用已登录真实浏览器。此接入为浏览器Agent协作，不是无人值守批量填表器；客户端读取/导入岗位，Agent完成企业表单与提交回执核对。保留当前申请窗口、草稿和未知attempt。

## 发现与读取
客户端投递管理点击“智联校园网申”；或CLI：
```text
node scripts/applications.cjs zhilian-read READ.json
node scripts/applications.cjs zhilian-import OBSERVED.json
node scripts/applications.cjs zhilian-inspect PAGE.json
```
READ.json为{"open":true}；OBSERVED.json必须是read得到的原始结构，可额外dryRun:true；PAGE.json包含实际url/text/buttons。read支持已观察的.position-card校园列表，以及.job-banner__name/.job-info__desc岗位详情；可传已由浏览器清单核验的tabId读取指定页，不保存Cookie/账户/简历；隐私政策、验证或登录待用户原页处理。零基翻页、全量采集未实现。详情URL按真实打开并核验的/job/岗位ID路由生成，最终企业ATS链接仍须逐岗观察，不由岗位来源推断。
正常点击与目标jobId相符的卡片，观察实际打开的原职位页。核对企业完整主体、具体岗位ID、届别/学历/城市/材料；不得把列表推荐视为个人资格已符合。

## 创建与正式提交
create同原/v1/applications，增加platform:"zhilian-campus"；最终网申入口未确定时applicationRoute:"unknown"，不能先猜企业ATS。
- 发起聊天：action:"interaction", event:"chat-started"，附同原正式evidence字段，非submitted、不进管理。
- 跳转或草稿：interaction event为redirected/draft-saved，同样不算投递。
- 平台明确简历送达：receipt applicationRoute:"platform-resume"，body.routeObservation={"event":"platform-delivered","observed":true}。
- 企业指定ATS当前岗位提交成功：receipt applicationRoute:"employer-ats"，body.routeObservation={"event":"ats-submitted","observed":true,"employerDesignated":true}。
最终receipt保留原id/revision/attemptId/outcome/evidence全套门禁，证据observedAt必须晚于本attempt开始。routeObservation在body顶层，不是evidence内。企业指定证据写入reference/短text；不在账本存身份证、密码或完整简历。
正式提交前核对所有必填字段、附件、资格及用户对具体目标的授权。平台隐私/新条款要求用户确认，不代替接受。不绕过登录/验证码。不以到达页面或旧“已投递”判定本次成功。
submitted后平台/ATS两类分别统计，并自动纳管；聊天不纳管。旧历史unknown保留，不重判100条原记录。超时保持submission-unknown，对原attempt只读核验，不盲重投。

## 可复用提示词
```text
先读取智联校园当前可见岗位，按我的已确认城市、届别、学历与方向筛选并给出具体目标。
核对企业指定入口；分开记录聊天、平台简历送达、企业ATS网申成功。
按ready/授权/attempt/typed receipt逐步执行，仅有真实当前岗位提交回执才纳管；未确定提交时不重投。
```
