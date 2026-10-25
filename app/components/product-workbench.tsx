"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { nanoid } from "nanoid";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Path } from "../constant";
import { getWorkbenchClientApi } from "../client/product-workbench";
import { useAppConfig, useChatStore, useAccessStore } from "../store";
import {
  type RequirementKey,
  type WorkbenchDraft,
  type PrdItem,
  type PrdSectionId,
  REQUIREMENT_FIELDS,
  PRD_SECTIONS,
  WORKBENCH_STORAGE_KEY,
  createPrdMarkdown,
  emptyWorkbenchDraft,
  restoreWorkbenchDraft,
  availableTopics,
  sourceSignature,
  prdItemLabel,
  setHypothesisStatus,
} from "../utils/product-workbench";
import {
  requestWorkbenchModel,
  clarificationPrompt,
  prdPrompt,
  parseClarification,
  parsePrd,
  safeRequestError,
} from "../utils/product-workbench-ai";
import styles from "./product-workbench.module.scss";

type AiTask = "clarify" | "prd";
const EXAMPLE: WorkbenchDraft = {
  ...emptyWorkbenchDraft(),
  idea: "为独立产品经理做一个需求澄清工具，把零散的产品想法整理成可以讨论的 PRD。",
  requirements: {
    users: "正在独立负责新产品的初级产品经理",
    scenario: "收到一个模糊需求，需要在评审前明确问题与首版范围",
    problem: "输入信息零散，直接生成文档容易遗漏前提、混淆假设与事实",
    goal: "减少需求遗漏，让评审者清楚看到待确认的问题",
    scope: "结构化输入、分步澄清、PRD 草稿预览与 Markdown 导出",
    constraints: "首版个人使用、本地保存，暂不做团队协作",
  },
};

