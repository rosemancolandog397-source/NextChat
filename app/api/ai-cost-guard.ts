import { NextRequest, NextResponse } from "next/server";
import { AI_COST_ERRORS, type AiCostErrorCode } from "../config/ai-cost-errors";
import { getAiCostPolicy, type AiCostPolicy } from "../config/ai-cost-policy";

export class AiCostError extends Error {
  constructor(
    public readonly code: AiCostErrorCode,
    public readonly status: number,
    public readonly retryAfter?: number,
  ) {
    super(AI_COST_ERRORS[code]);
  }
}

export function aiCostResponse(error: AiCostError) {
  return NextResponse.json(
    { error: { code: error.code, message: error.message } },
    {
      status: error.status,
      headers: {
        "Cache-Control": "no-store",
        "X-AI-Error-Code": error.code,
        ...(error.retryAfter
          ? { "Retry-After": String(error.retryAfter) }
          : {}),
      },
    },
  );
}

// Redis TIME is authoritative across instances. Both counters are reserved in
// one atomic script, before any model request. A failure/cancellation is not refunded.
export const RESERVE_AI_QUOTA = `
local now = tonumber(redis.call('TIME')[1])
local day = math.floor((now + 28800) / 86400)
local minute = math.floor(now / 60)
local data = redis.call('HMGET', KEYS[1], 'day', 'daily', 'minute', 'rate')
local daily = 0
local rate = 0
if tonumber(data[1]) == day then daily = tonumber(data[2]) or 0 end
if tonumber(data[3]) == minute then rate = tonumber(data[4]) or 0 end
if daily >= tonumber(ARGV[2]) then
  return {0, 2, (day + 1) * 86400 - 28800 - now}
end
if rate >= tonumber(ARGV[1]) then return {0, 1, 60 - (now % 60)} end
redis.call('HSET', KEYS[1], 'day', day, 'daily', daily + 1, 'minute', minute, 'rate', rate + 1)
redis.call('EXPIRE', KEYS[1], 172800)
return {1, 0, 0}
`;

export async function reserveAiQuota(
  policy: AiCostPolicy,
  env: Record<string, string | undefined> = process.env,
) {
  const endpoint = env.AI_BUDGET_REDIS_REST_URL;
  const token = env.AI_BUDGET_REDIS_REST_TOKEN;
  const namespace = env.AI_BUDGET_NAMESPACE || "nextchat-production";
  try {
    const url = new URL(endpoint || "");
    if (
      !token ||
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".upstash.io") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "/" && url.pathname !== "") ||
      (url.port && url.port !== "443") ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)
    )
      throw new Error("invalid budget storage");
    const response = await fetch(url.origin, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        "EVAL",
        RESERVE_AI_QUOTA,
        1,
        `${namespace}:{ai-cost}:usage`,
        policy.requestsPerMinute,
        policy.requestsPerDay,
      ]),
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("budget storage failed");
    const result = await response.json();
    if (
      result.error ||
      !Array.isArray(result.result) ||
      result.result.length !== 3
    ) {
      throw new Error("invalid budget response");
    }
    const [accepted, reason, retryAfter] = result.result;
    if (accepted === 1 && reason === 0 && retryAfter === 0) return;
    if (
      accepted !== 0 ||
      !Number.isSafeInteger(retryAfter) ||
      retryAfter < 1 ||
      retryAfter > 86400
    ) {
      throw new Error("invalid budget response");
    }
    if (reason === 1) throw new AiCostError("AI_RATE_LIMIT", 429, retryAfter);
    if (reason === 2) throw new AiCostError("AI_DAILY_LIMIT", 429, retryAfter);
    throw new Error("invalid budget response");
  } catch (error) {
    if (error instanceof AiCostError) throw error;
    // Never return Redis errors, endpoints, request options or credentials.
    throw new AiCostError("AI_BUDGET_UNAVAILABLE", 503);
  }
}

