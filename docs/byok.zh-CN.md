# BYOK：用户自带 OpenRouter Key

公开部署默认 BYOK。为明确配置，Netlify 设 `BYOK_MODE=1`（Builds + Functions，Production）；构建配置已设置该值。未设置时也默认 BYOK；即使遗留 `SERVER_ONLY_API_KEY=1`、`HIDE_USER_API_KEY=1` 或站长 API Key，BYOK 仍优先，不回退到站长 Key。

## 用户入口（复用原界面）

设置 → 模型服务 / 自定义接口 → 服务商 OpenAI → API Key，填写用户自己的 **OpenRouter** Key。服务商名称沿用原界面 OpenAI（兼容协议），并非调用 OpenAI 官网。BYOK 自动打开原有自定义配置区，服务商及接口地址锁定以避免误发送密钥；模型仍为 `deepseek/deepseek-v4.1-flash-1017`。聊天、需求澄清和 PRD 共用该 Key，不提供免费共享 Key。

现有 Key 输入及 Zustand 浏览器本地保存能力直接复用，没有增加账号、数据库存储 Key 或自制密钥管理接口。旧 Key 不会自动删除；用户应确认它属于自己。如当前浏览器曾保存站长 Key，站长须自行清空该 Key 输入框、不要在共享浏览器演示，并视使用情况轮换。

## 数据流与边界

浏览器在 HTTPS 请求的 Authorization 头中将用户 Key 发送到**本站同源 API**，服务器仅转发到 `https://openrouter.ai/api/v1/chat/completions`。这不是“Key 从不离开浏览器”：本站服务端会瞬时处理它，用户必须信任部署者与托管平台。代码不把 Key 写入日志、数据库或配置响应，也不发往旧自定义 URL、Cloudflare 网关或其他模型商。

服务器不注入站长 Key，缺少用户 Key 返回 401；站点访问口令不能代替 Key。用户 Key 无效时返回认证错误，不重试站长 Key。模型列表为本地允许列表；其他模型商、任意代理及非文本接口被拒绝。服务端配置响应只包含公开策略字段。错误响应继续脱敏；Key 意外回显由响应过滤器移除。

本版本关闭云同步、整站备份、公开分享和 MCP；默认第三方统计脚本在 BYOK 下关闭，避免让非必要脚本接触保存 Key 的页面。聊天、PRD、本地 Key 都仍可能被同浏览器使用者、恶意扩展或 XSS 读取；浏览器本地保存并非加密保险箱。用户可以在原 Key 输入框清空 Key，不应在公共电脑保存。输入和生成内容会交给 OpenRouter 及其路由模型商处理。

## Netlify 环境变量

|变量|是否需要|
|---|---|
|BYOK_MODE=1|建议明确设置；Production 的 Builds + Functions。省略也默认 BYOK|
|AI_ALLOWED_MODEL|可不填，默认 deepseek/deepseek-v4.1-flash-1017|
|AI_MAX_BODY_BYTES|可不填，默认 131072|
|AI_MAX_INPUT_CHARS|可不填，默认 20000|
|AI_MAX_OUTPUT_TOKENS|可不填，默认 4096|
|OPENAI_API_KEY / DEEPSEEK_API_KEY / 其他服务商 Key|完全不需要，应移除站长密钥|
|AI_BUDGET_REDIS_REST_URL / AI_BUDGET_REDIS_REST_TOKEN / AI_BUDGET_NAMESPACE|完全不需要；BYOK 不使用共享站长额度或 Redis|
|AI_REQUESTS_PER_MINUTE / AI_REQUESTS_PER_DAY|BYOK 不使用，完全不需要|
|BASE_URL / CUSTOM_MODELS / DEFAULT_MODEL|完全不需要；BYOK 固定可信 OpenRouter 地址和允许模型策略|
|SERVER_ONLY_API_KEY / HIDE_USER_API_KEY / CODE / PROXY_URL / ENABLE_MCP|不需要，移除旧演示配置；BYOK 不受旧共享开关影响|

不能设置 NEXT_PUBLIC_* 密钥。不要求用户向站长提供 Key。部署命令 `corepack yarn build`，发布目录 `.next`，根目录留空，Node 24/Yarn 1.22.19 已配置。仅使用 Free，不添加银行卡或付费集成。

## 费用保护与限制

每次请求必须有用户 Key，仅用户自己承担 OpenRouter 调用费用。保留指定 DeepSeek 模型、输入字符/请求体/输出 token 上限及 50 秒完整响应周期超时，不做自动付费重试。Redis 共享预算只保留在显式 legacy 模式用于旧版回归，BYOK 不使用共享日额度，也没有持久的每用户频率计数。用户应在 OpenRouter 自己的 Key 设置金额上限，并保护好 Key。

BYOK 消除了站长模型余额被匿名用户消耗的路径，不保证 Netlify 免费计算/带宽不会被刷。平台免费额度耗尽仍可能暂停；需要更强抗滥用能力时，应另行设计不保存明文 Key 的按用户限流或使用平台免费防护，不能把没有 Redis 描述成已具备持久限流。

## 验证

自动测试使用虚构用户 Key 和站长 Key：覆盖缺 Key、两名用户各自转发、遗留共享变量、无效 Key 不回退、备用路由阻断、旧客户端配置恢复及隐私限制；不调用真实模型。生产构建与本机 HTTP 检查不等于 Netlify 线上验收或真实 Key 可用性验收。

代码提交使用 `[skip netlify]`，避免未确认的 Git 自动部署。没有触发正式部署，也没有删除原浏览器用户数据。
