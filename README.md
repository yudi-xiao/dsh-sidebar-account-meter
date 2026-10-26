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

克隆此仓库后，先用 `npm pack` 打包，再在 DeepSeek Harness 中让 Agent 使用插件管理工具安装该 tgz 的**绝对路径**（原因见下文「不要用 link: 安装」）：

```json
{"action":"install_bundle","target":"/absolute/path/to/local-dsh-sidebar-account-meter-1.0.12.tgz"}
```

工具名为 `plugin_manager`，实际授权遵循当前 Harness 权限设置。请以安装结果中的 `application` 和 `nextStep` 判断是否生效。

若工具报告 `already-installed`，先通过插件管理工具移除 `@local/dsh-sidebar-account-meter`，再安装新版本。不要手工修改 Harness profile 的依赖或配置。

### 不要用 `link:` / 符号链接安装

插件的 Codex 余额依赖 `@earendil-works/pi-ai`。若以 `link:`（符号链接）方式安装，该包位于 Harness profile 的 `node_modules`，而 Node.js 解析依赖时按入口文件的**真实路径**向上查找 `node_modules`——链接目标在 profile 之外，因此**找不到 pi-ai**，Codex 余额会静默失效。

升级前请先打包再安装，让插件以真实目录落到 profile 内：

```bash
npm pack                      # 产出 local-dsh-sidebar-account-meter-<version>.tgz
```

```json
{"action":"install_bundle","target":"/absolute/path/to/local-dsh-sidebar-account-meter-1.0.12.tgz"}
```

如确需保留源码目录的链接安装，则必须在链接目标的上级目录提供可解析的 `node_modules`，否则同样失效。

## 排障

侧边栏显示「档位未知 / 暂无额度数据」时，把鼠标悬停在用量条上可看到具体原因：

| 提示 | 含义 | 处理 |
| --- | --- | --- |
| 依赖缺失 (pi-ai) | 找不到 `@earendil-works/pi-ai`，通常是 `link:` 安装 | 按上文改为 tgz 安装 |
| 依赖缺失 (credentials) | 找不到 `@deepseek-ai/dsh-credentials` | 重装插件；勿手工放置替代包，会遮蔽宿主实现并连带影响其他插件 |
| 插件加载失败 | 插件初始化异常 | 重装插件并查看 Harness 日志 |
| 鉴权失败 | OAuth token 无效或已过期 | 重新登录 Codex |
| 接口请求失败 | 上游 `chatgpt.com` 返回异常 | 稍后重试 |
| 请求超时 | 25 秒内未返回 | 检查网络 |

不要手工在 profile 的 `node_modules` 下创建占位包来「临时验证」。`@deepseek-ai/dsh-credentials` 是多个插件的 peer 依赖，占位包会遮蔽宿主提供的真实实现，导致其他插件（如 `dsh-workbuddy-oauth`）在无提示的情况下崩溃。

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
