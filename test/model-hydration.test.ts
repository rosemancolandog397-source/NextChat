import { jest } from "@jest/globals";
import { StoreKey, ServiceProvider } from "../app/constant";
const model = "deepseek/deepseek-fixture-v99";
const memory = new Map<string, string>();
const delayed = new Map<string, (value: string | null) => void>();
let delay = false;
const removeItem = jest.fn();
const clear = jest.fn();
jest.unstable_mockModule("@/app/config/client", () => ({
  getClientConfig: () => ({
    buildMode: "standalone",
    serverOnlyApiKey: true,
    publicDefaultModel: model,
  }),
}));
jest.unstable_mockModule("@/app/utils/indexedDB-storage", () => ({
  indexedDBStorage: {
    getItem: async (key: string) =>
      delay
        ? new Promise<string | null>((resolve) => delayed.set(key, resolve))
        : memory.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      memory.set(key, value);
    },
    removeItem,
    clear,
  },
}));
const { useAppConfig, DEFAULT_CONFIG } = await import("../app/store/config");
const { useAccessStore } = await import("../app/store/access");
const { useChatStore } = await import("../app/store/chat");
const { collectModelsWithDefaultModel } = await import("../app/utils/model");
const initialConfig = useAppConfig.getState();
const initialAccess = useAccessStore.getState();
const initialChat = useChatStore.getState();

function assertAllowed() {
  expect(useAppConfig.getState().modelConfig.model).toBe(model);
  expect(useChatStore.getState().currentSession().mask.modelConfig.model).toBe(
    model,
  );
  const access = useAccessStore.getState(),
    config = useAppConfig.getState();
  const available = collectModelsWithDefaultModel(
    config.models,
    [config.customModels, access.customModels].join(","),
    access.defaultModel,
  ).filter((model) => model.available);
  expect(available.map((model) => model.name)).toEqual([model]);
}

beforeEach(async () => {
  delay = false;
  delayed.clear();
  memory.clear();
  useAppConfig.setState(initialConfig);
  useAccessStore.setState(initialAccess);
  useChatStore.setState(initialChat);
  memory.clear();
  removeItem.mockClear();
  clear.mockClear();
  jest.mocked(fetch).mockReset();
});
afterEach(() => {
  delay = false;
  delayed.clear();
  jest.restoreAllMocks();
});

test("fresh browser defaults and first session are allowed without /api/config", () => {
  expect(DEFAULT_CONFIG.modelConfig.model).toBe(model);
  assertAllowed();
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  [StoreKey.Config, StoreKey.Chat, StoreKey.Access],
  [StoreKey.Access, StoreKey.Chat, StoreKey.Config],
  [StoreKey.Chat, StoreKey.Access, StoreKey.Config],
  [StoreKey.Chat, StoreKey.Config, StoreKey.Access],
  [StoreKey.Config, StoreKey.Access, StoreKey.Chat],
  [StoreKey.Access, StoreKey.Config, StoreKey.Chat],
] as const)(
  "old stores hydrate in order %s/%s/%s without restoring GPT",
  async (...order) => {
    const oldGlobal = {
      ...initialConfig,
      modelConfig: {
        ...initialConfig.modelConfig,
        model: "gpt-4o-mini",
        temperature: 0.8,
      },
      customModels: "+gpt-4@OpenAI",
    };
    const historicalMessage = {
      id: "fixture-message",
      model: "gpt-4o-mini",
      role: "user",
      content: "原有聊天内容",
      date: "fixture-date",
    };
    const oldSession = {
      ...initialChat.sessions[0],
      id: "fixture-session",
      topic: "原会话标题",
      messages: [historicalMessage],
      memoryPrompt: "原有摘要",
      mask: {
        ...initialChat.sessions[0].mask,
        syncGlobalConfig: false,
        modelConfig: {
          ...initialConfig.modelConfig,
          model: "gpt-4",
          providerName: ServiceProvider.Azure,
          compressModel: "gpt-4",
          temperature: 0.7,
        },
      },
    };
    const oldChat = {
      ...initialChat,
      sessions: [oldSession],
      currentSessionIndex: 0,
    };
    const oldAccess = {
      ...initialAccess,
      serverOnlyApiKey: false,
      hideUserApiKey: false,
      customModels: "+gpt-4@OpenAI",
      defaultModel: "gpt-4@OpenAI",
      openaiApiKey: "fixture-old-key",
    };
    memory.set(
      StoreKey.Config,
      JSON.stringify({ state: oldGlobal, version: 4.1 }),
    );
    memory.set(StoreKey.Chat, JSON.stringify({ state: oldChat, version: 3.3 }));
    memory.set(
      StoreKey.Access,
      JSON.stringify({ state: oldAccess, version: 2 }),
    );
    delay = true;
    const stores = {
      [StoreKey.Config]: useAppConfig,
      [StoreKey.Chat]: useChatStore,
      [StoreKey.Access]: useAccessStore,
    };
    const pending = new Map(
      order.map((key) => [key, stores[key].persist.rehydrate()]),
    );
    for (const key of order) {
      const value = memory.get(key) ?? null;
      delayed.get(key)!(value);
      await pending.get(key);
      assertAllowed();
    }
    const restored = useChatStore.getState().currentSession();
    expect(restored.messages).toEqual([historicalMessage]);
    expect(restored.id).toBe(oldSession.id);
    expect(restored.topic).toBe(oldSession.topic);
    expect(restored.memoryPrompt).toBe(oldSession.memoryPrompt);
    expect(restored.mask.modelConfig.temperature).toBe(0.7);
    expect(restored.mask.modelConfig.compressModel).toBe(model);
    expect(useAppConfig.getState().modelConfig.temperature).toBe(0.8);
    expect(useAccessStore.getState().openaiApiKey).toBe("fixture-old-key");
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  },
);

test("a legacy custom mask cannot initialize a new unauthorized session", () => {
  useChatStore.getState().newSession({
    ...initialChat.sessions[0].mask,
    modelConfig: {
      ...initialConfig.modelConfig,
      model: "gpt-4",
      providerName: ServiceProvider.Azure,
    },
  });
  assertAllowed();
});

test("API config network failure does not cause a GPT fallback", async () => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.mocked(fetch).mockRejectedValue(new Error("fixture offline"));
  useAccessStore.getState().fetch();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertAllowed();
});
