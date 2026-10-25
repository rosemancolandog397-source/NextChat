export const WORKBENCH_STORAGE_KEY = "nextchat-product-workbench-v1";

export const REQUIREMENT_FIELDS = [
  {
    key: "users",
    label: "目标用户",
    placeholder: "谁会使用？他们有什么共同特点？",
    question: "这个产品首先服务谁？请描述一类具体的目标用户。",
  },
  {
    key: "scenario",
    label: "使用场景",
    placeholder: "在什么时间、地点或任务中使用？",
    question: "这些用户会在什么具体场景下使用产品？",
  },
  {
    key: "problem",
    label: "核心痛点",
    placeholder: "现在如何解决？哪里最不方便？",
    question: "在这个场景里，用户目前最难解决的问题是什么？",
  },
  {
    key: "goal",
    label: "成功标准",
    placeholder: "希望改善什么？如何判断有效？",
    question: "你希望用户获得什么结果？怎样判断产品有效？",
  },
  {
    key: "scope",
    label: "首版范围",
    placeholder: "第一版最需要完成的 1–3 项功能",
    question: "第一版只保留哪些必要功能？请列出 1–3 项。",
  },
  {
    key: "constraints",
    label: "限制与边界",
    placeholder: "时间、预算、隐私要求或暂不做的事",
    question: "有哪些时间、预算或使用限制？第一版明确不做什么？",
  },
] as const;

export type RequirementKey = (typeof REQUIREMENT_FIELDS)[number]["key"];
export type Requirements = Record<RequirementKey, string>;
export const CLARIFICATION_TOPICS = [
  "users",
  "scenario",
  "problem",
  "goal",
  "scope",
  "constraints",
  "workflow",
  "acceptance",
  "priority",
  "risk",
] as const;
export type ClarificationTopic = (typeof CLARIFICATION_TOPICS)[number];
export const PRD_SECTIONS = [
  { id: "background", title: "背景与目标" },
  { id: "users", title: "目标用户与使用场景" },
  { id: "pain", title: "痛点与需求依据" },
  { id: "requirements", title: "功能需求与范围" },
  { id: "workflow", title: "核心流程与异常分支" },
  { id: "acceptance", title: "验收标准" },
  { id: "risks", title: "风险、假设与待确认项" },
] as const;
export type PrdSectionId = (typeof PRD_SECTIONS)[number]["id"];
export type PrdItem = {
  text: string;
  status: "confirmed" | "proposal" | "unknown";
  origin: "source" | "ai" | "user";
  sourceIds: string[];
};
export type PrdSection = { id: PrdSectionId; items: PrdItem[] };
export type ConfirmedSource = { id: string; label: string; text: string };
export type PrdDocument = {
  sections: PrdSection[];
  sources: ConfirmedSource[];
  sourceSignature: string;
  model: string;
  generatedAt: string;
};
export type Hypothesis = {
  id: string;
  text: string;
  status: "pending" | "confirmed" | "dismissed";
};
export type ClarificationMessage = {
  id?: string;
  role: "guide" | "user";
  content: string;
  topic?: ClarificationTopic;
};
export type WorkbenchDraft = {
  idea: string;
  requirements: Requirements;
  messages: ClarificationMessage[];
  activeField: RequirementKey | null;
  started: boolean;
  preview: boolean;
  version: 2;
  pendingQuestion: { topic: ClarificationTopic; question: string } | null;
  askedTopics: ClarificationTopic[];
  hypotheses: Hypothesis[];
  prd: PrdDocument | null;
  prdEdited: boolean;
};

export function emptyWorkbenchDraft(): WorkbenchDraft {
  return {
    idea: "",
    requirements: {
      users: "",
      scenario: "",
      problem: "",
      goal: "",
      scope: "",
      constraints: "",
    },
    messages: [],
    activeField: null,
    started: false,
    preview: false,
    version: 2,
    pendingQuestion: null,
    askedTopics: [],
    hypotheses: [],
    prd: null,
    prdEdited: false,
  };
}

export function nextRequirement(requirements: Requirements) {
  return REQUIREMENT_FIELDS.find((field) => !requirements[field.key].trim());
}

