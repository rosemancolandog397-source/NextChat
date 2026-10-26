/** @jest-environment node */
import { jest } from "@jest/globals";
import { NextRequest } from "next/server";

const routed: { provider: string; params: unknown }[] = [];
for (const provider of [
  "openai",
  "azure",
  "google",
  "anthropic",
  "baidu",
  "bytedance",
  "alibaba",
  "moonshot",
  "stability",
  "iflytek",
  "deepseek",
  "siliconflow",
  "xai",
  "glm",
  "proxy",
  "302ai",
]) {
  jest.unstable_mockModule(`@/app/api/${provider}`, () => ({
    handle: async (_request: NextRequest, context: { params: unknown }) => {
      routed.push({ provider, params: context.params });
      return new Response("mock response", { status: 200 });
    },
  }));
}
jest.unstable_mockModule("@/app/config/server", () => ({
  getServerSideConfig: () => ({ allowedWebDavEndpoints: [] }),
}));
jest.unstable_mockModule("@/app/api/auth", () => ({
  auth: () => ({ error: true, msg: "blocked by test" }),
}));
const providerRoute = await import("../app/api/[provider]/[...path]/route");
const upstash = await import("../app/api/upstash/[action]/[...key]/route");
const webdav = await import("../app/api/webdav/[...path]/route");
const tencent = await import("../app/api/tencent/route");

beforeEach(() => {
  routed.length = 0;
  jest.mocked(fetch).mockClear();
});

test.each(["openai", "deepseek"])(
  "Next 15 promised params preserve the %s model route",
  async (provider) => {
    const params = { provider, path: ["v1", "chat", "completions"] };
    const response = await providerRoute.POST(
      new NextRequest(`http://localhost/api/${provider}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({ model: "configured-model" }),
      }),
      { params: Promise.resolve(params) },
    );
    expect(response.status).toBe(200);
    expect(routed).toEqual([{ provider, params }]);
    expect(fetch).not.toHaveBeenCalled();
  },
);

test("route waits for params instead of dispatching with undefined provider", async () => {
  let resolve!: (params: { provider: string; path: string[] }) => void;
  const params = new Promise<{ provider: string; path: string[] }>((done) => {
    resolve = done;
  });
  const pending = providerRoute.GET(
    new NextRequest("http://localhost/api/openai/v1/models"),
    { params },
  );
  expect(routed).toEqual([]);
  resolve({ provider: "openai", path: ["v1", "models"] });
  await pending;
  expect(routed[0].provider).toBe("openai");
});

test("Upstash resolves params while retaining endpoint restrictions", async () => {
  const response = await upstash.GET(
    new NextRequest(
      "http://localhost/api/upstash/get/key?endpoint=https://example.com",
    ),
    { params: Promise.resolve({ action: "get", key: ["key"] }) },
  );
  expect(response.status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});

test("WebDAV resolves params while retaining endpoint restrictions", async () => {
  const response = await webdav.GET(
    new NextRequest("http://localhost/api/webdav/file"),
    {
      params: Promise.resolve({ path: ["file"] }),
    },
  );
  expect(response.status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

test("static Tencent route preserves authentication rejection without dynamic params", async () => {
  const response = await tencent.POST(
    new NextRequest("http://localhost/api/tencent/chat", {
      method: "POST",
      body: "{}",
    }),
  );
  expect(response.status).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});

test("model route uses the Hobby-compatible Node runtime and duration", () => {
  expect(providerRoute.runtime).toBe("nodejs");
  expect(providerRoute.maxDuration).toBe(300);
  expect(providerRoute.preferredRegion).toBe("iad1");
});
