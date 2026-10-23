# DSH Sidebar Account Meter

DeepSeek Harness 侧栏用量与余额插件，在一个区域显示 **Codex 用量、DeepSeek 账户余额、WorkBuddy 积分**。

## 功能

- Codex：订阅档位、额度窗口剩余百分比与重置时间。
- DeepSeek：账户余额汇总。
- WorkBuddy：积分余额、不限量状态、多账号分项、国内/国际区域与停用标记；多账号不混合求和。
- 每 2 分钟自动刷新，展开详情后可手动刷新。
- 中英文显示，跟随 Harness 主题；详情面板限制高度并可滚动。
- 查询失败、未登录等状态明确显示，不把失败当作零余额。

## 环境与依赖

当前版本：`1.0.10`。已在 DeepSeek Harness `0.2.1-rc.2` 环境验证；其他版本需重新验证插件服务兼容性。

插件使用 Harness 的 `connection`、`webServer`、`credentials`、`deepseekAccount`、`slots` 和 `locale` 能力。Codex 和 DeepSeek 需要相应账号已登录。

WorkBuddy 为可选集成，需要先安装并登录 [dsh-workbuddy-oauth](https://github.com/yudi-xiao/dsh-workbuddy-oauth)。已验证版本为 `0.0.5-dsh021.1`。通过该插件的同源状态及积分刷新接口查询，不直接读取其凭据文件。接口变化可能需要适配本插件。

## 安装

克隆此仓库后，在 DeepSeek Harness 中让 Agent 使用插件管理工具安装仓库的**绝对路径**：

```json
{"action":"install_bundle","target":"/absolute/path/to/dsh-sidebar-account-meter"}
```

工具名为 `plugin_manager`，实际授权遵循当前 Harness 权限设置。请以安装结果中的 `application` 和 `nextStep` 判断是否生效。

若工具报告 `already-installed`，先通过插件管理工具移除 `@local/dsh-sidebar-account-meter`，再安装新版本。不要手工修改 Harness profile 的依赖或配置。

安装后的本地依赖可能链接到源码目录，请保留该目录。仓库发布不会更改现有安装路径。

## 验证

使用支持 `AbortSignal.any` / `AbortSignal.timeout` 的现代 Node.js：

```bash
node test.mjs
node --check client.js
node --check host-1.0.5.js
```

测试使用模拟响应，覆盖有限积分、零积分、不限量、多区域、停用账号、未登录、无效响应、部分失败、取消、安全路径校验，以及既有 Codex/DeepSeek 数据处理回归。不需要真实账号或网络请求。

`workbuddy.js` 是可独立测试的查询函数；客户端打包入口包含相同函数，测试会检查两者一致性。

## 隐私与边界

- 仓库不包含账号配置、真实余额快照、OAuth token、API key 或 Harness profile。
- WorkBuddy 控制密钥只用于同源请求；控制路径有固定允许列表，不进入展示数据或日志。
- Codex 查询复用 Harness 凭据服务；DeepSeek 查询复用账户服务。
- 余额属于供应商返回的查询时刻快照，不代表账单对账或实时计费承诺。
- 此项目不隶属于 OpenAI、DeepSeek 或 WorkBuddy；供应商名称仅用于说明兼容性。
- 界面可能显示账号标签及错误提示；分享截图前请检查并遮盖个人信息。

## 许可

本仓库目前未指定开源许可证；公开源码不等于授予任意使用、修改或再分发权利。外部依赖仍适用各自许可证。
