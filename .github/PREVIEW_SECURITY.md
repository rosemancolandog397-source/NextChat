# 预览部署的安全边界

## 行为变化

预览部署不再由 PR 自动触发，也不检出、构建或执行 PR 代码。
维护者在 Actions 中从默认分支手动运行 `Trusted default-branch preview`，填写一个仍打开的 PR 编号。
它部署的是本次工作流启动时默认分支的提交，评论会明确标为“默认分支演示预览”，不能用于验收该 PR 的改动。
非默认分支的手动运行会跳过部署。

保留 Vercel Preview 构建、直接预览链接评论，以及 PR 关闭后的自动清理。
不再生成分支哈希，也不再自动绑定旧的自定义别名域名；`VERCEL_TEAM` 和 `VERCEL_PR_DOMAIN_SUFFIX` 不再被这两个工作流使用。
普通 PR 的代码检查仍由原有测试工作流处理。

## 凭据与权限

- 沿用现有 GitHub Secrets 名称：`VERCEL_TOKEN`、`VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`；文档不提供真实值。
- 未配置凭据时，部署明确报错；清理直接跳过，不进行 API 调用。
- 只有默认分支的已信任应用和构建依赖可接触部署环境；不要把未审查代码合并进默认分支。
- 检出时不保留 Git 认证，Actions 使用固定提交 SHA，Vercel CLI 固定版本，不共用 PR 构建缓存。
- 清理仍使用 `pull_request_target: closed`，仅因为关闭事件需处理外部 PR；它不检出代码、不运行 Shell 或仓库脚本，GitHub 权限为空。

## 精确清理

新预览记录仓库、PR 编号、来源类型和源码提交四项元数据。
清理只删除指定 Vercel 项目中，仓库及 PR 编号完全相同、来源为 `trusted-default-branch` 的非生产部署。
PR 分支名、标题和正文不进入执行代码，也不用于匹配。
列表分页有界，异常响应、无效部署 ID 和异常游标会使清理失败并停止；已不存在的部署可以安全跳过。
两条工作流使用同一 PR 并发组串行运行，降低关闭 PR 与部署同时进行的竞争风险。

旧流程生成的 `base_hash` 部署不会被新清理逻辑猜测或批量删除，需要维护者在 Vercel 中单独核对处理。

## 尚需线上验收

本地检查使用模拟 GitHub／Vercel 响应，不读取真实部署凭据、不创建或删除实际部署。
提交并启用后，应先用测试 Vercel 项目验证手动预览、评论及关 PR 清理。
项目管理员仍应限制部署 Token 的项目范围、保护默认分支，并按需配置受保护的部署环境。
GitHub 的 Actions 事件策略可能限制 `pull_request_target`；如阻止清理，应按组织策略审批该“仅元数据”流程，而不要恢复 PR 代码执行。

本地回归检查：`yarn test:ci --runInBand test/workflow-security.test.ts`。

参考：[GitHub 的 pull_request_target 安全说明](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)、[脚本注入防护](https://docs.github.com/en/actions/concepts/security/script-injections)。