// Validate only this workbench's own saved data, never the chat/access stores.
export function restoreWorkbenchDraft(value: unknown): WorkbenchDraft {
  const draft = emptyWorkbenchDraft();
  if (!value || typeof value !== "object") return draft;
  const saved = value as Partial<WorkbenchDraft>;
  if (typeof saved.idea === "string") draft.idea = saved.idea;
  for (const field of REQUIREMENT_FIELDS) {
    const text = saved.requirements?.[field.key];
    if (typeof text === "string") draft.requirements[field.key] = text;
  }
  if (Array.isArray(saved.messages)) {
    draft.messages = saved.messages
      .filter(
        (message): message is ClarificationMessage =>
          !!message &&
          (message.role === "guide" || message.role === "user") &&
          typeof message.content === "string",
      )
      .slice(-100)
      .map((message, index) => ({
        ...message,
        id: typeof message.id === "string" ? message.id : `legacy-${index}`,
        topic: CLARIFICATION_TOPICS.includes(message.topic!)
          ? message.topic
          : undefined,
      }));
  }
  draft.started = saved.started === true;
  draft.preview = saved.preview === true;
  draft.activeField = REQUIREMENT_FIELDS.some(
    (field) => field.key === saved.activeField,
  )
    ? saved.activeField!
    : null;
  draft.askedTopics = Array.isArray(saved.askedTopics)
    ? [
        ...new Set(
          saved.askedTopics.filter((topic) =>
            CLARIFICATION_TOPICS.includes(topic),
          ),
        ),
      ]
    : [];
  const question = saved.pendingQuestion;
  if (
    question &&
    CLARIFICATION_TOPICS.includes(question.topic) &&
    typeof question.question === "string"
  ) {
    draft.pendingQuestion = question;
  } else if (saved.version !== 2 && draft.activeField) {
    const lastGuide = [...draft.messages]
      .reverse()
      .find((message) => message.role === "guide");
    if (lastGuide)
      draft.pendingQuestion = {
        topic: draft.activeField,
        question: lastGuide.content,
      };
  }
  if (
    draft.pendingQuestion &&
    !draft.askedTopics.includes(draft.pendingQuestion.topic)
  )
    draft.askedTopics.push(draft.pendingQuestion.topic);
  if (Array.isArray(saved.hypotheses)) {
    draft.hypotheses = saved.hypotheses.filter(
      (item): item is Hypothesis =>
        !!item &&
        typeof item.id === "string" &&
        typeof item.text === "string" &&
        ["pending", "confirmed", "dismissed"].includes(item.status),
    );
  }
  if (saved.prd && Array.isArray(saved.prd.sections)) {
    const sections: PrdSection[] = [];
    for (const section of PRD_SECTIONS) {
      const entry = saved.prd.sections.find((item) => item?.id === section.id);
      if (!entry || !Array.isArray(entry.items)) break;
      const items = entry.items.filter(
        (item): item is PrdItem =>
          !!item &&
          typeof item.text === "string" &&
          ["confirmed", "proposal", "unknown"].includes(item.status) &&
          ["source", "ai", "user"].includes(item.origin) &&
          Array.isArray(item.sourceIds) &&
          item.sourceIds.every((id) => typeof id === "string"),
      );
      if (!items.length) break;
      sections.push({ id: section.id, items });
    }
    if (sections.length === PRD_SECTIONS.length) {
      draft.prd = {
        sections,
        sources: Array.isArray(saved.prd.sources)
          ? saved.prd.sources.filter(
              (item) =>
                !!item &&
                typeof item.id === "string" &&
                typeof item.label === "string" &&
                typeof item.text === "string",
            )
          : [],
        sourceSignature:
          typeof saved.prd.sourceSignature === "string"
            ? saved.prd.sourceSignature
            : "",
        model: typeof saved.prd.model === "string" ? saved.prd.model : "",
        generatedAt:
          typeof saved.prd.generatedAt === "string"
            ? saved.prd.generatedAt
            : "",
      };
    }
  }
  draft.prdEdited = saved.prdEdited === true;
  return draft;
}

export function confirmedSources(draft: WorkbenchDraft): ConfirmedSource[] {
  const sources: ConfirmedSource[] = [];
  if (draft.idea.trim())
    sources.push({
      id: "idea",
      label: "用户产品想法",
      text: draft.idea.trim(),
    });
  REQUIREMENT_FIELDS.forEach((field) => {
    if (draft.requirements[field.key].trim())
      sources.push({
        id: `requirement:${field.key}`,
        label: field.label,
        text: draft.requirements[field.key].trim(),
      });
  });
  draft.messages.forEach((message, index) => {
    if (message.role === "user" && message.content.trim())
      sources.push({
        id: `answer:${message.id ?? index}`,
        label: "用户确认的回答",
        text: message.content.trim(),
      });
  });
  draft.hypotheses.forEach((item) => {
    if (item.status === "confirmed")
      sources.push({
        id: `hypothesis:${item.id}`,
        label: "用户采纳的 AI 建议",
        text: item.text,
      });
  });
  return sources;
}

