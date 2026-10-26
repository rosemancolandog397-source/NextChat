/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { getAiCostPolicy } from "../app/config/ai-cost-policy";
import { AI_COST_ERRORS } from "../app/config/ai-cost-errors";
import {
  RESERVE_AI_QUOTA,
  prepareAiRequest,
  reserveAiQuota,
} from "../app/api/ai-cost-guard";

const originalEnv = { ...process.env };
const model = "deepseek/deepseek-fixture";
const env = {
  AI_ALLOWED_MODEL: model,
  AI_REQUESTS_PER_MINUTE: "2",
  AI_REQUESTS_PER_DAY: "3",
  AI_MAX_INPUT_CHARS: "100",
  AI_MAX_OUTPUT_TOKENS: "64",
  AI_MAX_BODY_BYTES: "1000",
  AI_BUDGET_REDIS_REST_URL: "https://quota-fixture.upstash.io",
  AI_BUDGET_REDIS_REST_TOKEN: "fixture-redis-credential",
  AI_BUDGET_NAMESPACE: "fixture-project",
};
function request(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const payload = (extra: Record<string, unknown> = {}) => ({
  model,
  messages: [{ role: "user", content: "fixture question" }],
  stream: false,
  ...extra,
});

beforeEach(() => {
  jest.mocked(fetch).mockReset();
  Object.assign(process.env, env);
  jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () => new Response(JSON.stringify({ result: [1, 0, 0] })),
    );
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  process.env = originalEnv;
});

test.each([true, false])(
  "normalizes chat and workbench payloads; stream=%s",
  async (stream) => {
    const result = JSON.parse(
      await prepareAiRequest(
        request(
          payload({
            stream,
            max_tokens: 1000000,
            max_completion_tokens: 1000000,
          }),
        ),
      ),
    );
    expect(result).toMatchObject({
      model,
      stream,
      max_tokens: 64,
      n: 1,
      provider: { require_parameters: true },
    });
    expect(result).not.toHaveProperty("max_completion_tokens");
    expect(result.messages[0].content).toBe("fixture question");
    const [url, options] = jest.mocked(fetch).mock.calls[0];
    expect(url).toBe(env.AI_BUDGET_REDIS_REST_URL);
    expect(options?.redirect).toBe("error");
    const command = JSON.parse(options?.body as string);
    expect(command).toEqual([
      "EVAL",
      RESERVE_AI_QUOTA,
      1,
      "fixture-project:{ai-cost}:usage",
      2,
      3,
    ]);
    expect(JSON.stringify(command)).not.toContain("fixture question");
    expect(JSON.stringify(command)).not.toContain(
      env.AI_BUDGET_REDIS_REST_TOKEN,
    );
  },
);

test("respects a smaller output cap requested by the client", async () => {
  expect(
    JSON.parse(
      await prepareAiRequest(
        request(payload({ max_tokens: 12, max_completion_tokens: 8 })),
      ),
    ).max_tokens,
  ).toBe(8);
});

