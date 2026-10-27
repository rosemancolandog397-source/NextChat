/** @jest-environment node */
import { readFileSync } from "node:fs";
import { MODEL_DEADLINE_MS } from "../app/api/model-deadline";

test("Netlify uses a server build and aborts before the platform hard limit", () => {
  const config = readFileSync("netlify.toml", "utf8");
  expect(config).toContain('command = "corepack yarn build"');
  expect(config).toContain('publish = ".next"');
  expect(config).toContain('--frozen-lockfile');
  expect(config).not.toMatch(/OPENAI_API_KEY\s*=/);
  expect(config).not.toMatch(/AI_BUDGET_REDIS_REST_TOKEN\s*=/);
  expect(MODEL_DEADLINE_MS + 5000).toBeLessThan(60000);
});

test("BYOK template does not request owner keys or Redis secrets", () => {
  const example = readFileSync(".env.example", "utf8");
  expect(example).toMatch(/^BYOK_MODE=1$/m);
  expect(example).not.toMatch(/^OPENAI_API_KEY=/m);
  expect(example).not.toMatch(/^AI_BUDGET_REDIS_REST_TOKEN=/m);
});
