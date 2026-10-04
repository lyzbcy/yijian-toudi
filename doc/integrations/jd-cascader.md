# 京东籍贯和专业类别级联控件
现状：v0.5.29候选；继承28控件并修复API数组路径在APP编辑中丢层级
负责人：项目维护者
最后更新时间：2026-10-04

## 真实结构
个人17同一campus.jd.com/#/resume：籍贯位于info第1段、专业类别在edu第1段，唯一.ant-cascader-picker内readonly.ant-cascader-input；弹出.ant-cascader-menus按UL.ant-cascader-menu分列，LI[role=menuitem]含分支expand/当前active类。实际没有aria-controls/owns或菜单ID，不能沿用普通select的关联ID逻辑。真实江苏父菜单展开有13子项，工学有29子项；仅菜单诊断，不表示这些是用户事实。

## 输入与执行
APP籍贯/专业类别输入官网完整路径，以“ / ”分级，例如按用户本人选择复制全部省/市/区或分类层级。API也接受字符串数组；不从人工智能专业猜类别、不从无锡居住地猜籍贯。空值不生成请求；格式非法留manual。支持1～6级，精确标签，不使用字典推测中间层。

`jd-cascader.cjs`被`jd-widget-fill.cjs`序列化到同一文档。按section/group/label唯一定位；打开前必须没有其它可见弹层，点击确切picker后只接受唯一新菜单。每一级验证唯一精确选项和可用性，子级前验证所有祖先active标签。只有末级没有expand标识时才选叶子；不完整父级、过深、重复、禁用、节点重挂、其它弹层均不继续。已显示匹配值仍需菜单证明终点是叶子，不把父级文字当齐全。

叶子选择后延迟回读实际readonly展示路径；仅分隔空白规范化，不拼造值。中间层若异常直接改字段则记录changed=true/manual，不冒称无变化。最终仅对本次打开菜单派发Escape/非动作body外部事件关闭，不点保存/同意/申请。其它已打开弹层不关闭。必填检查kind=cascader，filled仅表示展示非空，仍不等于官网校验/保存。

## 验收
19单测：路径格式、数组/段号/空值、无事实不计划、序列化/必填分类和APP数组路径展示。
`node test/ui-jd-cascader.cjs`：25原生Electron受控页面检查，包含异步子列、祖先状态、匹配父级拒绝、唯一叶子、延迟回退、兄弟段、弹层/禁用/重挂和保存不触碰。fixture不是官网成功。
真实现场4个拒绝诊断：仅父级返回incomplete；非叶父菜单展开后不存在的子选项返回missing，depth1及13/29子项确认；全控件哈希不变、34必填/16缺项、菜单0、保存0/申请0。独立观察前后范围分开，真实用户叶子填写仍待事实。

28真实ASAR往返发现：API数组路径会被APP输入框显示和保存成逗号串，路径深度降成1，不能把API规划单测等同于软件完整支持。29在初始段渲染与档案回填统一formatResumePathEditorValue，仅籍贯/专业类别数组转“ / ”路径；其它数组、false及空值不改。旧28失败包/报告保留，29实际ASAR往返另验。

```text
接续JD字段：读SKILL.md、本文和jd-fields.md，保留个人17草稿。
用户提供完整籍贯/专业类别路径后走planJdWidgets；不得使用诊断样本当个人事实。
同会话按section/group/label，精确逐层菜单/active祖先/末级叶子验证，延迟回读。
记录实际missing/changed；保存重开和具体岗位回执仍单独验收。
```