test.each([
  "gpt-5",
  "deepseek/deepseek-pro",
  `${model}:online`,
  `${model}:free`,
])("rejects unapproved model %s without reserving quota", async (model) => {
  await expect(
    prepareAiRequest(request(payload({ model }))),
  ).rejects.toMatchObject({ code: "AI_MODEL_DENIED", status: 403 });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  { models: ["gpt-5"] },
  { route: "fallback" },
  { plugins: [{ id: "web" }] },
  { provider: { max_price: { prompt: 100 } } },
  { n: 2 },
  { n: -1 },
  { reasoning: { max_tokens: 100000 } },
  { tools: [{ type: "function" }] },
  { max_tokens: 0 },
  { max_completion_tokens: -1 },
  { max_tokens: 2.5 },
  { temperature: 1000 },
  { top_p: 5 },
  { stream: "true" },
])("rejects cost bypass fields %j before reserving", async (extra) => {
  await expect(prepareAiRequest(request(payload(extra)))).rejects.toMatchObject(
    { code: "AI_REQUEST_INVALID", status: 400 },
  );
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "not json",
  [],
  null,
  payload({ messages: [] }),
  payload({
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: "https://example.invalid" } },
        ],
      },
    ],
  }),
])("rejects malformed or multimodal input", async (body) => {
  await expect(prepareAiRequest(request(body))).rejects.toMatchObject({
    code: "AI_REQUEST_INVALID",
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("checks the whole message history, not only the newest message", async () => {
  const body = payload({
    messages: [
      { role: "system", content: "x".repeat(70) },
      { role: "user", content: "x".repeat(31) },
    ],
  });
  await expect(prepareAiRequest(request(body))).rejects.toMatchObject({
    code: "AI_INPUT_LIMIT",
    status: 413,
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("checks declared and actual chunked body byte limits", async () => {
  await expect(
    prepareAiRequest(request(payload(), { "Content-Length": "2000" })),
  ).rejects.toMatchObject({ status: 413 });
  const bytes = new TextEncoder().encode("x".repeat(1001));
  const req = new NextRequest(
    "http://localhost/api/openai/v1/chat/completions",
    {
      method: "POST",
      body: new ReadableStream({
        start(c) {
          c.enqueue(bytes.subarray(0, 600));
          c.enqueue(bytes.subarray(600));
          c.close();
        },
      }),
      duplex: "half",
    } as ConstructorParameters<typeof NextRequest>[1],
  );
  await expect(prepareAiRequest(req)).rejects.toMatchObject({
    code: "AI_INPUT_LIMIT",
    status: 413,
  });
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  [{ result: [0, 1, 40] }, "AI_RATE_LIMIT", 429, 40],
  [{ result: [0, 2, 3600] }, "AI_DAILY_LIMIT", 429, 3600],
  [
    { error: "fixture credential must not leak" },
    "AI_BUDGET_UNAVAILABLE",
    503,
    undefined,
  ],
  [{ result: [1, 9, 0] }, "AI_BUDGET_UNAVAILABLE", 503, undefined],
  [{ result: [0, 2, -1] }, "AI_BUDGET_UNAVAILABLE", 503, undefined],
])(
  "interprets atomic storage denial %j",
  async (result, code, status, retryAfter) => {
    jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify(result)));
    await expect(prepareAiRequest(request(payload()))).rejects.toMatchObject({
      code,
      status,
      retryAfter,
    });
  },
);

test.each([
  {},
  {
    AI_BUDGET_REDIS_REST_URL: "https://fixture.upstash.io.evil.invalid",
    AI_BUDGET_REDIS_REST_TOKEN: "fixture",
  },
  {
    AI_BUDGET_REDIS_REST_URL: "http://fixture.upstash.io",
    AI_BUDGET_REDIS_REST_TOKEN: "fixture",
  },
])("fails closed for missing or unsafe quota storage", async (invalid) => {
  await expect(
    reserveAiQuota(getAiCostPolicy(env), invalid),
  ).rejects.toMatchObject({ code: "AI_BUDGET_UNAVAILABLE" });
  expect(fetch).not.toHaveBeenCalled();
});

test("quota backend network/HTTP failures never expose credentials", async () => {
  jest
    .mocked(fetch)
    .mockRejectedValue(new Error(env.AI_BUDGET_REDIS_REST_TOKEN));
  await expect(prepareAiRequest(request(payload()))).rejects.toMatchObject({
    message: AI_COST_ERRORS.AI_BUDGET_UNAVAILABLE,
  });
  jest
    .mocked(fetch)
    .mockResolvedValue(new Response("fixture", { status: 500 }));
  await expect(prepareAiRequest(request(payload()))).rejects.toMatchObject({
    code: "AI_BUDGET_UNAVAILABLE",
  });
});

test.each([
  { AI_REQUESTS_PER_DAY: "NaN" },
  { AI_MAX_OUTPUT_TOKENS: "9999999" },
  { AI_REQUESTS_PER_MINUTE: "0" },
  { AI_ALLOWED_MODEL: "openai/gpt-5" },
])("invalid administrator policy does not disable protection", (extra) => {
  expect(() => getAiCostPolicy({ ...env, ...extra })).toThrow(
    "invalid AI cost policy",
  );
});