export function ProductWorkbench() {
  const [draft, setDraft] = useState(emptyWorkbenchDraft);
  const [loaded, setLoaded] = useState(false);
  const [storageStatus, setStorageStatus] = useState("正在读取本地草稿…");
  const [answer, setAnswer] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<AiTask | null>(null);
  const [error, setError] = useState("");
  const [retryTask, setRetryTask] = useState<AiTask | null>(null);
  const [editing, setEditing] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const storageReadable = useRef(true);
  const globalConfig = useAppConfig((state) => state.modelConfig);
  const sessionConfig = useChatStore(
    (state) => state.sessions[state.currentSessionIndex]?.mask.modelConfig,
  );
  const appReady = useAppConfig((state) => state._hasHydrated);
  const chatReady = useChatStore((state) => state._hasHydrated);
  const accessReady = useAccessStore((state) => state._hasHydrated);
  // Preserve current chat/provider selection so existing endpoint/auth resolution
  // also works for OpenRouter models using the OpenAI-compatible adapter.
  const modelConfig = { ...globalConfig, ...sessionConfig };
  const modelReady = appReady && chatReady && accessReady;

  useEffect(() => {
    mounted.current = true;
    try {
      const saved = localStorage.getItem(WORKBENCH_STORAGE_KEY);
      if (saved) {
        setDraft(restoreWorkbenchDraft(JSON.parse(saved)));
        try {
          if (!localStorage.getItem(`${WORKBENCH_STORAGE_KEY}-phase1-backup`))
            localStorage.setItem(
              `${WORKBENCH_STORAGE_KEY}-phase1-backup`,
              saved,
            );
        } catch {
          setNotice("旧草稿已恢复，但浏览器空间不足，未能另外保留迁移备份。");
        }
      }
    } catch {
      storageReadable.current = false;
      setStorageStatus(
        "旧草稿无法读取，已暂停自动保存以避免覆盖；可继续编辑并导出",
      );
    }
    setLoaded(true);
    return () => {
      mounted.current = false;
      requestRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!loaded || !storageReadable.current) return;
    try {
      localStorage.setItem(WORKBENCH_STORAGE_KEY, JSON.stringify(draft));
      setStorageStatus("已自动保存到此浏览器");
    } catch {
      setStorageStatus("本地保存不可用，请导出草稿备份");
    }
  }, [draft, loaded]);

  useEffect(() => {
    const messages = messagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [draft.messages]);

  const completed = REQUIREMENT_FIELDS.filter((field) =>
    draft.requirements[field.key].trim(),
  ).length;
  const prd = createPrdMarkdown(draft);
  const stale =
    !!draft.prd && draft.prd.sourceSignature !== sourceSignature(draft);
  const canRequest = loaded && modelReady && !busy && !!draft.idea.trim();

  async function runAi(task: AiTask, snapshot: WorkbenchDraft) {
    if (requestRef.current || !mounted.current) return;
    if (!modelReady || !modelConfig.model || !modelConfig.providerName) {
      setError("模型配置尚未就绪，请在原聊天页选择可用模型后返回工作台。");
      return;
    }
    if (task === "clarify" && !availableTopics(snapshot).length) {
      setNotice("本轮澄清主题已覆盖，可继续手动补充或生成 PRD。");
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(task);
    setError("");
    setNotice("");
    setRetryTask(task);
    try {
      const raw = await requestWorkbenchModel(
        getWorkbenchClientApi(modelConfig.providerName).llm,
        modelConfig,
        task === "clarify"
          ? clarificationPrompt(snapshot)
          : prdPrompt(snapshot),
        controller.signal,
      );
      if (!mounted.current || controller.signal.aborted) return;
      if (task === "clarify") {
        const result = parseClarification(raw, snapshot);
        const question = result.question;
        setDraft((current) => ({
          ...current,
          started: true,
          pendingQuestion: question,
          activeField:
            question &&
            REQUIREMENT_FIELDS.some((field) => field.key === question.topic)
              ? (question.topic as RequirementKey)
              : null,
          askedTopics: question
            ? [...new Set([...current.askedTopics, question.topic])]
            : current.askedTopics,
          messages: [
            ...current.messages,
            {
              id: nanoid(),
              role: "guide" as const,
              topic: question?.topic,
              content:
                question?.question ??
                "AI 认为现有信息已足够形成初稿。你可以继续补充，或生成 PRD 并核对待确认项。",
            },
          ].slice(-100),
          hypotheses: [
            ...current.hypotheses,
            ...result.hypotheses
              .filter(
                (text) =>
                  !current.hypotheses.some((item) => item.text === text),
              )
              .map((text) => ({
                id: nanoid(),
                text,
                status: "pending" as const,
              })),
          ],
        }));
        setNotice("AI 问题已更新；推测单独列为待确认建议。");
      } else {
        const document = parsePrd(raw, snapshot, modelConfig.model);
        setDraft((current) => ({
          ...current,
          prd: document,
          prdEdited: false,
          preview: true,
        }));
        setEditing(false);
        setNotice("PRD 已生成，请核对 AI 建议、缺失信息和验收条件。");
      }
      setRetryTask(null);
    } catch (failure) {
      if (!mounted.current) return;
      if (controller.signal.aborted) {
        setNotice("请求已取消，原草稿已保留。");
        setRetryTask(null);
      } else setError(safeRequestError(failure));
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (mounted.current) setBusy(null);
    }
  }

  const updateField = (key: RequirementKey, value: string) =>
    setDraft((current) => ({
      ...current,
      requirements: { ...current.requirements, [key]: value },
      ...(current.pendingQuestion?.topic === key && value.trim()
        ? { pendingQuestion: null, activeField: null }
        : {}),
    }));

  function sendAnswer(event: FormEvent) {
    event.preventDefault();
    const content = answer.trim();
    if (!content || busy || !modelReady) return;
    const topic = draft.pendingQuestion?.topic;
    const field = REQUIREMENT_FIELDS.find((item) => item.key === topic);
    const snapshot: WorkbenchDraft = {
      ...draft,
      requirements:
        field && !draft.requirements[field.key].trim()
          ? { ...draft.requirements, [field.key]: content }
          : draft.requirements,
      messages: [
        ...draft.messages,
        { id: nanoid(), role: "user" as const, content, topic },
      ].slice(-100),
      activeField: null,
      pendingQuestion: null,
    };
    setDraft(snapshot);
    setAnswer("");
    setNotice("回答已作为你的需求陈述保存，正在请求下一个问题。");
    void runAi("clarify", snapshot);
  }

  function skipQuestion() {
    const snapshot = { ...draft, pendingQuestion: null, activeField: null };
    setDraft(snapshot);
    void runAi("clarify", snapshot);
  }

  function loadExample() {
    if (
      (!storageReadable.current ||
        draft.idea.trim() ||
        completed ||
        draft.messages.length) &&
      !window.confirm("载入示例将替换当前工作台草稿（包括 PRD），是否继续？")
    )
      return;
    storageReadable.current = true;
    setDraft({ ...EXAMPLE, requirements: { ...EXAMPLE.requirements } });
    setAnswer("");
    setError("");
    setRetryTask(null);
    setEditing(false);
    setNotice("示例已载入；这是演示需求，不代表真实调研结论。");
  }

  function generatePrd() {
    if (
      draft.prd &&
      !window.confirm(
        "重新生成将替换现有 PRD，包括手动编辑。确认继续？失败或取消时原文档仍会保留。",
      )
    )
      return;
    void runAi("prd", draft);
  }

  function updatePrdItem(
    sectionId: PrdSectionId,
    index: number,
    value: string,
  ) {
    setDraft((current) =>
      !current.prd
        ? current
        : {
            ...current,
            prdEdited: true,
            hypotheses: current.hypotheses.map((item) =>
              item.id === `prd-${sectionId}-${index}`
                ? { ...item, status: "dismissed" }
                : item,
            ),
            prd: {
              ...current.prd,
              sections: current.prd.sections.map((section) =>
                section.id !== sectionId
                  ? section
                  : {
                      ...section,
                      items: section.items.map((item, i) =>
                        i !== index
                          ? item
                          : {
                              ...item,
                              text: value,
                              status: "proposal",
                              origin: "user",
                              sourceIds: [],
                            },
                      ),
                    },
              ),
            },
          },
    );
  }

  function confirmPrdItem(sectionId: PrdSectionId, index: number) {
    setDraft((current) => {
      const item = current.prd?.sections.find(
        (section) => section.id === sectionId,
      )?.items[index];
      if (!current.prd || !item?.text.trim()) return current;
      const noteId = `prd-${sectionId}-${index}`;
      const next: WorkbenchDraft = {
        ...current,
        prdEdited: true,
        hypotheses: [
          ...current.hypotheses.filter((note) => note.id !== noteId),
          { id: noteId, text: item.text, status: "confirmed" },
        ],
        prd: {
          ...current.prd,
          sections: current.prd.sections.map((section) =>
            section.id !== sectionId
              ? section
              : {
                  ...section,
                  items: section.items.map((value, i) =>
                    i !== index
                      ? value
                      : { ...value, status: "confirmed", origin: "user" },
                  ),
                },
          ),
        },
      };
      if (current.prd.sourceSignature === sourceSignature(current)) {
        next.prd!.sourceSignature = sourceSignature(next);
        next.prd!.sources = [
          ...current.prd.sources.filter(
            (source) => source.id !== `hypothesis:${noteId}`,
          ),
          {
            id: `hypothesis:${noteId}`,
            label: "用户确认的 PRD 条目",
            text: item.text,
          },
        ];
      }
      return next;
    });
  }

  function exportDraft() {
    const url = URL.createObjectURL(
      new Blob([prd], { type: "text/markdown;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "产品需求文档-草稿.md";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("已导出带信息状态和来源快照的 Markdown 草稿。");
  }

  const itemBadge = (item: PrdItem) => (
    <span
      className={
        item.status === "confirmed"
          ? styles.confirmedBadge
          : styles.assumptionBadge
      }
    >
      {prdItemLabel(item)}
    </span>
  );

  return (
    <main
      className={styles.workbench}
      aria-label="AI 产品工作台"
      aria-busy={!!busy}
    >
      <header className={styles.header}>
        <Link to={Path.Home} className={styles.back}>
          ← 返回聊天
        </Link>
        <span className={styles.phase}>PHASE 02 · AI 需求协作</span>
      </header>
      <div className={styles.content}>
        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>PRODUCT WORKSPACE</p>
            <h1>AI 产品工作台</h1>
            <p className={styles.subtitle}>先把需求问清楚，再把产品写清楚。</p>
          </div>
          <button
            type="button"
            className={styles.secondary}
            onClick={loadExample}
            disabled={!loaded || !!busy}
          >
            载入示例
          </button>
        </div>
        <div className={styles.modelBar}>
          <span>
            沿用当前聊天模型：
            <strong>
              {modelReady
                ? `${modelConfig.model} · ${modelConfig.providerName}`
                : "读取配置中…"}
            </strong>
          </span>
          <Link to={Path.Home}>切换聊天模型</Link>
          <Link to={Path.Settings}>接口设置</Link>
        </div>
        <div className={styles.overview}>
          <div>
            <span className={styles.dot} />
            {storageStatus}
          </div>
          <div>
            需求已确认 <strong>{completed} / 6</strong>
            <progress value={completed} max={6} aria-label="需求信息完整度" />
          </div>
        </div>
        {busy && (
          <div className={styles.loadingState} role="status">
            <span className={styles.spinner} />
            {busy === "clarify"
              ? "AI 正在梳理需求并提出问题…"
              : "AI 正在生成结构化 PRD…"}
            <button
              type="button"
              className={styles.secondary}
              onClick={() => requestRef.current?.abort()}
            >
              取消请求
            </button>
          </div>
        )}
        {error && (
          <div className={styles.errorState} role="alert">
            <p>{error}</p>
            {retryTask && (
              <button
                type="button"
                className={styles.secondary}
                disabled={!!busy}
                onClick={() => void runAi(retryTask, draft)}
              >
                重试上次请求
              </button>
            )}
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setError("");
                setRetryTask(null);
              }}
            >
              关闭提示
            </button>
          </div>
        )}
        <nav className={styles.steps} aria-label="工作台步骤">
          {["产品想法", "需求信息", "澄清对话", "PRD 预览"].map((label, i) => (
            <a
              key={label}
              href={`#${Path.ProductWorkbench}`}
              onClick={(event) => {
                event.preventDefault();
                document
                  .getElementById(`workbench-section-${i}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              <span>0{i + 1}</span>
              {label}
            </a>
          ))}
        </nav>
        <div className={styles.grid}>
          <div className={styles.column}>
            <section
              className={styles.card}
              id="workbench-section-0"
              aria-labelledby="idea-title"
            >
              <div className={styles.sectionTitle}>
                <span>01</span>
                <div>
                  <h2 id="idea-title">产品想法</h2>
                  <p>告诉 AI 你想解决什么问题。</p>
                </div>
              </div>
              <label className={styles.srOnly} htmlFor="product-idea">
                产品想法
              </label>
              <textarea
                id="product-idea"
                rows={5}
                value={draft.idea}
                disabled={!loaded || !!busy}
                placeholder="例如：我想帮助产品经理把模糊需求整理成可评审的 PRD…"
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    idea: event.target.value,
                  }))
                }
              />
              <div className={styles.cardFooter}>
                <span>输入将发送至当前模型服务。</span>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!canRequest || !!draft.pendingQuestion}
                  onClick={() => void runAi("clarify", draft)}
                >
                  {draft.pendingQuestion
                    ? "请先回答当前问题"
                    : draft.started
                    ? "继续 AI 澄清"
                    : "开始 AI 澄清"}{" "}
                  →
                </button>
              </div>
            </section>
            <section
              className={styles.card}
              id="workbench-section-1"
              aria-labelledby="requirements-title"
            >
              <div className={styles.sectionTitle}>
                <span>02</span>
                <div>
                  <h2 id="requirements-title">需求信息</h2>
                  <p>此处仅保存你的输入或明确确认的信息。</p>
                </div>
                <b className={styles.count}>{completed}/6</b>
              </div>
              <div className={styles.fields}>
                {REQUIREMENT_FIELDS.map((field) => (
                  <label key={field.key} htmlFor={`requirement-${field.key}`}>
                    <span>
                      {field.label}
                      <small>
                        {draft.requirements[field.key].trim()
                          ? "用户已确认"
                          : "待补充"}
                      </small>
                    </span>
                    <textarea
                      id={`requirement-${field.key}`}
                      rows={2}
                      disabled={!loaded || !!busy}
                      placeholder={field.placeholder}
                      value={draft.requirements[field.key]}
                      onChange={(event) =>
                        updateField(field.key, event.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
              <p className={styles.helpText}>
                “用户已确认”表示你明确表达的产品需求，不等于已通过调研验证的事实。
              </p>
            </section>
          </div>
          <div className={styles.column}>
            <section
              className={styles.card}
              id="workbench-section-2"
              aria-labelledby="clarification-title"
            >
              <div className={styles.sectionTitle}>
                <span>03</span>
                <div>
                  <h2 id="clarification-title">澄清对话</h2>
                  <p>基于已知信息追问，每次聚焦一个新缺口。</p>
                </div>
              </div>
              <div className={styles.modeNote}>
                AI 问题与建议不自动成为已确认需求。
              </div>
              <div
                className={styles.messages}
                ref={messagesRef}
                role="log"
                aria-label="澄清记录"
                aria-live="polite"
              >
                {!draft.messages.length ? (
                  <div className={styles.empty}>
                    <div className={styles.emptyIcon}>?</div>
                    <h3>好问题，是好需求的开始</h3>
                    <p>
                      填写想法，AI 将根据已有信息提出问题。
                      <br />
                      原聊天的模型和接口配置会直接复用。
                    </p>
                  </div>
                ) : (
                  draft.messages.map((message, i) => (
                    <div
                      key={message.id ?? i}
                      className={
                        message.role === "user"
                          ? styles.userMessage
                          : styles.guideMessage
                      }
                    >
                      <span>
                        {message.role === "user"
                          ? "用户确认的回答"
                          : message.id?.startsWith("legacy-")
                          ? "第一阶段引导记录"
                          : "AI 澄清"}
                      </span>
                      <p>{message.content}</p>
                    </div>
                  ))
                )}
              </div>
              <form className={styles.composer} onSubmit={sendAnswer}>
                <label className={styles.srOnly} htmlFor="clarification-answer">
                  澄清回答
                </label>
                <textarea
                  id="clarification-answer"
                  rows={3}
                  value={answer}
                  disabled={!loaded || !!busy}
                  placeholder={
                    draft.pendingQuestion
                      ? "回答当前问题，发送后作为你的需求陈述保存…"
                      : "补充已确认的信息，或点击开始 AI 澄清…"
                  }
                  onChange={(event) => setAnswer(event.target.value)}
                />
                <div className={styles.composerActions}>
                  {draft.pendingQuestion && (
                    <button
                      type="button"
                      className={styles.secondary}
                      disabled={!!busy || !modelReady}
                      onClick={skipQuestion}
                    >
                      暂不回答，换个主题
                    </button>
                  )}
                  <button
                    type="submit"
                    className={styles.primary}
                    disabled={!canRequest || !answer.trim()}
                  >
                    发送并确认 ↑
                  </button>
                </div>
              </form>
              {draft.hypotheses.some((item) => item.status !== "dismissed") && (
                <div className={styles.hypotheses}>
                  <h3>建议与确认记录</h3>
                  {draft.hypotheses
                    .filter((item) => item.status !== "dismissed")
                    .map((item) => (
                      <div key={item.id}>
                        <span
                          className={
                            item.status === "confirmed"
                              ? styles.confirmedBadge
                              : styles.assumptionBadge
                          }
                        >
                          {item.status === "confirmed"
                            ? "用户明确采纳"
                            : "AI 推测 · 待确认"}
                        </span>
                        <p>{item.text}</p>
                        {item.status === "pending" ? (
                          <div className={styles.inlineActions}>
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() =>
                                setDraft((current) =>
                                  setHypothesisStatus(
                                    current,
                                    item.id,
                                    "confirmed",
                                  ),
                                )
                              }
                            >
                              采纳并确认
                            </button>
                            <button
                              type="button"
                              disabled={!!busy}
                              onClick={() =>
                                setDraft((current) =>
                                  setHypothesisStatus(
                                    current,
                                    item.id,
                                    "dismissed",
                                  ),
                                )
                              }
                            >
                              不采纳
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={styles.textButton}
                            disabled={!!busy}
                            onClick={() =>
                              setDraft((current) =>
                                setHypothesisStatus(
                                  current,
                                  item.id,
                                  "pending",
                                ),
                              )
                            }
                          >
                            撤回确认
                          </button>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </section>
            <section
              className={styles.card}
              id="workbench-section-3"
              aria-labelledby="prd-title"
            >
              <div className={styles.sectionTitle}>
                <span>04</span>
                <div>
                  <h2 id="prd-title">PRD 预览</h2>
                  <p>有来源的信息与 AI 建议分别标记，可逐项编辑。</p>
                </div>
                <span className={styles.draftBadge}>草稿</span>
              </div>
              {stale && (
                <p className={styles.staleWarning} role="status">
                  需求已变化，当前 PRD 尚未同步。请重新生成或人工核对。
                </p>
              )}
              {draft.prd ? (
                <>
                  <div className={styles.previewNote}>
                    生成模型：{draft.prd.model} ·{" "}
                    {draft.prdEdited ? "含手动修改" : "AI 初稿"}
                  </div>
                  <div className={styles.documentModes}>
                    <button
                      type="button"
                      className={!editing ? styles.primary : styles.secondary}
                      aria-pressed={!editing}
                      onClick={() => setEditing(false)}
                    >
                      预览文档
                    </button>
                    <button
                      type="button"
                      className={editing ? styles.primary : styles.secondary}
                      aria-pressed={editing}
                      onClick={() => setEditing(true)}
                    >
                      编辑内容
                    </button>
                  </div>
                  {editing ? (
                    <div className={styles.prdEditor}>
                      {draft.prd.sections.map((section) => (
                        <section key={section.id}>
                          <h3>
                            {
                              PRD_SECTIONS.find(
                                (value) => value.id === section.id,
                              )!.title
                            }
                          </h3>
                          {section.items.map((item, i) => (
                            <div key={i} className={styles.editItem}>
                              {itemBadge(item)}
                              <textarea
                                aria-label={`${
                                  PRD_SECTIONS.find(
                                    (value) => value.id === section.id,
                                  )!.title
                                }第${i + 1}项`}
                                value={item.text}
                                rows={3}
                                disabled={!!busy}
                                onChange={(event) =>
                                  updatePrdItem(
                                    section.id,
                                    i,
                                    event.target.value,
                                  )
                                }
                              />
                              {item.status !== "confirmed" && (
                                <button
                                  type="button"
                                  className={styles.textButton}
                                  disabled={
                                    !!busy ||
                                    !item.text.trim() ||
                                    item.text.trim() === "待确认"
                                  }
                                  onClick={() => confirmPrdItem(section.id, i)}
                                >
                                  我确认此项需求
                                </button>
                              )}
                              {item.sourceIds.length > 0 && (
                                <small>来源：{item.sourceIds.join("、")}</small>
                              )}
                            </div>
                          ))}
                        </section>
                      ))}
                    </div>
                  ) : (
                    <div
                      className={styles.renderedDocument}
                      aria-label="PRD 草稿内容"
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          img: () => null,
                          a: ({ children }) => <span>{children}</span>,
                        }}
                      >
                        {prd}
                      </ReactMarkdown>
                    </div>
                  )}
                </>
              ) : draft.preview ? (
                <pre className={styles.document} aria-label="第一阶段模板草稿">
                  {prd}
                </pre>
              ) : (
                <div className={styles.previewEmpty}>
                  <span>从已确认需求，生成可评审的 PRD</span>
                  <p>
                    覆盖背景、用户、痛点、功能、流程、验收与风险。
                    <br />
                    未确认的建议会保留明确标记。
                  </p>
                </div>
              )}
              <div className={styles.previewActions}>
                <button
                  type="button"
                  className={styles.primary}
                  disabled={!canRequest}
                  onClick={generatePrd}
                >
                  {draft.prd ? "重新生成 PRD" : "AI 生成 PRD"}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={!!busy || !(draft.prd || draft.preview)}
                  onClick={exportDraft}
                >
                  导出 Markdown ↗
                </button>
                {!draft.prd && (
                  <button
                    type="button"
                    className={styles.textButton}
                    disabled={!loaded || !draft.idea.trim()}
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        preview: !current.preview,
                      }))
                    }
                  >
                    {draft.preview ? "收起模板" : "查看第一阶段模板"}
                  </button>
                )}
              </div>
            </section>
          </div>
        </div>
        <footer className={styles.footer}>
          <span>用户陈述 → AI 澄清 → 明确确认 → PRD 草稿</span>
          <span>草稿仅在此浏览器保存；AI 请求发送至当前模型服务。</span>
        </footer>
        <div className={styles.notice} role="status">
          {notice}
        </div>
      </div>
    </main>
  );
}
