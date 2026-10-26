// Remove known credentials even if an upstream accidentally echoes them.
// Keep streaming: retaining a short suffix handles matches across byte chunks.
export function credentialSafeResponse(response: Response, secrets: string[]) {
  const needles = [...new Set(secrets.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const headers = new Headers(response.headers);
  for (const [name, value] of [...headers.entries()]) {
    if (
      [
        "authorization",
        "api-key",
        "x-api-key",
        "x-goog-api-key",
        "set-cookie",
      ].includes(name.toLowerCase()) ||
      needles.some((secret) => value.includes(secret))
    )
      headers.delete(name);
  }
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("www-authenticate");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Accel-Buffering", "no");
  if (!response.ok) {
    // Error objects can embed URLs, request headers or SDK configuration.
    void response.body?.cancel().catch(() => {});
    return new Response(
      JSON.stringify({
        error: {
          code: "MODEL_SERVICE_ERROR",
          message: "模型服务请求失败，请联系管理员检查配置或额度。",
        },
      }),
      {
        status: response.status,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  }
  if (!response.body || !needles.length) {
    return new Response(response.body, { status: response.status, headers });
  }
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const keep = Math.max(...needles.map((secret) => secret.length)) - 1;
  let pending = "";
  function redact(text: string) {
    for (const secret of needles) text = text.split(secret).join("[REDACTED]");
    return text;
  }
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending = redact(pending + decoder.decode(chunk, { stream: true }));
        let emit = Math.max(0, pending.length - keep);
        // Never split a UTF-16 surrogate pair when encoding the emitted prefix.
        if (
          emit > 0 &&
          /[\uD800-\uDBFF]/.test(pending[emit - 1]) &&
          /[\uDC00-\uDFFF]/.test(pending[emit] || "")
        )
          emit--;
        if (emit) {
          controller.enqueue(encoder.encode(pending.slice(0, emit)));
          pending = pending.slice(emit);
        }
      },
      flush(controller) {
        controller.enqueue(encoder.encode(redact(pending + decoder.decode())));
      },
    }),
  );
  return new Response(body, { status: response.status, headers });
}
