import React from "react";
import { jest } from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ChatOptions } from "../app/client/api";
import {
  PRD_SECTIONS,
  WORKBENCH_STORAGE_KEY,
  emptyWorkbenchDraft,
} from "../app/utils/product-workbench";

const callbacks: ChatOptions[] = [];
const inheritedModel = {
  model: "configured/deepseek-test",
  providerName: "OpenAI",
  temperature: 0.5,
};
const store = {
  modelConfig: inheritedModel,
  _hasHydrated: true,
  currentSessionIndex: 0,
  sessions: [{ mask: { modelConfig: inheritedModel } }],
};
jest.unstable_mockModule("@/app/store", () => ({
  useAppConfig: (selector: (state: typeof store) => unknown) => selector(store),
  useChatStore: (selector: (state: typeof store) => unknown) => selector(store),
  useAccessStore: (selector: (state: typeof store) => unknown) =>
    selector(store),
}));
jest.unstable_mockModule("@/app/client/product-workbench", () => ({
  getWorkbenchClientApi: () => ({
    llm: {
      async chat(options: ChatOptions) {
        callbacks.push(options);
        options.onController?.(new AbortController());
      },
    },
  }),
}));
const { ProductWorkbench } = await import(
  "../app/components/product-workbench"
);

function renderWorkbench() {
  return render(
    <MemoryRouter>
      <ProductWorkbench />
    </MemoryRouter>,
  );
}
function finish(message: string, status = 200) {
  return act(async () => {
    callbacks
      .at(-1)!
      .onFinish(message, { ok: status < 300, status } as Response);
  });
}
function generatedPrd() {
  return JSON.stringify({
    sections: PRD_SECTIONS.map((section) => ({
      id: section.id,
      items: [
        { text: `建议内容-${section.id}`, status: "proposal", sourceIds: [] },
      ],
    })),
  });
}

beforeEach(() => {
  localStorage.clear();
  callbacks.length = 0;
  jest.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

test("unreadable saved data is not overwritten by an empty or edited draft", () => {
  localStorage.setItem(WORKBENCH_STORAGE_KEY, "invalid saved JSON");
  renderWorkbench();
  expect(screen.getByText(/已暂停自动保存/)).toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "产品想法" }), {
    target: { value: "暂存的新想法" },
  });
  expect(localStorage.getItem(WORKBENCH_STORAGE_KEY)).toBe(
    "invalid saved JSON",
  );
});

test("backup storage failure does not prevent restoring a valid old draft", () => {
  const draft = emptyWorkbenchDraft();
  draft.idea = "必须保留的旧想法";
  localStorage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(draft));
  const original = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (key.endsWith("-phase1-backup")) throw new Error("quota exceeded");
    original.call(this, key, value);
  });
  renderWorkbench();
  expect(screen.getByRole("textbox", { name: "产品想法" })).toHaveValue(
    draft.idea,
  );
});

test("AI clarification, explicit confirmation, PRD edit/preview/export and reload work together", async () => {
  const view = renderWorkbench();
  fireEvent.change(screen.getByRole("textbox", { name: "产品想法" }), {
    target: { value: "需求整理工具" },
  });
  fireEvent.click(screen.getByRole("button", { name: /开始 AI 澄清/ }));
  expect(await screen.findByText(/AI 正在梳理需求/)).toBeInTheDocument();
  expect(callbacks[0].config.model).toBe(inheritedModel.model);
  expect(callbacks[0].config.stream).toBe(false);
  await finish(
    '{"topic":"users","question":"谁最需要整理需求？","hypotheses":["可能需要自动导入"]}',
  );
  expect(screen.getByText("谁最需要整理需求？")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: /^目标用户/ })).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "采纳并确认" }));
  expect(screen.getByText("用户明确采纳")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("澄清回答"), {
    target: { value: "独立产品经理" },
  });
  fireEvent.click(screen.getByRole("button", { name: /发送并确认/ }));
  expect(await screen.findByText(/AI 正在梳理需求/)).toBeInTheDocument();
  await finish(
    '{"topic":"scenario","question":"什么场景下需求最零散？","hypotheses":[]}',
  );
  expect(screen.getByRole("textbox", { name: /^目标用户/ })).toHaveValue(
    "独立产品经理",
  );
  expect(JSON.stringify(callbacks[1].messages)).toContain("独立产品经理");

  fireEvent.click(screen.getByRole("button", { name: "AI 生成 PRD" }));
  await waitFor(() => expect(callbacks).toHaveLength(3));
  await finish(generatedPrd());
  expect(
    screen.getByRole("button", { name: "重新生成 PRD" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "验收标准" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑内容" }));
  const editor = screen.getByLabelText("功能需求与范围第1项");
  fireEvent.change(editor, {
    target: { value: "首版支持手动输入与 Markdown 导出" },
  });
  fireEvent.click(
    within(editor.parentElement!).getByRole("button", {
      name: "我确认此项需求",
    }),
  );
  expect(
    within(editor.parentElement!).getByText("用户已确认"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "预览文档" }));
  expect(screen.getByLabelText("PRD 草稿内容")).toHaveTextContent(
    "首版支持手动输入与 Markdown 导出",
  );
  const before = localStorage.getItem(WORKBENCH_STORAGE_KEY)!;
  expect(JSON.parse(before).prd.sections).toHaveLength(7);

  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: jest.fn(() => "blob:test-workbench"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: jest.fn(),
  });
  const click = jest
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  fireEvent.click(screen.getByRole("button", { name: /导出 Markdown/ }));
  expect(click).toHaveBeenCalled();
  expect(screen.getByText(/已导出带信息状态/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "重新生成 PRD" }));
  await waitFor(() => expect(callbacks).toHaveLength(4));
  await finish("provider failure", 500);
  expect(screen.getByRole("alert")).toHaveTextContent("HTTP 500");
  expect(screen.getByLabelText("PRD 草稿内容")).toHaveTextContent(
    "首版支持手动输入与 Markdown 导出",
  );
  expect(JSON.parse(localStorage.getItem(WORKBENCH_STORAGE_KEY)!).prd).toEqual(
    JSON.parse(before).prd,
  );

  view.unmount();
  renderWorkbench();
  expect(
    await screen.findByText("生成模型：configured/deepseek-test · 含手动修改"),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("PRD 草稿内容")).toHaveTextContent(
    "首版支持手动输入与 Markdown 导出",
  );
});

test("cancel clears busy state, ignores late results and preserves the old draft", async () => {
  const draft = emptyWorkbenchDraft();
  draft.idea = "取消请求的测试想法";
  localStorage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(draft));
  renderWorkbench();
  fireEvent.click(await screen.findByRole("button", { name: /开始 AI 澄清/ }));
  expect(await screen.findByText(/AI 正在梳理需求/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "取消请求" }));
  await waitFor(() =>
    expect(screen.queryByText(/AI 正在梳理需求/)).not.toBeInTheDocument(),
  );
  await finish('{"topic":"users","question":"迟到的结果不应出现"}');
  expect(screen.queryByText("迟到的结果不应出现")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "产品想法" })).toHaveValue(
    draft.idea,
  );
  expect(screen.getByRole("button", { name: /开始 AI 澄清/ })).toBeEnabled();
});
