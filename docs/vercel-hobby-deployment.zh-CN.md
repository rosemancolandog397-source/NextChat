# Vercel Hobby 部署准备

仅用于个人非商业求职演示。不得开通 Pro、付费试用、添加银行卡或购买数据库集成。遇到支付要求停止。模型调用仍消耗现有 OpenRouter 余额，不属于免费托管额度。

## 当前配置

- Next.js 框架自动部署适配，不运行 Docker 或 standalone 自建服务器命令。
- Node 24.x（平台决定补丁版本），Yarn 1.22.19；锁文件安装。
- 模型路由使用 Node.js，maxDuration=300，单区域 iad1；启用 Fluid Compute。
- 三个 AI 功能仍经同一 OpenAI 兼容路由访问 OpenRouter，服务端强制指定 DeepSeek 模型、Redis 原子共享限额和长度限制。
- vercel.json 的 git.deploymentEnabled=false 阻止所有 Git 自动部署；首次导入或手动部署仍需明确确认。不要触发已有手动部署工作流。

## 手动操作（先配置，等待确认再部署）

1. https://vercel.com/signup 使用 GitHub 登录，选择个人 Hobby。授权只访问自己的 NextChat 仓库。
2. 从私人仓库 main 导入，框架 Next.js，Root Directory 留空。保留仓库 installCommand / buildCommand，Output Directory 不覆盖，不设置 Render 的启动命令、PORT、HOSTNAME、NODE_VERSION。
3. 在部署前的 Environment Variables 中添加下表配置；只配置 Production，避免无意给预览环境提供共享密钥。Secret 值仅在平台输入，不发到聊天。
4. 不点击 Deploy，先确认预算、Redis 和配置就绪。正式部署必须再获得确认。
5. 经确认首次部署后，用 /api/config 和页面做不计费检查；真实模型验收另行授权。Redis 故障会返回 503 并阻止模型调用。

|变量|值及说明|
|---|---|
|OPENAI_API_KEY|OpenRouter 专用 Key，平台 Sensitive 环境变量|
|BASE_URL|https://openrouter.ai/api/v1，不加 chat/completions|
|SERVER_ONLY_API_KEY|1，构建和运行保持一致|
|AI_ALLOWED_MODEL|deepseek/deepseek-v4.1-flash-1017|
|AI_BUDGET_REDIS_REST_URL|独立 Upstash HTTPS REST 地址，域名以 .upstash.io 结尾|
|AI_BUDGET_REDIS_REST_TOKEN|具有写权限的 REST Token，平台 Sensitive 环境变量|
|AI_BUDGET_NAMESPACE|nextchat-production，多实例和重新部署保持一致|
|AI_REQUESTS_PER_MINUTE|6|
|AI_REQUESTS_PER_DAY|100|
|AI_MAX_BODY_BYTES|131072|
|AI_MAX_INPUT_CHARS|20000|
|AI_MAX_OUTPUT_TOKENS|4096|
|HUSKY|0|
|CODE（可选）|邀请口令；匿名演示不设，访客会共享全部额度|

不配置 NEXT_PUBLIC_* 密钥、DEEPSEEK_API_KEY、PROXY_URL、BUILD_APP。NODE_ENV 由平台设置；build 脚本自行设置 BUILD_MODE。无需新增 Upstash 付费集成，使用现有免费实例。请求次数限制不等于金额硬上限，OpenRouter 应设置 Key 花费上限并检查自动充值。

## 验收范围与限制

本地验证不能替代 Vercel Linux 构建及线上流式连接验收；平台 300 秒时限仍可能截断长生成。免费平台额度耗尽可能暂停。未调用真实模型或配置真实 Redis，不宣称其线上连接已验证。聊天与 PRD 保存在浏览器，本次部署不迁移用户数据。

参考：https://vercel.com/docs/plans/hobby 、https://vercel.com/docs/functions/configuring-functions/duration 、https://vercel.com/docs/project-configuration/git-configuration
