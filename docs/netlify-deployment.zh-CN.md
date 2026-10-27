# Netlify Free 部署说明

项目保留 NextChat 品牌和现有界面，复用服务端 OpenRouter 兼容路由；Upstash Redis 使用 HTTPS REST 执行原子限额，不使用浏览器云同步接口。缺少 Redis 会返回 503 并暂停模型调用。

## 构建配置

使用现有私人 GitHub 仓库 `rosemancolandog397-source/NextChat` 的 `main`，仓库根目录为 Base directory。Next.js 框架由 Netlify 自动检测，配置来自 `netlify.toml`：

- Node 24，Yarn 1.22.19，按锁文件安装完整构建依赖。
- Build command: `corepack yarn build`。
- Publish directory: `.next`。不是 `out`、仓库根目录或 `.next/standalone`。
- 不填写启动命令，不上传 `.env`，不使用 Static/Export 构建或旧 Dockerfile。
- `NETLIFY=true` 时不生成 standalone，由 Netlify 自动使用维护中的 OpenNext 适配器；不额外固定旧版插件，不添加全站 SPA 重写。
- Deploy Preview 和 Branch Deploy 设置忽略构建，不给这些上下文配置生产密钥。不要新增任何付费集成。
- Vercel 专用 `maxDuration=300` 不会延长 Netlify 时限；Netlify 流式和非流式函数均有 60 秒上限。

## 环境变量

在 Netlify 的项目配置 Environment variables 中填写，Production 上下文，作用域必须包含 **Builds 和 Functions**。若免费界面不提供细分作用域则使用默认全部作用域。密钥填写在平台，不能发到聊天、写入 `netlify.toml` 或 Git。`.env.example` 只提供空白模板。

| 名称 | 值 / 说明 |
| --- | --- |
| OPENAI_API_KEY | 现有 OpenRouter 专用密钥，标记秘密值（若平台提供该选项） |
| BASE_URL | https://openrouter.ai/api/v1 |
| SERVER_ONLY_API_KEY | 1 |
| AI_ALLOWED_MODEL | deepseek/deepseek-v4.1-flash-1017 |
| AI_BUDGET_REDIS_REST_URL | 现有 Upstash HTTPS REST 根地址，域名以 .upstash.io 结尾 |
| AI_BUDGET_REDIS_REST_TOKEN | 有写权限的 Redis REST Token，不能使用只读令牌 |
| AI_BUDGET_NAMESPACE | nextchat-production，所有实例、重新部署保持一致 |
| AI_REQUESTS_PER_MINUTE | 6 |
| AI_REQUESTS_PER_DAY | 100 |
| AI_MAX_BODY_BYTES | 131072 |
| AI_MAX_INPUT_CHARS | 20000 |
| AI_MAX_OUTPUT_TOKENS | 4096 |
| CODE（可选） | 邀请访问口令；留空时为匿名共享额度 |

`HUSKY=0`、`NODE_VERSION=24`、`YARN_VERSION=1.22.19` 已在构建配置中，不必重复添加。`NODE_ENV`、`NETLIFY` 由平台提供。不要配置 `NEXT_PUBLIC_*` 密钥、`PROXY_URL`、`BUILD_APP` 或自建服务器的 `PORT` / `HOSTNAME`。OpenRouter 调用不需要 `DEEPSEEK_API_KEY`。

## 超时行为与验证边界

服务端模型调用最多 50 秒，覆盖响应头及完整响应体；加上最多 5 秒的 Redis 请求，预留平台退出时间。非流式请求超时返回 HTTP 504 / AI_UPSTREAM_TIMEOUT；流式请求超时中断并取消上游请求。取消和超时不会自动重试或退回已预留额度，避免重复付费请求。正常聊天继续使用流式响应，需求澄清及 PRD 保留原非流式接口和草稿处理。

**这不是无限时生成方案。** DeepSeek 若在 50 秒内不能完成，长 PRD 或长对话仍会失败；草稿保留，用户可缩短输入后手动重试。没有更换模型、增加后台存储用户文档或关闭安全保护。上游可能在取消前已经产生费用；应在 OpenRouter 设置 Key 金额上限，关闭不需要的自动充值。匿名访客共享额度，不能保证不被耗尽。

本地 Next.js 生产构建通过不等于 Netlify Linux/OpenNext 构建或真实 Redis/模型已验收。正式部署后需检查首页、静态文件、/api/config（不含密钥）、模型限制与 Redis 限额，再单独授权真实模型测试。不要在没有确认时触发实际部署。

免费额度耗尽可能暂停网站；不绑定银行卡、不购买套餐。平台出现支付要求时停止。

官方依据：
- https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/
- https://docs.netlify.com/build/functions/configuration/
- https://docs.netlify.com/build/functions/api/
