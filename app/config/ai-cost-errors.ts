export const AI_COST_ERRORS = {
  AI_RATE_LIMIT: "请求过于频繁，本站每分钟调用额度已用完，请稍后再试。",
  AI_DAILY_LIMIT: "本站今日 AI 调用额度已用完，请明天（北京时间零点后）再试。",
  AI_INPUT_LIMIT: "输入过长，请缩短内容或聊天历史后重试；原有草稿不会被删除。",
  AI_MODEL_DENIED: "本站仅允许管理员指定的 DeepSeek 模型，请选择该模型。",
  AI_REQUEST_INVALID: "请求格式不受支持；本站费用保护模式仅支持单份文本回复。",
  AI_BUDGET_UNAVAILABLE:
    "费用保护服务未配置或暂时不可用，已暂停 AI 调用，请联系管理员。",
  AI_UPSTREAM_TIMEOUT: "模型响应超时，请缩短输入或稍后重试；已有草稿已保留。",
  AI_ENDPOINT_DENIED: "本站费用保护模式只开放指定 DeepSeek 的文本聊天接口。",
} as const;

export type AiCostErrorCode = keyof typeof AI_COST_ERRORS;