export function sourceSignature(draft: WorkbenchDraft) {
  return JSON.stringify(confirmedSources(draft));
}

export function availableTopics(draft: WorkbenchDraft) {
  return CLARIFICATION_TOPICS.filter(
    (topic) =>
      !draft.askedTopics.includes(topic) &&
      !(
        topic in draft.requirements &&
        draft.requirements[topic as RequirementKey].trim()
      ),
  );
}

export function prdItemLabel(item: PrdItem) {
  if (item.status === "unknown") return "信息缺失 · 待确认";
  if (item.status === "proposal") return "AI/编辑建议 · 待确认";
  return item.origin === "user" ? "用户已确认" : "用户原始信息";
}

export function setHypothesisStatus(
  draft: WorkbenchDraft,
  id: string,
  status: Hypothesis["status"],
): WorkbenchDraft {
  return {
    ...draft,
    hypotheses: draft.hypotheses.map((item) =>
      item.id === id ? { ...item, status } : item,
    ),
    prd:
      !draft.prd || status === "confirmed"
        ? draft.prd
        : {
            ...draft.prd,
            sections: draft.prd.sections.map((section) => ({
              ...section,
              items: section.items.map((item, index) =>
                id === `prd-${section.id}-${index}` ||
                item.sourceIds.includes(`hypothesis:${id}`)
                  ? {
                      ...item,
                      status: "proposal",
                      sourceIds: item.sourceIds.filter(
                        (source) => source !== `hypothesis:${id}`,
                      ),
                    }
                  : item,
              ),
            })),
          },
  };
}

export function createPrdMarkdown(draft: WorkbenchDraft): string {
  if (draft.prd) {
    const stale = draft.prd.sourceSignature !== sourceSignature(draft);
    const sections = PRD_SECTIONS.map((section) => {
      const items = draft.prd!.sections.find(
        (item) => item.id === section.id,
      )!.items;
      return `## ${section.title}\n\n${items
        .map(
          (item) =>
            `- **[${prdItemLabel(item)}]** ${item.text.replace(/\n/g, "\n  ")}${
              item.sourceIds.length
                ? `\n  来源：${item.sourceIds.join("、")}`
                : ""
            }`,
        )
        .join("\n\n")}`;
    }).join("\n\n");
    return `# 产品需求文档 · 草稿\n\n> AI 辅助整理，需人工评审。「用户确认」表示用户的需求陈述，不等于已验证的客观事实。\n${
      stale ? "> 需求信息已变化：本草稿尚未重新生成，请核对差异。\n" : ""
    }\n${sections}\n\n## 需求来源快照\n\n${draft.prd.sources
      .map(
        (source) =>
          `- **${source.id} · ${source.label}**：${source.text.replace(
            /\n/g,
            "\n  ",
          )}`,
      )
      .join("\n")}\n`;
  }
  const text = (key: RequirementKey) =>
    draft.requirements[key].trim() || "待确认";
  return `# 产品需求文档 · 草稿\n\n> 基于手动输入的模板草稿，尚未调用 AI；需人工评审。\n\n## 1. 产品想法\n${
    draft.idea.trim() || "待确认"
  }\n\n## 2. 目标用户与场景\n### 目标用户\n${text(
    "users",
  )}\n\n### 使用场景\n${text("scenario")}\n\n## 3. 核心问题\n${text(
    "problem",
  )}\n\n## 4. 产品目标与成功标准\n${text("goal")}\n\n## 5. 首版功能范围\n${text(
    "scope",
  )}\n\n## 6. 限制与边界\n${text(
    "constraints",
  )}\n\n## 7. 用户流程与验收标准\n待补充：核心操作流程、异常情况和可验证的验收条件。\n\n## 8. 假设与待确认项\n${
    REQUIREMENT_FIELDS.filter((field) => !draft.requirements[field.key].trim())
      .map((field) => `- ${field.label}：待确认`)
      .join("\n") || "- 以上信息已录入，仍需与目标用户核实。"
  }\n- 核心需求是否有用户访谈或行为数据支持？\n- 首版功能对应的验收条件是什么？\n`;
}
