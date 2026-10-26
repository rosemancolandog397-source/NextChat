export const DEFAULT_AI_MODEL = "deepseek/deepseek-v4.1-flash-1017";

export function allowedAiModel(
  env: Record<string, string | undefined>,
): string {
  const model = env.AI_ALLOWED_MODEL?.trim() || DEFAULT_AI_MODEL;
  return /^deepseek\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,120}$/.test(model)
    ? model
    : "";
}

export function getAiCostPolicy(env: Record<string, string | undefined>) {
  function integer(name: string, fallback: number, ceiling: number) {
    const raw = env[name];
    const value = raw === undefined || raw === "" ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) {
      throw new Error("invalid AI cost policy");
    }
    return value;
  }
  const model = allowedAiModel(env);
  if (!model) throw new Error("invalid AI cost policy");
  return {
    model,
    requestsPerMinute: integer("AI_REQUESTS_PER_MINUTE", 6, 60),
    requestsPerDay: integer("AI_REQUESTS_PER_DAY", 100, 10000),
    maxBodyBytes: integer("AI_MAX_BODY_BYTES", 131072, 262144),
    maxInputChars: integer("AI_MAX_INPUT_CHARS", 20000, 50000),
    maxOutputTokens: integer("AI_MAX_OUTPUT_TOKENS", 4096, 8192),
  };
}

export type AiCostPolicy = ReturnType<typeof getAiCostPolicy>;
