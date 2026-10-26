# 公开演示版：用户数据与隐私保护

公开版暂不提供用户账号、云端同步或公开分享。保留原有文本聊天、需求澄清、PRD 生成和本地文件缓存，以及单独导出聊天内容和 PRD Markdown 的能力。没有清理或迁移现有 IndexedDB、localStorage、Service Worker 缓存或云端旧数据。

## 公开模式的强制边界

沿用服务端密钥模式：完整网页的生产环境自动启用，不能通过 `SERVER_ONLY_API_KEY=0` 关闭；开发环境可设 `SERVER_ONLY_API_KEY=1` 做本地验证。私用/桌面旧功能仍保留，但不代表静态导出有同样的服务端安全边界。正式公开应部署完整 Next.js 服务。

| 路径或能力 | 公开模式行为 |
| --- | --- |
| `/api/artifacts` GET/POST | 服务端固定返回 403，不读写 Cloudflare KV，不返回旧分享内容 |
| `/api/upstash/...` GET/POST/OPTIONS | 服务端固定返回 403，不转发令牌或读写云端备份 |
| `/api/webdav/...` GET/PUT/OPTIONS | 服务端固定返回 403，不转发认证信息或读写备份 |
| `/sharegpt` | 移除生产环境的外部重写，站内各 HTTP 方法固定返回 403 |
| Artifacts 分享页及按钮 | 不请求远端内容，不显示分享入口 |
| 聊天导出的 ShareGPT 按钮 | 不显示，底层分享方法也拒绝调用；本地复制和下载保留 |
| 整站备份、导入与云同步 | 不显示入口；底层 store 方法和状态打包/导入函数也拒绝操作 |
| MCP 配置/工具 Server Actions | 公开模式禁用，即使误设 `ENABLE_MCP=true` 也不能读取配置或启动工具 |

提供访问码、伪造用户 ID 或自己构造 HTTP 请求，不能重新开启上述能力。配置了云存储凭据也不会放行；这不是仅隐藏前端按钮。

## 密钥响应保护

`/api/config` 继续使用严格的公开字段白名单，不返回模型密钥、访问口令、Redis 令牌或云存储凭据。生产环境唯一模型调用链使用服务端密钥，其他提供商和通用代理受前两阶段限制。

模型上游错误不透传原始错误对象；响应头移除认证信息、Cookie 和包含当前模型密钥的字段。成功响应正文会过滤已知模型凭据，流式响应也处理跨字节块的匹配，保留中文、表情和 SSE 格式。这用于防止意外回显，不代表可以信任恶意模型提供商或任意第三方脚本。

## 用户提示和保留的数据

聊天、设置和工作台显示本地保存提示：数据默认保存在当前浏览器，清理浏览器数据可能导致丢失；共用浏览器可能看到已有内容。AI 请求仍会发送给模型服务，请勿填写公司机密、密码或其他敏感信息。

公开模式停止读取/导出旧访问配置进行备份，不主动删除旧密钥副本、历史日志、备份文件、云同步内容或分享对象。原有云存储若曾被其他站点或地址公开，禁用本项目接口不能撤销那些地址或第三方副本；所有者仍需单独审计、轮换旧凭据并处理外部访问权限。

不引入虚假的多用户隔离：目前只有浏览器配置之间的默认隔离。同一设备/浏览器配置的多人使用仍可能看到彼此的数据，不能作为多租户机密资料系统。将来若恢复云端保存，需要先引入真实身份、记录所有者校验、按账号的本地存储分区及明确的旧数据归属迁移，不能仅增加一个登录按钮。

## 上线前仍需完成

- 配置独立服务端 OpenRouter 密钥、访问码、Redis 额度存储和 OpenRouter 消费硬上限，重新构建并在受限环境启动验证；本阶段未设置真实凭据或重启原服务。
- 对真实部署验证分享/同步 403、配置白名单和请求限额；本阶段只使用虚构凭据和模拟上游响应，不调用付费 API。
- 继续处理已发现的历史依赖漏洞，核对模型服务的数据保留政策，以及字体、统计等第三方资源的隐私影响。尚不能认定所有公开部署条件已经满足。

本阶段未升级依赖、删除用户数据、提交 Git、推送或部署。

## 本地验证结果（2026-10-26）

- 51 个测试套件、347 项测试通过；类型检查、相关 ESLint 和生产构建通过，仍有原有非阻断构建/弃用警告。
- 独立端口实际 HTTP 检查：Artifacts GET/POST、Upstash GET/POST、WebDAV GET/PUT、ShareGPT GET/POST 全部返回 403；配置接口返回 200 且没有测试凭据或敏感字段。
- 独立浏览器页面确认整站备份/同步入口关闭、本地保存提示显示；工作台澄清与 PRD 入口保留。未操作原浏览器草稿，未调用付费模型。
- 发现新浏览器初始会话仍可能显示旧的默认模型（gpt-4o-mini），服务端仍会拒绝非白名单模型；公开前需要复核默认模型初始化和完整新用户流程。本阶段没有扩展修改默认模型逻辑。

## 主要改动文件

- 新增公开模式策略与拦截：`app/config/public-privacy.ts`、`app/utils/public-privacy.ts`、`app/api/public-privacy.ts`、`app/sharegpt/route.ts`。
- 接口与重写：`app/api/artifacts/route.ts`、`app/api/upstash/[action]/[...key]/route.ts`、`app/api/webdav/[...path]/route.ts`、`next.config.mjs`。
- 响应保护：`app/api/credential-response.ts`、`app/api/common.ts`。
- 本地方法保护：`app/store/sync.ts`、`app/utils/sync.ts`、`app/client/api.ts`。
- 入口与提示：`app/components/local-data-notice.tsx`、`app/components/home.tsx`、`app/components/settings.tsx`、`app/components/exporter.tsx`、`app/components/artifacts.tsx`。
- 禁用公开模式 MCP：`app/mcp/actions.ts`、`app/config/server.ts`。
- 安全测试：`test/public-privacy-api.test.ts`、`test/public-privacy-client.test.tsx`、`test/public-privacy-rewrites.test.ts`、`test/credential-response.test.ts`，并更新 `test/client-key-security.test.ts`、`test/server-key-security.test.ts`。