async function readBoundedBody(req: NextRequest, limit: number) {
  const length = req.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) {
    throw new AiCostError("AI_INPUT_LIMIT", 413);
  }
  const reader = req.body?.getReader();
  if (!reader) throw new AiCostError("AI_REQUEST_INVALID", 400);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new AiCostError("AI_INPUT_LIMIT", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function sanitizePayload(body: any, policy: AiCostPolicy) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AiCostError("AI_REQUEST_INVALID", 400);
  }
  if (body.model !== policy.model)
    throw new AiCostError("AI_MODEL_DENIED", 403);
  // No alternate models, paid search/plugins, multi-sample output or tool loops.
  for (const key of [
    "models",
    "route",
    "plugins",
    "tools",
    "tool_choice",
    "functions",
    "function_call",
    "provider",
    "transforms",
    "modalities",
    "audio",
    "image_config",
    "prediction",
    "reasoning",
  ]) {
    if (body[key] !== undefined)
      throw new AiCostError("AI_REQUEST_INVALID", 400);
  }
  if (
    (body.n !== undefined && body.n !== 1) ||
    (body.stream !== undefined && typeof body.stream !== "boolean")
  ) {
    throw new AiCostError("AI_REQUEST_INVALID", 400);
  }
  if (
    !Array.isArray(body.messages) ||
    !body.messages.length ||
    body.messages.length > 64
  ) {
    throw new AiCostError("AI_REQUEST_INVALID", 400);
  }
  let chars = 0;
  const messages = body.messages.map((message: any) => {
    if (
      !message ||
      !["system", "developer", "user", "assistant"].includes(message.role)
    ) {
      throw new AiCostError("AI_REQUEST_INVALID", 400);
    }
    let content = message.content;
    if (Array.isArray(content)) {
      if (
        !content.every(
          (part: any) => part?.type === "text" && typeof part.text === "string",
        )
      ) {
        throw new AiCostError("AI_REQUEST_INVALID", 400);
      }
      content = content.map((part: any) => part.text).join("\n");
    }
    if (typeof content !== "string")
      throw new AiCostError("AI_REQUEST_INVALID", 400);
    chars += content.length;
    if (chars > policy.maxInputChars)
      throw new AiCostError("AI_INPUT_LIMIT", 413);
    return { role: message.role, content };
  });
  let maxTokens = policy.maxOutputTokens;
  for (const key of ["max_tokens", "max_completion_tokens"]) {
    if (body[key] !== undefined) {
      if (!Number.isSafeInteger(body[key]) || body[key] < 1)
        throw new AiCostError("AI_REQUEST_INVALID", 400);
      maxTokens = Math.min(maxTokens, body[key]);
    }
  }
  const payload: Record<string, unknown> = {
    model: policy.model,
    messages,
    stream: body.stream === true,
    max_tokens: maxTokens,
    n: 1,
    // Require the upstream to support the enforced token cap.
    provider: { require_parameters: true },
  };
  for (const [key, min, max] of [
    ["temperature", 0, 2],
    ["top_p", 0, 1],
    ["presence_penalty", -2, 2],
    ["frequency_penalty", -2, 2],
  ] as const) {
    if (body[key] !== undefined) {
      if (
        typeof body[key] !== "number" ||
        !Number.isFinite(body[key]) ||
        body[key] < min ||
        body[key] > max
      )
        throw new AiCostError("AI_REQUEST_INVALID", 400);
      payload[key] = body[key];
    }
  }
  return JSON.stringify(payload);
}

export async function prepareAiRequest(req: NextRequest, useSharedQuota = true) {
  let policy: AiCostPolicy;
  try {
    policy = getAiCostPolicy(process.env);
  } catch {
    throw new AiCostError("AI_BUDGET_UNAVAILABLE", 503);
  }
  let body: unknown;
  try {
    body = JSON.parse(await readBoundedBody(req, policy.maxBodyBytes));
  } catch (error) {
    if (error instanceof AiCostError) throw error;
    throw new AiCostError("AI_REQUEST_INVALID", 400);
  }
  const payload = sanitizePayload(body, policy);
  if (useSharedQuota) await reserveAiQuota(policy);
  return payload;
}
