/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { ACCESS_CODE_PREFIX } from "../app/constant";
import { RESERVE_AI_QUOTA } from "../app/api/ai-cost-guard";

const originalEnv = { ...process.env };
const model = "deepseek/deepseek-fixture";
Object.assign(process.env, {
  SERVER_ONLY_API_KEY: "1",
  OPENAI_API_KEY: "fixture-server-key",
  CODE: "fixture-code",
  AI_ALLOWED_MODEL: model,
  BASE_URL: "https://openrouter.ai/api/v1",
  AI_REQUESTS_PER_MINUTE: "2",
  AI_REQUESTS_PER_DAY: "3",
  AI_BUDGET_REDIS_REST_URL: "https://quota-fixture.upstash.io",
  AI_BUDGET_REDIS_REST_TOKEN: "fixture-quota-token",
});
const route = await import("../app/api/[provider]/[...path]/route");
// The mock implements the external store's atomic reservation contract. It does
// not execute Lua or prove a real Redis deployment; no external network is used.
let now = Date.UTC(2026, 9, 26, 15, 0) / 1000;
let minute = -1,
  day = -1,
  rate = 0,
  daily = 0,
  forwarded = 0;
let upstreamStatus = 200;
let sentBodies: any[] = [];

function call(
  extra: Record<string, unknown> = {},
  provider = "openai",
  path = ["v1", "chat", "completions"],
  method = "POST",
  code = "fixture-code",
) {
  const headers = {
    Authorization: `Bearer ${ACCESS_CODE_PREFIX}${code}`,
    "Content-Type": "application/json",
  };
  const req = new NextRequest(
    `http://localhost/api/${provider}/${path.join("/")}`,
    {
      method,
      headers,
      ...(method === "POST"
        ? {
            body: JSON.stringify({
              model,
              stream: false,
              messages: [{ role: "user", content: "fixture" }],
              ...extra,
            }),
          }
        : {}),
    },
  );
  return route[method === "GET" ? "GET" : "POST"](req, {
    params: Promise.resolve({ provider, path }),
  });
}

beforeEach(() => {
  jest.mocked(fetch).mockReset();
  now = Date.UTC(2026, 9, 26, 15, 0) / 1000;
  minute = day = -1;
  rate = daily = forwarded = 0;
  sentBodies = [];
  upstreamStatus = 200;
  jest.spyOn(globalThis, "fetch").mockImplementation(async (url, options) => {
    if (String(url) === "https://quota-fixture.upstash.io") {
      const command = JSON.parse(options?.body as string);
      expect(command.slice(0, 3)).toEqual(["EVAL", RESERVE_AI_QUOTA, 1]);
      const currentMinute = Math.floor(now / 60),
        currentDay = Math.floor((now + 28800) / 86400);
      if (minute !== currentMinute) {
        minute = currentMinute;
        rate = 0;
      }
      if (day !== currentDay) {
        day = currentDay;
        daily = 0;
      }
      let result: number[];
      if (daily >= command[5]) result = [0, 2, (day + 1) * 86400 - 28800 - now];
      else if (rate >= command[4]) result = [0, 1, 60 - (now % 60)];
      else {
        rate++;
        daily++;
        result = [1, 0, 0];
      }
      return new Response(JSON.stringify({ result }));
    }
    expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
    forwarded++;
    expect(new Headers(options?.headers).get("Authorization")).toBe(
      "Bearer fixture-server-key",
    );
    sentBodies.push(JSON.parse(options?.body as string));
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "fixture response" } }],
      }),
      { status: upstreamStatus },
    );
  });
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  process.env = originalEnv;
});

test("chat, clarification and PRD share one daily budget and enforced output cap", async () => {
  for (const [index, task] of ["chat", "clarification", "prd"].entries()) {
    if (index === 2) now += 61;
    const res = await call({
      stream: task === "chat",
      messages: [{ role: "user", content: task }],
      max_tokens: 999999,
    });
    expect(res.status).toBe(200);
  }
  expect(forwarded).toBe(3);
  expect(
    sentBodies.every(
      (body) =>
        body.model === model && body.max_tokens === 4096 && body.n === 1,
    ),
  ).toBe(true);
  const denied = await call();
  expect(denied.status).toBe(429);
  expect(denied.headers.get("X-AI-Error-Code")).toBe("AI_DAILY_LIMIT");
  expect(await denied.text()).toContain("今日");
  expect(forwarded).toBe(3);
});

