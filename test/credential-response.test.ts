/** @jest-environment node */
import { credentialSafeResponse } from "../app/api/credential-response";
const key = "fixture-secret-credential";
function stream(text: string, step: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += step)
        controller.enqueue(bytes.slice(i, i + step));
      controller.close();
    },
  });
}

test.each([1, 2, 7, 64])(
  "redacts echoed credentials across chunks of %s bytes without breaking Unicode/SSE",
  async (step) => {
    const input = `data: {"text":"中文🙂 ${key} 结束🙂"}\n\ndata: [DONE]\n\n`;
    const result = credentialSafeResponse(
      new Response(stream(input, step), {
        headers: {
          "Content-Type": "text/event-stream",
          "x-fixture-echo": key,
          "Content-Length": "999",
          Authorization: key,
          "Set-Cookie": `secret=${key}`,
        },
      }),
      [key],
    );
    expect(await result.text()).toBe(input.replace(key, "[REDACTED]"));
    for (const name of [
      "x-fixture-echo",
      "authorization",
      "set-cookie",
      "content-length",
    ])
      expect(result.headers.has(name)).toBe(false);
    expect(result.headers.get("Content-Type")).toBe("text/event-stream");
  },
);

test("normal JSON model output is preserved", async () => {
  const text = JSON.stringify({
    choices: [{ message: { content: "正常 PRD 文档🙂" } }],
  });
  expect(await credentialSafeResponse(new Response(text), [key]).text()).toBe(
    text,
  );
});

test("provider errors never expose raw headers, credentials, or error objects", async () => {
  const response = credentialSafeResponse(
    new Response(
      JSON.stringify({
        error: { message: key, request: { headers: { Authorization: key } } },
      }),
      { status: 401, headers: { "x-echo": key } },
    ),
    [key],
  );
  expect(response.status).toBe(401);
  expect(await response.text()).not.toContain(key);
  expect(response.headers.get("x-echo")).toBeNull();
});
