import {
  normalizeModelSelection,
  publicModelAccessConfig,
} from "../app/utils/model-initialization";
import { collectModelsWithDefaultModel } from "../app/utils/model";
import { DEFAULT_MODELS } from "../app/constant";

const policy = {
  serverOnlyApiKey: true,
  publicDefaultModel: "deepseek/deepseek-fixture-v99",
};
const old = {
  model: "gpt-4o-mini",
  providerName: "Azure",
  compressModel: "gpt-4",
  compressProviderName: "OpenAI",
  temperature: 0.2,
  historyMessageCount: 17,
  template: "用户原模板",
};

test("public model comes from server metadata, not a hardcoded client model", () => {
  expect(normalizeModelSelection(old, policy)).toEqual({
    ...old,
    model: policy.publicDefaultModel,
    providerName: "OpenAI",
    compressModel: policy.publicDefaultModel,
    compressProviderName: "OpenAI",
  });
  expect(old.model).toBe("gpt-4o-mini");
});

test("the public selector contains only the allowed model before API config fetch", () => {
  const access = publicModelAccessConfig(policy);
  const available = collectModelsWithDefaultModel(
    DEFAULT_MODELS,
    `+gpt-4@OpenAI,${access.customModels}`,
    access.defaultModel!,
  ).filter((model) => model.available);
  expect(available.map((model) => model.name)).toEqual([
    policy.publicDefaultModel,
  ]);
  expect(available[0].provider?.providerName).toBe("OpenAI");
});

test.each([undefined, "", "gpt-4o-mini", "deepseek/model:online"])(
  "bad public metadata %s cannot fall back to an unauthorized model",
  (publicDefaultModel) => {
    const invalid = { serverOnlyApiKey: true, publicDefaultModel };
    expect(normalizeModelSelection(old, invalid).model).toBe("");
    expect(publicModelAccessConfig(invalid).customModels).toBe("-all");
  },
);

test("private development and desktop choices are unchanged", () => {
  expect(normalizeModelSelection(old, {})).toBe(old);
  expect(normalizeModelSelection(old, { serverOnlyApiKey: false })).toBe(old);
  expect(publicModelAccessConfig({})).toEqual({});
});
