/** @jest-environment node */
import {
  emptyWorkbenchDraft,
  restoreWorkbenchDraft,
  confirmedSources,
  availableTopics,
  PRD_SECTIONS,
  createPrdMarkdown,
  sourceSignature,
  setHypothesisStatus,
} from "../app/utils/product-workbench";
import {
  clarificationPrompt,
  parseClarification,
  parsePrd,
  prdPrompt,
} from "../app/utils/product-workbench-ai";

function prdJson(text: string, status = "confirmed", sourceIds = ["idea"]) {
  return JSON.stringify({
    sections: PRD_SECTIONS.map((section) => ({
      id: section.id,
      items: [{ text, status, sourceIds }],
    })),
  });
}

describe("workbench draft migration and provenance", () => {
  test("preserves all confirmed suggestions across a full PRD review", () => {
    const draft = emptyWorkbenchDraft();
    draft.hypotheses = Array.from({ length: 84 }, (_, i) => ({
      id: `accepted-${i}`,
      text: `确认内容${i}`,
      status: "confirmed" as const,
    }));
    expect(
      restoreWorkbenchDraft(JSON.parse(JSON.stringify(draft))).hypotheses,
    ).toHaveLength(84);
  });
  test("preserves phase-one content, preview and a pending question", () => {
    const old = {
      idea: "旧想法",
      requirements: { users: "独立产品经理" },
      activeField: "scenario",
      started: true,
      preview: true,
      messages: [{ role: "guide", content: "具体场景是什么？" }],
    };
    const migrated = restoreWorkbenchDraft(old);
    expect(migrated.idea).toBe(old.idea);
    expect(migrated.requirements.users).toBe("独立产品经理");
    expect(migrated.pendingQuestion?.topic).toBe("scenario");
    expect(migrated.askedTopics).toContain("scenario");
    expect(migrated.preview).toBe(true);
    expect(migrated.version).toBe(2);
  });

  test("handles invalid data without corrupting valid fields", () => {
    const draft = restoreWorkbenchDraft({
      idea: "保留",
      requirements: { goal: 42 },
      messages: [null, { role: "system", content: "ignore" }],
      prd: { sections: [null] },
    });
    expect(draft.idea).toBe("保留");
    expect(draft.requirements.goal).toBe("");
    expect(draft.messages).toEqual([]);
    expect(draft.prd).toBeNull();
  });

  test("never treats AI messages or unconfirmed guesses as sources", () => {
    const draft = emptyWorkbenchDraft();
    draft.messages = [
      { role: "guide", content: "AI 猜测有百万用户" },
      { id: "answer-1", role: "user", content: "我的用户只有五人" },
    ];
    draft.hypotheses = [{ id: "h1", text: "支持语音", status: "pending" }];
    expect(confirmedSources(draft).map((item) => item.text)).toEqual([
      "我的用户只有五人",
    ]);
    const accepted = setHypothesisStatus(draft, "h1", "confirmed");
    expect(confirmedSources(accepted).map((item) => item.text)).toContain(
      "支持语音",
    );
    expect(
      confirmedSources(setHypothesisStatus(accepted, "h1", "pending")),
    ).toHaveLength(1);
  });
});

describe("targeted clarification", () => {
  test("excludes known and already asked topics from the prompt", () => {
    const draft = emptyWorkbenchDraft();
    draft.requirements.users = "产品经理";
    draft.askedTopics = ["goal"];
    expect(availableTopics(draft)).not.toContain("users");
    expect(availableTopics(draft)).not.toContain("goal");
    const payload = clarificationPrompt(draft)[1].content as string;
    expect(payload).toContain('"confirmedSources"');
    expect(payload).toContain('"alreadyAskedTopics":["goal"]');
  });

  test("rejects repeated topics and identical questions under another topic", () => {
    const draft = emptyWorkbenchDraft();
    draft.askedTopics = ["users"];
    expect(() =>
      parseClarification('{"topic":"users","question":"用户是谁"}', draft),
    ).toThrow(/重复/);
    draft.messages = [{ role: "guide", content: "什么时候使用？" }];
    expect(() =>
      parseClarification(
        '{"topic":"scenario","question":"什么时候使用?"}',
        draft,
      ),
    ).toThrow(/重复/);
  });

  test("accepts fenced JSON with reasoning wrappers and keeps guesses separate", () => {
    const parsed = parseClarification(
      '<think>reasoning</think>```json\n{"topic":"problem","question":"整理反馈最耗时的步骤是什么？","hypotheses":["可能需要批量导入"]}\n```',
      emptyWorkbenchDraft(),
    );
    expect(parsed.question?.topic).toBe("problem");
    expect(parsed.hypotheses).toEqual(["可能需要批量导入"]);
  });

  test("supports completion and rejects malformed responses", () => {
    expect(
      parseClarification('{"done":true}', emptyWorkbenchDraft()).question,
    ).toBeNull();
    expect(() => parseClarification("not JSON", emptyWorkbenchDraft())).toThrow(
      /结构化/,
    );
  });
});

