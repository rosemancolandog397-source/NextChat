/** @jest-environment node */
import { jest } from "@jest/globals";
import md5 from "spark-md5";
import { NextRequest } from "next/server";
import { ACCESS_CODE_PREFIX, ModelProvider } from "../app/constant";
import { serverOnlyApiKeys } from "../app/config/key-policy";

const originalEnv = { ...process.env };
// Deliberately invalid fixture credentials. No real provider is contacted.
const fixtureKey = "fixture-server-credential-not-a-real-key";
const fixtureCode = "fixture-access-password";
Object.assign(process.env, {
  SERVER_ONLY_API_KEY: "1",
  OPENAI_API_KEY: fixtureKey,
  BASE_URL: "https://openrouter.ai/api/v1",
  CODE: fixtureCode,
  DEFAULT_MODEL: "deepseek/deepseek-test",
  AI_ALLOWED_MODEL: "deepseek/deepseek-test",
  AI_BUDGET_REDIS_REST_URL: "https://quota-fixture.upstash.io",
  AI_BUDGET_REDIS_REST_TOKEN: "fixture-budget-token",
});
const { getServerSideConfig } = await import("../app/config/server");
const { auth } = await import("../app/api/auth");
const configRoute = await import("../app/api/config/route");
const proxyRoute = await import("../app/api/proxy");
const { requestOpenai } = await import("../app/api/common");

function request(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({
      model: "deepseek/deepseek-test",
      messages: [{ role: "user", content: "fixture" }],
      stream: false,
    }),
  });
}

afterAll(() => {
  process.env = originalEnv;
});
beforeEach(() => {
  jest.mocked(fetch).mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
});

test("production defaults to server-only and cannot opt out with 0", () => {
  expect(serverOnlyApiKeys({ BYOK_MODE: "0", NODE_ENV: "production" })).toBe(true);
  expect(
    serverOnlyApiKeys({ BYOK_MODE: "0", NODE_ENV: "production", SERVER_ONLY_API_KEY: "0" }),
  ).toBe(true);
  expect(serverOnlyApiKeys({ BYOK_MODE: "0", NODE_ENV: "development" })).toBe(false);
  expect(
    serverOnlyApiKeys({ BYOK_MODE: "0", NODE_ENV: "development", SERVER_ONLY_API_KEY: "1" }),
  ).toBe(true);
  expect(
    serverOnlyApiKeys({ BYOK_MODE: "0", NODE_ENV: "production", BUILD_MODE: "export" }),
  ).toBe(false);
});

test("server config loads fixture credentials without logging secrets", () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  const config = getServerSideConfig();
  expect(config.apiKey).toBe(fixtureKey);
  expect(config.hideUserApiKey).toBe(true);
  expect(config.disableFastLink).toBe(true);
  expect(log).not.toHaveBeenCalled();
});

test.each(["GET", "POST"] as const)(
  "%s /api/config returns only public fields",
  async (method) => {
    const result = await configRoute[method]();
    const json = await result.json();
    expect(Object.keys(json).sort()).toEqual(
      [
        "byokMode",
        "serverOnlyApiKey",
        "needCode",
        "hideUserApiKey",
        "disableGPT4",
        "hideBalanceQuery",
        "disableFastLink",
        "customModels",
        "defaultModel",
        "visionModels",
      ].sort(),
    );
    expect(JSON.stringify(json)).not.toContain(fixtureKey);
    expect(JSON.stringify(json)).not.toContain(fixtureCode);
    expect(JSON.stringify(json)).not.toContain(md5.hash(fixtureCode));
    expect(result.headers.get("cache-control")).toBe("no-store");
  },
);

test("access code is checked before server key injection and nothing is logged", () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  expect(auth(request(), ModelProvider.GPT).error).toBe(true);
  expect(
    auth(
      request({ Authorization: `Bearer ${ACCESS_CODE_PREFIX}wrong` }),
      ModelProvider.GPT,
    ).error,
  ).toBe(true);
  const req = request({
    Authorization: `Bearer ${ACCESS_CODE_PREFIX}${fixtureCode}`,
  });
  expect(auth(req, ModelProvider.GPT).error).toBe(false);
  expect(req.headers.get("Authorization")).toBe(`Bearer ${fixtureKey}`);
  expect(log).not.toHaveBeenCalled();
});

