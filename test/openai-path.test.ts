import { openAIResourcePath } from "../app/client/openai-path";

test.each([
  ["https://openrouter.ai/api/v1", "chat/completions"],
  ["https://openrouter.ai/api/v1/", "chat/completions"],
  ["https://openrouter.ai/api", "v1/chat/completions"],
  ["https://api.openai.com/v1", "chat/completions"],
  ["/api/openai", "v1/chat/completions"],
])("joins the chat resource correctly for %s", (base, expected) => {
  expect(openAIResourcePath(base, "v1/chat/completions")).toBe(expected);
});

test("preserves Azure and non-chat resource paths", () => {
  for (const resource of [
    "v1/models",
    "v1/audio/speech",
    "deployments/test/chat/completions?api-version=test",
  ]) {
    expect(openAIResourcePath("https://openrouter.ai/api/v1", resource)).toBe(
      resource,
    );
  }
});
