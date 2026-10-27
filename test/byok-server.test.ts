/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";
import { ACCESS_CODE_PREFIX } from "../app/constant";
import { byokMode } from "../app/config/key-policy";

const originalEnv = { ...process.env };
Object.assign(process.env, {
  BYOK_MODE: "1", SERVER_ONLY_API_KEY: "1", HIDE_USER_API_KEY: "1",
  OPENAI_API_KEY: "fixture-owner-must-never-be-used", DEEPSEEK_API_KEY: "fixture-owner-other-provider",
  BASE_URL: "https://unnecessary.fixture.invalid", CODE: "fixture-old-site-password",
  CLOUDFLARE_AI_GATEWAY_URL: "https://unnecessary.fixture.invalid",
  AI_ALLOWED_MODEL: "deepseek/deepseek-fixture",
});
delete process.env.AI_BUDGET_REDIS_REST_URL;
delete process.env.AI_BUDGET_REDIS_REST_TOKEN;
const route = await import("../app/api/[provider]/[...path]/route");
const { getServerSideConfig } = await import("../app/config/server");
const configRoute = await import("../app/api/config/route");
const { requestOpenai } = await import("../app/api/common");
const { publicDataAccessBlocked } = await import("../app/api/public-privacy");

function request(token = "", path = "openai/v1/chat/completions", model = "deepseek/deepseek-fixture") {
  return new NextRequest(`http://localhost/api/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ model, stream: false, max_tokens: 99999, messages: [{ role: "user", content: "fixture" }] }),
  });
}
async function call(token = "", provider = "openai", model?: string) {
  return route.POST(request(token, `${provider}/v1/chat/completions`, model), {
    params: Promise.resolve({ provider, path: ["v1", "chat", "completions"] }),
  });
}
beforeEach(() => {
  jest.mocked(fetch).mockReset();
  jest.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "fixture answer" } }] })));
});
afterAll(() => { process.env = originalEnv; });

test("BYOK is the default; legacy server keys and conflicting flags are ignored", async () => {
  expect(byokMode({})).toBe(true);
  const config = getServerSideConfig();
  expect(config.byokMode).toBe(true);
  expect(config.serverOnlyApiKey).toBe(false);
  expect(config.apiKey).toBe("");
  expect(config.deepseekApiKey).toBe("");
  expect(config.hideUserApiKey).toBe(false);
  const response = await configRoute.GET();
  const json = await response.json();
  expect(json.byokMode).toBe(true);
  expect(JSON.stringify(json)).not.toContain("fixture-owner");
});

test.each(["", `${ACCESS_CODE_PREFIX}fixture-old-site-password`])("missing user key or site password %s cannot consume owner balance", async (token) => {
  expect((await call(token)).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test.each(["fixture-user-one", "fixture-user-two"])("forwards only %s to fixed OpenRouter, without Redis or owner fallback", async (key) => {
  const response = await call(key);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("fixture answer");
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = jest.mocked(fetch).mock.calls[0];
  expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${key}`);
  expect(JSON.parse(options?.body as string).max_tokens).toBe(4096);
  expect(JSON.stringify(options)).not.toContain("fixture-owner");
});

test.each(["azure", "deepseek", "tencent", "google", "proxy"])("alternate provider %s cannot use server credentials", async (provider) => {
  const response = await call("fixture-user-one", provider);
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(fetch).not.toHaveBeenCalled();
});

test("a direct shared helper call without user auth is also blocked", async () => {
  expect((await requestOpenai(request())).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test("an invalid user key never triggers a retry using the owner's key", async () => {
  jest.mocked(fetch).mockResolvedValue(new Response("upstream private error fixture-user-one", { status: 401 }));
  const response = await call("fixture-user-one");
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain("fixture-user-one");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("cloud backup/share remains blocked and expensive models remain denied", async () => {
  expect(publicDataAccessBlocked()?.status).toBe(403);
  expect((await call("fixture-user-one", "openai", "gpt-4o")).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});

test("user-key model discovery stays local and does not reveal any credentials", async () => {
  const response = await route.GET(new NextRequest("http://localhost/api/openai/v1/models", {
    headers: { Authorization: "Bearer fixture-user-one" },
  }), { params: Promise.resolve({ provider: "openai", path: ["v1", "models"] }) });
  expect(response.status).toBe(200);
  expect(await response.text()).not.toContain("fixture-user-one");
  expect(fetch).not.toHaveBeenCalled();
});

test("the standalone Tencent route also cannot consume its configured server key", async () => {
  const tencent = await import("../app/api/tencent/route");
  expect((await tencent.POST(request("fixture-user-one", "tencent"))).status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
