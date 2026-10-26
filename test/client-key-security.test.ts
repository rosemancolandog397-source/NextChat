import { jest } from "@jest/globals";
import {
  ApiPath,
  ACCESS_CODE_PREFIX,
  OpenaiPath,
  ServiceProvider,
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
    serverOnlyApiKey: buildPolicy,
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

afterEach(() => {
  access.serverOnlyApiKey = true;
  access.accessCode = "fixture-code";
  buildPolicy = false;
});

test("ignores old browser API keys and sends only the access code", () => {
  expect(getHeaders().Authorization).toBe(
    `Bearer ${ACCESS_CODE_PREFIX}fixture-code`,
  );
  expect(JSON.stringify(getHeaders())).not.toContain(access.openaiApiKey);
  access.accessCode = "";
  expect(getHeaders().Authorization).toBeUndefined();
});

test("chat and workbench use the same local proxy even with persisted custom URL", () => {
  expect(new ChatGPTApi().path(OpenaiPath.ChatPath)).toBe(
    `${ApiPath.OpenAI}/v1/chat/completions`,
  );
  expect(
    (
      getWorkbenchClientApi(ServiceProvider.OpenAI).llm as InstanceType<
        typeof ChatGPTApi
      >
    ).path(OpenaiPath.ChatPath),
  ).toBe(`${ApiPath.OpenAI}/v1/chat/completions`);
});

test("build policy remains authoritative before config fetch or with stale browser settings", () => {
  access.serverOnlyApiKey = false;
  buildPolicy = true;
  expect(getHeaders().Authorization).toBe(
    `Bearer ${ACCESS_CODE_PREFIX}fixture-code`,
  );
  expect(new ChatGPTApi().path(OpenaiPath.ChatPath)).toBe(
    `${ApiPath.OpenAI}/v1/chat/completions`,
  );
  expect(
    (
      getWorkbenchClientApi(ServiceProvider.OpenAI).llm as InstanceType<
        typeof ChatGPTApi
      >
    ).path(OpenaiPath.ChatPath),
  ).toBe(`${ApiPath.OpenAI}/v1/chat/completions`);
});

test("direct ShareGPT calls cannot send a conversation in public mode", async () => {
  buildPolicy = true;
  jest.mocked(fetch).mockClear();
  await expect(new ClientApi().share([])).rejects.toThrow("公开版本");
  expect(fetch).not.toHaveBeenCalled();
});