test.each(["Authorization", "api-key", "x-api-key", "x-goog-api-key"])(
  "rejects client-supplied %s",
  (header) => {
    expect(
      auth(
        request({ [header]: "fixture-client-credential" }),
        ModelProvider.GPT,
      ).error,
    ).toBe(true);
  },
);

test("custom proxy cannot exfiltrate a shared key to a lookalike hostname", async () => {
  const fetchMock = jest.spyOn(globalThis, "fetch");
  const req = request({
    "x-base-url": "https://api.openai.com.attacker.invalid",
  });
  expect(
    (
      await proxyRoute.handle(req, {
        params: { path: ["v1", "chat", "completions"] },
      })
    ).status,
  ).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("chat and non-streaming workbench payloads go to OpenRouter with only server-side auth", async () => {
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  const fetchMock = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) => {
      if (String(url).includes("quota-fixture.upstash.io"))
        return new Response(JSON.stringify({ result: [1, 0, 0] }));
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "fixture result" } }],
        }),
        {
          status: 200,
          headers: {
            Authorization: fixtureKey,
            "api-key": fixtureKey,
            "x-api-key": fixtureKey,
            "x-goog-api-key": fixtureKey,
          },
        },
      );
    });
  const req = request({
    Authorization: `Bearer ${ACCESS_CODE_PREFIX}${fixtureCode}`,
  });
  expect(auth(req, ModelProvider.GPT).error).toBe(false);
  const res = await requestOpenai(req);
  const [url, options] = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("openrouter.ai"),
  )!;
  expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(options?.method).toBe("POST");
  expect(new Headers(options?.headers).get("Authorization")).toBe(
    `Bearer ${fixtureKey}`,
  );
  for (const header of [
    "authorization",
    "api-key",
    "x-api-key",
    "x-goog-api-key",
  ])
    expect(res.headers.has(header)).toBe(false);
  expect(await res.text()).not.toContain(fixtureKey);
  expect(log).not.toHaveBeenCalled();
});

test("missing server key fails closed without falling back to a browser key", () => {
  delete process.env.OPENAI_API_KEY;
  try {
    expect(
      auth(
        request({
          Authorization: `Bearer ${ACCESS_CODE_PREFIX}${fixtureCode}`,
        }),
        ModelProvider.GPT,
      ),
    ).toEqual({ error: true, msg: "server api key is not configured" });
  } finally {
    process.env.OPENAI_API_KEY = fixtureKey;
  }
});

test("upstream exceptions cannot leak credentials through errors or logs", async () => {
  const route = await import("../app/api/openai");
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    if (String(url).includes("quota-fixture.upstash.io"))
      return new Response(JSON.stringify({ result: [1, 0, 0] }));
    throw new Error(`fixture failure ${fixtureKey}`);
  });
  const res = await route.handle(
    request({ Authorization: `Bearer ${ACCESS_CODE_PREFIX}${fixtureCode}` }),
    { params: { path: ["v1", "chat", "completions"] } },
  );
  expect(res.status).toBe(502);
  expect(await res.text()).not.toContain(fixtureKey);
  expect(log).not.toHaveBeenCalled();
});

test("public Upstash sync remains blocked without forwarding credentials", async () => {
  const { POST } = await import("../app/api/upstash/[action]/[...key]/route");
  const log = jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("fixture"));
  const req = new NextRequest(
    "http://localhost/api/upstash/set/test?endpoint=https://fixture.upstash.io",
    {
      method: "POST",
      headers: { Authorization: "Bearer fixture-cloud-token" },
      body: "fixture private content",
    },
  );
  expect(
    (
      await POST(req, {
        params: Promise.resolve({ action: "set", key: ["test"] }),
      })
    ).status,
  ).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});