test("concurrent route calls cannot forward beyond accepted reservations", async () => {
  const results = await Promise.all(Array.from({ length: 12 }, () => call()));
  expect(results.filter((res) => res.status === 200)).toHaveLength(2);
  expect(results.filter((res) => res.status === 429)).toHaveLength(10);
  expect(forwarded).toBe(2);
  expect(
    results.find((res) => res.status === 429)?.headers.get("Retry-After"),
  ).toBeTruthy();
});

test("minute window resets, but daily count persists until Beijing midnight", async () => {
  expect((await call()).status).toBe(200);
  expect((await call()).status).toBe(200);
  expect((await call()).headers.get("X-AI-Error-Code")).toBe("AI_RATE_LIMIT");
  now += 61;
  expect((await call()).status).toBe(200);
  now = Date.UTC(2026, 9, 26, 15, 59, 59) / 1000;
  expect((await call()).headers.get("X-AI-Error-Code")).toBe("AI_DAILY_LIMIT");
  now++;
  expect((await call()).status).toBe(200);
});

test.each([
  ["openai", ["v1", "audio", "speech"]],
  ["openai", ["v1", "images", "generations"]],
  ["azure", ["deployments", "fixture", "chat", "completions"]],
  ["deepseek", ["v1", "chat", "completions"]],
  ["google", ["v1", "fixture"]],
  ["proxy", ["v1", "chat", "completions"]],
])("alternate endpoint %s/%j cannot bypass quota", async (provider, path) => {
  expect((await call({}, provider, path)).status).toBeGreaterThanOrEqual(400);
  expect(fetch).not.toHaveBeenCalled();
});

test("model list is local and exposes only the allowed model", async () => {
  const res = await call({}, "openai", ["v1", "models"], "GET");
  expect(await res.json()).toEqual({
    object: "list",
    data: [{ id: model, object: "model" }],
  });
  expect(fetch).not.toHaveBeenCalled();
});

test("bad access code and expensive model never reach storage or upstream", async () => {
  expect((await call({}, "openai", undefined, "POST", "wrong")).status).toBe(
    401,
  );
  expect((await call({ model: "openai/gpt-5" })).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});

test("upstream failures still consume reservations; no automatic refund or retry", async () => {
  upstreamStatus = 503;
  expect((await call()).status).toBe(503);
  expect((await call()).status).toBe(503);
  expect((await call()).status).toBe(429);
  expect(forwarded).toBe(2);
});

test("quota storage failure stops the model request without credential leakage", async () => {
  jest.mocked(fetch).mockRejectedValue(new Error("fixture-quota-token"));
  const res = await call();
  expect(res.status).toBe(503);
  expect(res.headers.get("X-AI-Error-Code")).toBe("AI_BUDGET_UNAVAILABLE");
  expect(await res.text()).not.toContain("fixture-quota-token");
  expect(forwarded).toBe(0);
});

test("first public session default is accepted by the protected model route", async () => {
  const { useChatStore } = await import("../app/store/chat");
  const selection = useChatStore.getState().currentSession().mask.modelConfig;
  expect(selection.model).toBe(model);
  const response = await call({ model: selection.model });
  expect(response.status).toBe(200);
  expect(forwarded).toBe(1);
});

test("legacy model selection is normalized before a protected request", async () => {
  const { normalizeModelSelection } = await import(
    "../app/utils/model-initialization"
  );
  const { getBuildConfig } = await import("../app/config/build");
  const selection = normalizeModelSelection(
    { model: "gpt-4o-mini", providerName: "Azure" },
    getBuildConfig(),
  );
  const response = await call({ model: selection.model });
  expect(response.status).toBe(200);
  expect(forwarded).toBe(1);
});

test("a slow non-streaming generation returns a safe 504 without retrying or leaking credentials", async () => {
  jest.useFakeTimers();
  let modelSignal: AbortSignal | undefined;
  jest.mocked(fetch).mockImplementation(async (url, options) => {
    if (String(url).includes("quota-fixture.upstash.io")) {
      return new Response(JSON.stringify({ result: [1, 0, 0] }));
    }
    modelSignal = options?.signal as AbortSignal;
    return new Response(new ReadableStream({ start() {} }));
  });
  try {
    const pending = call();
    await jest.advanceTimersByTimeAsync(50001);
    const response = await pending;
    expect(response.status).toBe(504);
    expect(response.headers.get("X-AI-Error-Code")).toBe("AI_UPSTREAM_TIMEOUT");
    const body = await response.text();
    expect(body).not.toContain("fixture-server-key");
    expect(body).not.toContain("fixture-quota-token");
    expect(modelSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2); // One quota reservation and one model attempt.
  } finally {
    jest.useRealTimers();
  }
});
