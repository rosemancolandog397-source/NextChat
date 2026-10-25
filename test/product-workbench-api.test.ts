/** @jest-environment node */
import { jest } from "@jest/globals";
import type { ChatOptions } from "../app/client/api";
import {
  requestWorkbenchModel,
  safeRequestError,
  WorkbenchAiError,
} from "../app/utils/product-workbench-ai";

const config = {
  model: "configured/deepseek-test",
  providerName: "OpenAI",
  temperature: 0.4,
};
const messages = [{ role: "user" as const, content: "测试需求" }];
const response = (status: number) =>
  ({ ok: status >= 200 && status < 300, status }) as Response;

describe("workbench uses the existing model API contract", () => {
  test("forwards the configured model/provider with tools-disabled non-streaming", async () => {
    let captured: ChatOptions | undefined;
    const api = {
      async chat(options: ChatOptions) {
        captured = options;
        options.onFinish("result", response(200));
      },
    };
    await expect(
      requestWorkbenchModel(
        api,
        config,
        messages,
        new AbortController().signal,
      ),
    ).resolves.toBe("result");
    expect(captured!.config).toEqual({ ...config, stream: false });
    expect(captured!.messages).toBe(messages);
    expect(Object.keys(captured!.config)).not.toContain("apiKey");
  });

  test.each([401, 403, 402, 429, 500])(
    "handles HTTP %s even when the legacy adapter calls onFinish",
    async (status) => {
      const api = {
        async chat(options: ChatOptions) {
          options.onFinish("raw-secret-placeholder", response(status));
        },
      };
      await expect(
        requestWorkbenchModel(
          api,
          config,
          messages,
          new AbortController().signal,
        ),
      ).rejects.toThrow(`HTTP ${status}`);
    },
  );

  test("rejects empty responses and catches rejected adapter promises", async () => {
    const empty = {
      async chat(options: ChatOptions) {
        options.onFinish("", response(200));
      },
    };
    await expect(
      requestWorkbenchModel(
        empty,
        config,
        messages,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/空内容/);
    const broken = {
      async chat() {
        throw new Error("raw-secret-placeholder");
      },
    };
    try {
      await requestWorkbenchModel(
        broken,
        config,
        messages,
        new AbortController().signal,
      );
    } catch (error) {
      expect(safeRequestError(error)).not.toContain("raw-secret-placeholder");
    }
  });

  test("cancel works before and after the underlying controller is ready", async () => {
    let callback: ChatOptions | undefined;
    const api = {
      async chat(options: ChatOptions) {
        callback = options;
      },
    };
    const outer = new AbortController();
    const request = requestWorkbenchModel(api, config, messages, outer.signal);
    const rejected = expect(request).rejects.toThrow(/取消/);
    outer.abort();
    await rejected;
    const late = new AbortController();
    callback!.onController!(late);
    expect(late.signal.aborted).toBe(true);
    callback!.onFinish("late response", response(200));
  });

  test("does not call a provider when already cancelled", async () => {
    let called = false;
    const api = {
      async chat() {
        called = true;
      },
    };
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestWorkbenchModel(api, config, messages, controller.signal),
    ).rejects.toThrow(/取消/);
    expect(called).toBe(false);
  });

  test("times out a silent adapter and aborts the request", async () => {
    jest.useFakeTimers();
    try {
      const inner = new AbortController();
      const api = {
        async chat(options: ChatOptions) {
          options.onController!(inner);
        },
      };
      const request = requestWorkbenchModel(
        api,
        config,
        messages,
        new AbortController().signal,
        10,
      );
      const rejected = expect(request).rejects.toThrow(/超时/);
      jest.advanceTimersByTime(11);
      await rejected;
      expect(inner.signal.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  test("sanitizes arbitrary provider errors but keeps our actionable errors", () => {
    expect(safeRequestError(new Error("raw-secret-placeholder"))).not.toContain(
      "raw-secret-placeholder",
    );
    expect(safeRequestError(new WorkbenchAiError("请检查模型权限"))).toBe(
      "请检查模型权限",
    );
  });
});
