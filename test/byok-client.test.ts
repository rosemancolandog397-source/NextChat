import { jest } from "@jest/globals";
import {
  ApiPath,
  ACCESS_CODE_PREFIX,
  OpenaiPath,
  ServiceProvider,
  ModelProvider,
} from "../app/constant";
const access = {
  serverOnlyApiKey: true,
  useCustomConfig: true,
  openaiUrl: "https://openrouter.ai/api/v1",
  openaiApiKey: "fixture-old-browser-key",
  accessCode: "fixture-code",
  enabledAccessControl: () => true,
};
let buildPolicy = false;
jest.unstable_mockModule("@/app/store", () => ({
  useAccessStore: { getState: () => access },
  useChatStore: {
    getState: () => ({
      currentSession: () => ({
        mask: { modelConfig: { providerName: ServiceProvider.OpenAI } },
      }),
    }),
  },
  useAppConfig: { getState: () => ({}) },
  usePluginStore: { getState: () => ({}) },
}));
jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({
    buildMode: "standalone",
    serverOnlyApiKey: false,
    byokMode: true,
  }),
}));
for (const [file, exported] of Object.entries({
  google: "GeminiProApi",
  anthropic: "ClaudeApi",
  baidu: "ErnieApi",
  bytedance: "DoubaoApi",
  alibaba: "QwenApi",
  tencent: "HunyuanApi",
  moonshot: "MoonshotApi",
  iflytek: "SparkApi",
  deepseek: "DeepSeekApi",
  xai: "XAIApi",
  glm: "ChatGLMApi",
  siliconflow: "SiliconflowApi",
  ai302: "Ai302Api",
})) {
  jest.unstable_mockModule(`@/app/client/platforms/${file}`, () => ({
    [exported]: class {},
  }));
}
const { getHeaders, ClientApi } = await import("../app/client/api");
const { ChatGPTApi } = await import("../app/client/platforms/openai");
const { getWorkbenchClientApi } = await import(
  "../app/client/product-workbench"
);


test("BYOK sends the user's existing OpenAI key despite obsolete server-only flags", () => {
  expect(getHeaders().Authorization).toBe(`Bearer ${access.openaiApiKey}`);
  expect(JSON.stringify(getHeaders())).not.toContain("fixture-code");
});
test("BYOK never sends keys to stale custom URLs or gateways", () => {
  access.openaiUrl = "https://unnecessary.fixture.invalid/api/v1";
  expect(new ChatGPTApi().path("v1/chat/completions")).toBe("/api/openai/v1/chat/completions");
  expect((getWorkbenchClientApi(ServiceProvider.OpenAI).llm as InstanceType<typeof ChatGPTApi>).path("v1/chat/completions")).toBe("/api/openai/v1/chat/completions");
});
test("even stale provider selections use the OpenRouter-compatible adapter", () => {
  expect(new ClientApi(ModelProvider.GeminiPro).llm).toBeInstanceOf(ChatGPTApi);
});
test("a blank user key does not fall back to the access code", () => {
  access.openaiApiKey = "";
  expect(getHeaders().Authorization).toBeUndefined();
});
