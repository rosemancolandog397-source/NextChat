/** @jest-environment node */
import { jest } from "@jest/globals";
import { fetchModelResponse, ModelDeadlineError } from "../app/api/model-deadline";

beforeEach(() => { jest.useFakeTimers(); jest.mocked(fetch).mockReset(); });
afterEach(() => { jest.useRealTimers(); });

function hangingBody() { return new ReadableStream<Uint8Array>({ start() {} }); }

test("a model that never sends headers is aborted without automatic retries", async () => {
  let signal: AbortSignal | undefined;
  jest.mocked(fetch).mockImplementation((_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise(() => {});
  });
  const pending = fetchModelResponse("https://fixture.invalid", {}, true, 100);
  const assertion = expect(pending).rejects.toBeInstanceOf(ModelDeadlineError);
  await jest.advanceTimersByTimeAsync(101);
  await assertion;
  expect(signal?.aborted).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("the deadline also covers a non-streaming body after headers arrive", async () => {
  jest.mocked(fetch).mockResolvedValue(new Response(hangingBody()));
  const pending = fetchModelResponse("https://fixture.invalid", {}, true, 100);
  const assertion = expect(pending).rejects.toBeInstanceOf(ModelDeadlineError);
  await jest.advanceTimersByTimeAsync(101);
  await assertion;
});

test("streaming retains the deadline until completion, not just headers", async () => {
  jest.mocked(fetch).mockResolvedValue(new Response(hangingBody()));
  const response = await fetchModelResponse("https://fixture.invalid", {}, false, 100);
  const assertion = expect(response.text()).rejects.toBeInstanceOf(ModelDeadlineError);
  await jest.advanceTimersByTimeAsync(101);
  await assertion;
});

test.each([true, false])("successful buffered=%s response preserves text and clears timer", async (buffered) => {
  jest.mocked(fetch).mockResolvedValue(new Response("中文 fixture", { headers: { "Content-Type": "text/plain" } }));
  const response = await fetchModelResponse("https://fixture.invalid", {}, buffered, 100);
  expect(await response.text()).toBe("中文 fixture");
  expect(jest.getTimerCount()).toBe(0);
});

test("browser cancellation aborts the upstream and releases the timer", async () => {
  let signal: AbortSignal | undefined;
  jest.mocked(fetch).mockImplementation(async (_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Response(hangingBody());
  });
  const response = await fetchModelResponse("https://fixture.invalid", {}, false, 100);
  await response.body!.cancel();
  expect(signal?.aborted).toBe(true);
  expect(jest.getTimerCount()).toBe(0);
});
