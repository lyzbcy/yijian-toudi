# 腾讯社招填表 playwright 实测（2026-07-27）

> 本文记录用 playwright 浏览器自动化真实填写腾讯社招简历页（careers.tencent.com）的完整实测过程。这是项目第一次用 playwright（而非 App 内嵌 workspace.run）真正控制浏览器填表，解决了之前处理不了 Vue 自定义组件的根本问题。

## 实测结论

### ✅ 核心字段填入成功（10/11）

通过 Agent API `fill_resume_playwright` 端到端验证，用真实简历数据（余恩泽）填入腾讯社招简历页：

| 字段 | 填入值 | 技术方式 |
|------|--------|---------|
| 姓名 | 余恩泽 | `.input-box input.input` + pressSequentially |
| 手机号 | 19519955175 | `input.telephone-input`（CSS class 语义）|
| 邮箱 | lyzbcy@qq.com | `#e-mail`（id）|
| 职位 | 前端研发实习生 | `#work`（id）|
| 公司 | 江苏微盛网络科技有限公司 | `#company`（id）|
| 学校 | 江南大学 | `#school`（id）|
| 专业 | 人工智能 | `input.input-short:not([id])`（class 排除法）|
| 工作描述 | 在知名 SCRM 服务商... | `textarea.describe-input` |
| 开始时间 | 2026-04 | 年`.select-left`→`.small-select-ul`，月`.select-right`→`.splicing-select-ul` |
| 在职勾选 | ✓ | `.currently-checkbox` + `.add-experience` 确认添加 |

读回验证全部值正确，无错位。

### ⚠️ 未完全解决

- **居住国家/地区**：从 myresume「创建简历」入口进入时，国家选择器交互偶尔失败（10/11 次成功，1 次失败）
- **保存**：腾讯 Vue 前端校验对「期望工作城市」(el-select 多选) 有 Code 联动校验，自动保存报 `Cannot read properties of undefined (reading 'Code')`（腾讯压缩 bundle 内部错误，无法精确定位）。故填表后停在保存按钮前，让用户检查并手动保存。

## 关键技术发现（实测得出，非推测）

### 1. pressSequentially vs fill/native setter（最关键）

腾讯用 Vue 2，表单字段用 `v-model` 绑定。三种填值方式的 Vue 识别情况：

| 方式 | Vue 认？ | 说明 |
|------|---------|------|
| `element.fill(value)` | ❌ 部分 | playwright 的 fill 设值后 Vue data 不更新（校验判空）|
| native setter + dispatchEvent | ❌ | DOM 显示了值，但 Vue 响应式没触发 |
| **`element.pressSequentially(value)`** | **✅** | 逐字符输入，模拟真实键盘，Vue 100% 识别 |

**结论**：腾讯 Vue 表单必须用 `pressSequentially`（逐字符输入），不能用 fill 或 native setter。

### 2. 时间选择器的双 class 结构

腾讯的时间选择器，年和月用**不同的 CSS class**：
- **年**：`.select-left` 触发 → `.small-select-ul.active` 展开选项
- **月**：`.select-right` 触发 → **`.splicing-select-ul.active`**（注意不是 small-select-ul！）

月份选项格式带前导零（`01`-`12`），不是 `1`-`12`。这个差异导致月份选择反复失败，直到读 HTML 才发现。

### 3. 国家选择器

`input[placeholder="选择国家/地区"]` 点击展开 `.select-ul.active`，选项是中文国名（阿富汗、中国内地...）。要选「中国内地」（不是「中国」，因为有中国香港/台湾/澳门）。

### 4. 「增加工作经验」按钮

腾讯的工作经验段是「先填表单 → 点 `.add-experience` 确认添加到列表」。不点这个按钮，填的工作经验不会被 Vue 当作已添加。

### 5. 保存的 Vue 校验限制

腾讯保存时的前端校验报 `Cannot read properties of undefined (reading 'Code')`（在压缩 bundle `p_zh-cn_myresume.build.js` 内）。这是期望工作城市（el-select 多选）的 Code 联动校验，即使选了国家+城市仍报错。这是腾讯自身代码的问题，自动化保存受阻。

按 agent.md「最终提交由用户确认」原则，填表后停手让用户手动保存是合理的产品形态。

## 已封装的能力

### `electron/auto-fill-engine.cjs` → `fillTencentSocial(page, resume)`

封装了上述所有填表逻辑，返回 `{ ok, status, message, filled[], failed[] }`。供 Agent API 和后续 App 集成调用。

### Agent API: `fill_resume_playwright`

```
POST /v1/commands
{"action":"fill_resume_playwright","companyId":"tencent","recruitType":"social"}
```
打开可见浏览器，用 playwright 填表，返回 review-required（不自动保存）。浏览器保持打开让用户检查。

## 下一步

1. **补全居住国家**：修复从「创建简历」入口进入时国家选择器偶发失败
2. **期望工作城市**：攻克 el-select 多选的 Code 校验，实现自动保存
3. **迁移到其他公司**：字节/小米（飞书 ATS 同源）/京东/美团，复用 pressSequentially + CSS class 经验
4. **集成进 App UI**：用户点「更新简历」触发 fill_resume_playwright（替代旧的 workspace.run 方式）
