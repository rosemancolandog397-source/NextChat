// Netlify allows 60s per function, including streams. Leave room for the
// quota store (5s) and response handling. No retries: each attempt can cost money.
export const MODEL_DEADLINE_MS = 50_000;
export class ModelDeadlineError extends Error {
  constructor() {
    super("模型响应超时，请缩短请求后重试；已有内容已保留。");
    this.name = "ModelDeadlineError";
  }
}

export async function fetchModelResponse(
  url: string,
  options: RequestInit,
  buffered: boolean,
  timeoutMs = MODEL_DEADLINE_MS,
): Promise<Response> {
  const upstream = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let stop!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { stop = reject; });
  // The deadline can expire between reads; retain a rejection handler.
  void stopped.catch(() => {});
  const cancel = () => {
    upstream.abort();
    stop(new Error("模型请求已取消。"));
    void reader?.cancel().catch(() => {});
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    stop(new ModelDeadlineError());
    upstream.abort();
    void reader?.cancel().catch(() => {});
  }, timeoutMs);
  timer.unref?.();
  function cleanup() {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
  try {
    if (options.signal?.aborted) cancel();
    const response = await Promise.race([
      fetch(url, { ...options, signal: upstream.signal }), stopped,
    ]);
    if (!response.body) { cleanup(); return response; }
    reader = response.body.getReader();
    if (buffered) {
      const chunks: Uint8Array[] = [];
      while (true) {
        const part = await Promise.race([reader.read(), stopped]);
        if (part.done) break;
        chunks.push(part.value);
      }
      cleanup();
      const length = chunks.reduce((size, chunk) => size + chunk.length, 0);
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return new Response(bytes, { status: response.status, headers: response.headers });
    }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await Promise.race([reader!.read(), stopped]);
          if (part.done) { cleanup(); controller.close(); }
          else controller.enqueue(part.value);
        } catch (error) { cleanup(); controller.error(error); }
      },
      cancel() { cleanup(); cancel(); },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  } catch (error) { cleanup(); throw error; }
}
