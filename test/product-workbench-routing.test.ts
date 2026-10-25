import { jest } from "@jest/globals";
import { OpenaiPath, ServiceProvider } from "../app/constant";
const access = { useCustomConfig: true, openaiUrl: "https://openrouter.ai/api/v1" };
class FakeOpenAI {
  path(resource: string) {
    const base = access.useCustomConfig ? access.openaiUrl : "/api/openai";
    return `${base.replace(/\/$/, "")}/${resource}`;
  }
}
const ordinary = { llm: new FakeOpenAI() };
const other = { llm: { path: () => "other-provider" } };
jest.unstable_mockModule("@/app/store", () => ({ useAccessStore: { getState: () => access } }));
jest.unstable_mockModule("@/app/client/platforms/openai", () => ({ ChatGPTApi: FakeOpenAI }));
jest.unstable_mockModule("@/app/client/api", () => ({
  getClientApi: (provider: ServiceProvider) => provider === ServiceProvider.Google ? { ...other } : { ...ordinary },
}));
const { getWorkbenchClientApi, workbenchResourcePath } = await import("../app/client/product-workbench");
test.each([
  ["https://openrouter.ai/api/v1", "chat/completions"],
  ["https://openrouter.ai/api/v1/", "chat/completions"],
  ["https://openrouter.ai/api", "v1/chat/completions"],
  ["https://api.openai.com", "v1/chat/completions"],
  ["/api/openai", "v1/chat/completions"],
  ["", "v1/chat/completions"],
])("normalizes %s", (base, expected) => {
  expect(workbenchResourcePath(base, OpenaiPath.ChatPath)).toBe(expected);
});
test("changes only workbench client, preserving settings and original client", () => {
  expect((getWorkbenchClientApi(ServiceProvider.OpenAI).llm as unknown as FakeOpenAI).path(OpenaiPath.ChatPath)).toBe("https://openrouter.ai/api/v1/chat/completions");
  expect(ordinary.llm.path(OpenaiPath.ChatPath)).toBe("https://openrouter.ai/api/v1/v1/chat/completions");
  expect(access.openaiUrl).toBe("https://openrouter.ai/api/v1");
});
test("preserves proxy, Azure, other providers and non-chat resources", () => {
  access.useCustomConfig = false;
  expect((getWorkbenchClientApi(ServiceProvider.OpenAI).llm as unknown as FakeOpenAI).path(OpenaiPath.ChatPath)).toBe("/api/openai/v1/chat/completions");
  access.useCustomConfig = true;
  expect(getWorkbenchClientApi(ServiceProvider.Azure).llm).toBe(ordinary.llm);
  expect(getWorkbenchClientApi(ServiceProvider.Google).llm).toBe(other.llm);
  expect(workbenchResourcePath(access.openaiUrl, "v1/models")).toBe("v1/models");
});
