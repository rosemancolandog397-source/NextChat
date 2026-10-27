# Netlify Free：当前使用 BYOK

当前部署方式已改为用户自带 OpenRouter API Key，完整配置及安全边界见 [BYOK 说明](byok.zh-CN.md)。不要沿用之前共享站长 Key 的环境配置。

- 私人仓库 `rosemancolandog397-source/NextChat`，分支 `main`，根目录留空。
- 构建命令 `corepack yarn build`，发布目录 `.next`，Node 24，Yarn 1.22.19。
- Netlify 自动使用 Next.js / OpenNext 适配器，不使用静态导出或 Docker。
- Production 配置 `BYOK_MODE=1`，包含 Builds + Functions 作用域；不要填写站长 Key 或 Redis Token。
- 清除此前待部署表单中的 OPENAI_API_KEY、AI_BUDGET_REDIS_REST_TOKEN 等共享演示配置，用 `.env.example` 的无密钥参数替换。
- 函数仍有 60 秒限制，服务器在 50 秒终止模型调用。超长生成仍可能失败并保留草稿。
- 只使用 Free，不添加银行卡、不启用付费集成。正式部署及真实模型验收尚需后续单独完成。

其他环境变量哪些可不填、用户从哪里填写自己的 Key，以及本地存储风险，均见 [BYOK 说明](byok.zh-CN.md)。
