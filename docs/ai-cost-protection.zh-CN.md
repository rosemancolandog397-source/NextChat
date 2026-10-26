# AI 调用费用保护（第二阶段）

适用于网页生产模式的服务端共享密钥。生产模式自动启用；本地开发可设 `SERVER_ONLY_API_KEY=1` 验证。聊天、自动标题/摘要、需求澄清、PRD 生成均走同一个受保护的 OpenAI 兼容接口；每次请求共同占用全站额度，而非各有一份额度。

## 默认限制

| 项目 | 默认值 | 服务端环境变量 |
| --- | --- | --- |
| 允许的唯一模型 | `deepseek/deepseek-v4.1-flash-1017` | `AI_ALLOWED_MODEL` |
| 全站每分钟请求数 | 6 | `AI_REQUESTS_PER_MINUTE` |
| 全站每日请求数 | 100 | `AI_REQUESTS_PER_DAY` |
| 请求体 UTF-8 字节数 | 131072（128 KiB） | `AI_MAX_BODY_BYTES` |
| 全部消息累计字符数 | 20000（按 JavaScript UTF-16 长度计算） | `AI_MAX_INPUT_CHARS` |
| 单次输出上限 | 4096 tokens | `AI_MAX_OUTPUT_TOKENS` |

请求还受 64 条消息上限保护。输入包含系统提示、历史对话和工作台整理的上下文，不仅是输入框最后一句。超长请求被拒绝，不自动截断或删除用户数据。

服务端重建请求体，固定 `n=1`，添加/压低 `max_tokens`，不允许 `max_completion_tokens` 绕过；更小的客户端限额会保留。模型 ID 必须精确匹配，`:online` 等后缀、备用模型列表、客户端自选 provider、付费搜索插件、工具调用、多模态请求不开放。普通文本聊天、需求澄清和 PRD 的接口与页面仍保留。旧聊天若选择了其他模型，需要手动选择允许的模型；服务端不会擅自修改历史会话。

服务端仅开放 `POST /api/openai/v1/chat/completions`，模型列表接口在本地返回唯一允许的模型，不请求模型提供商。其他提供商、Azure、图像/语音生成和通用代理不能绕开这条费用保护链路使用服务端共享密钥。上述限制只针对公开共享密钥模式，原有私用/桌面代码没有删除。

## 每日额度与频率计数

采用专用 Upstash Redis REST 存储，通过一段 Lua 脚本原子检查并预占分钟和每日额度，适用于多实例/Serverless。日界线为北京时间零点，分钟是整分钟固定窗口；边界前后可能出现短时双窗口突发。

使用 Redis 自身时间，不信任浏览器或实例传入的时间。计数存储在持久化服务中，没有进程内计数器作为放行备用。多个实例、重新发布需连接同一数据库并使用同一命名空间。

生产服务必须配置以下服务端变量：

```dotenv
AI_BUDGET_REDIS_REST_URL=https://<专用数据库>.upstash.io
AI_BUDGET_REDIS_REST_TOKEN=<专用数据库的服务端写入令牌>
AI_BUDGET_NAMESPACE=nextchat-production
```

不能使用 `NEXT_PUBLIC_` 前缀。令牌不通过 `/api/config` 返回，不保存在前端，不复用浏览器云同步凭据。数据库应专用并持久保存，不要开启会驱逐额度计数的策略，不要手动清空计数或随每次构建变更命名空间。

未配置、网络/鉴权故障、超时或返回异常时，返回 503 并停止模型调用；不会为了可用性放弃保护。原有聊天和草稿不被清除。

达到分钟或日上限返回 429、固定中文原因和 `Retry-After`；工作台区分“频率过高”“今日额度用完”和“输入过长”。失败、取消和网络不确定的已预占请求也计入额度，不自动退款或重试，避免超发。

## 验证边界与剩余风险

本阶段仅使用虚构凭据、模拟 Redis REST 响应和模型响应验证，没有创建云服务、写入真实额度库或调用付费模型。模拟测试不等于已经完成实际 Redis/Lua 运行、跨地域多实例或线上服务商验收；接入专用存储后仍需在受限预发布环境确认。

本方案限制调用次数和文本/token 数量，**不是美元金额硬上限**。实际费用还受提供商价格、推理 tokens、计费规则和价格变动影响。公开前仍需在 OpenRouter 为部署专用 API Key 设置消费硬上限，并检查自动充值设置。

数据库清空/驱逐、连接到不同数据库或人为更换命名空间会重置计数。共享访问码泄露可能让他人耗尽全站额度；恶意 HTTP 流量还可能产生 Redis、平台和带宽费用，需要后续访问控制/WAF 治理。

较小的输出上限可能导致长 PRD 或推理结果不完整；现有结构解析和错误提示会保留旧草稿。私用开发模式未启用服务端共享密钥时，浏览器直连的调用不受本站服务端额度保护；静态站点不能提供此服务端保护方案。

本阶段未设置真实环境变量、升级依赖、删除用户数据、提交 Git、推送或部署。

## 本阶段文件清单与检查结果

- `.env.template`
- `app/api/auth.ts`
- `app/api/common.ts`
- `app/api/openai.ts`
- `app/config/server.ts`
- `app/utils/product-workbench-ai.ts`
- `test/product-workbench-api.test.ts`
- `test/server-key-security.test.ts`
- `app/api/ai-cost-guard.ts`
- `app/config/ai-cost-errors.ts`
- `app/config/ai-cost-policy.ts`
- `docs/ai-cost-protection.zh-CN.md`
- `test/ai-cost-guard.test.ts`
- `test/ai-cost-routing.test.ts`

2026-10-26 本地检查：47 个测试套件、318 项测试通过；TypeScript、相关 ESLint 与生产构建通过。存在原有非阻断构建/弃用警告；未使用忽略构建或类型错误的配置。所有模型和额度存储响应均为模拟数据，未调用付费 API，也未执行真实 Redis Lua 脚本。