describe("structured PRD trust and export", () => {
  test("classifies provider JSON errors without exposing raw contents", () => {
    expect(() =>
      parsePrd(
        '{"error":{"message":"raw-secret-placeholder"}}',
        emptyWorkbenchDraft(),
        "model",
      ),
    ).toThrow(/模型服务返回错误/);
    try {
      parsePrd(
        '{"error":{"message":"raw-secret-placeholder"}}',
        emptyWorkbenchDraft(),
        "model",
      );
    } catch (error) {
      expect((error as Error).message).not.toContain("raw-secret-placeholder");
    }
  });
  test("accepts a full source quotation and persists all seven sections", () => {
    const draft = emptyWorkbenchDraft();
    draft.idea = "只整理文字反馈";
    draft.prd = parsePrd(prdJson(draft.idea), draft, "configured-model");
    expect(draft.prd.sections).toHaveLength(7);
    expect(draft.prd.sections[0].items[0].origin).toBe("source");
    const restored = restoreWorkbenchDraft(JSON.parse(JSON.stringify(draft)));
    expect(restored.prd).toEqual(draft.prd);
    expect(createPrdMarkdown(restored)).toContain("用户原始信息");
    for (const section of PRD_SECTIONS)
      expect(createPrdMarkdown(restored)).toContain(section.title);
  });

  test("downgrades fabricated facts and prevents negation stripping", () => {
    const draft = emptyWorkbenchDraft();
    draft.idea = "不支持录音，只记录文字反馈。";
    const invented = parsePrd(prdJson("有十万用户"), draft, "model");
    expect(invented.sections[0].items[0].status).toBe("proposal");
    const stripped = parsePrd(prdJson("支持录音"), draft, "model");
    expect(stripped.sections[0].items[0].status).toBe("proposal");
    const fakeCitation = parsePrd(
      prdJson(draft.idea, "confirmed", ["fabricated-id"]),
      draft,
      "model",
    );
    expect(fakeCitation.sections[0].items[0].status).toBe("proposal");
    expect(fakeCitation.sections[0].items[0].sourceIds).toEqual([]);
  });

  test("rejects missing sections and malformed/empty items", () => {
    expect(() =>
      parsePrd('{"sections":[]}', emptyWorkbenchDraft(), "model"),
    ).toThrow(/章节/);
    expect(() => parsePrd(prdJson(""), emptyWorkbenchDraft(), "model")).toThrow(
      /空条目/,
    );
    expect(() =>
      parsePrd(prdJson("text", "fake-status"), emptyWorkbenchDraft(), "model"),
    ).toThrow(/状态/);
  });

  test("marks stale documents without silently rewriting existing content", () => {
    const draft = emptyWorkbenchDraft();
    draft.idea = "原想法";
    draft.prd = parsePrd(prdJson(draft.idea), draft, "model");
    const oldDocument = JSON.stringify(draft.prd);
    draft.idea = "已修改想法";
    expect(sourceSignature(draft)).not.toBe(draft.prd.sourceSignature);
    expect(createPrdMarkdown(draft)).toContain("需求信息已变化");
    expect(JSON.stringify(draft.prd)).toBe(oldDocument);
  });

  test("withdrawing confirmation demotes affected PRD items and future prompts", () => {
    let draft = emptyWorkbenchDraft();
    draft.idea = "测试";
    draft.hypotheses = [{ id: "h1", text: "先做导出", status: "confirmed" }];
    draft.prd = parsePrd(
      prdJson("先做导出", "confirmed", ["hypothesis:h1"]),
      draft,
      "model",
    );
    draft = setHypothesisStatus(draft, "h1", "pending");
    expect(draft.prd!.sections[0].items[0].status).toBe("proposal");
    expect(
      confirmedSources(draft).some((item) => item.id === "hypothesis:h1"),
    ).toBe(false);
    expect(prdPrompt(draft)[1].content).toContain("unconfirmedHypotheses");
  });

  test("keeps the phase-one template available until an AI PRD exists", () => {
    const draft = emptyWorkbenchDraft();
    draft.idea = "旧草稿";
    expect(createPrdMarkdown(draft)).toContain("旧草稿");
    expect(createPrdMarkdown(draft)).toContain("尚未调用 AI");
  });
});
