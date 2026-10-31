"use client";

import { useState } from "react";
import { IconSpark } from "./icons";

type Step = { tool: string; label: string; args: Record<string, unknown>; observation: string; at: string };

type Msg =
  | { role: "user"; text: string }
  | { role: "bot"; text: string; steps?: Step[]; engine?: string; draft?: string; error?: boolean };

const DEFAULT_SUGGESTIONS = [
  "本周期哪些指标没达标？缺口在哪些患者？",
  "为什么 DVT 预防率环比下降？",
  "帮我起草一段报告说明",
];

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export function AgentPanel({
  patientId,
  patientName,
  period,
  suggestions,
  compact,
}: {
  patientId?: string;
  patientName?: string;
  period?: string;
  suggestions?: string[];
  compact?: boolean;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [openSteps, setOpenSteps] = useState<Record<number, boolean>>({});

  const list =
    suggestions ??
    (patientId
      ? [`${patientName ?? "该患者"}的 AKI 是几期？依据是什么？`, "这个患者有哪些数据缺口需要补？", "他的氧合情况符合 ARDS 吗？"]
      : DEFAULT_SUGGESTIONS);

  async function ask(question: string) {
    if (!question.trim() || loading) return;
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, patientId, period }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessages((prev) => [...prev, { role: "bot", text: data.error ?? "Agent 调用失败", error: true }]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "bot", text: data.answer, steps: data.steps, engine: data.engine, draft: data.draft },
        ]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "bot", text: "网络异常，请稍后重试", error: true }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="card agent">
      <header className="card-head">
        <div>
          <h2 className="card-title" style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <IconSpark className="" />
            临床 Agent
          </h2>
          <div className="card-sub">工具调用 · 证据回填 · 写操作需人工确认</div>
        </div>
        <div className="spacer" />
        <span className={`pill ${messages.some((m) => m.role === "bot" && m.engine === "llm") ? "brand" : "neutral"}`}>
          {messages.some((m) => m.role === "bot" && m.engine === "llm") ? "模型驱动" : "规则规划器"}
        </span>
      </header>

      <div className="agent-body" style={compact ? { maxHeight: 360 } : undefined}>
        {messages.length === 0 ? (
          <div className="msg bot">
            <div className="q">我是质控分析助手</div>
            我会先查患者档案，再跑 KDIGO / 柏林规则，最后把判据贴给你看。任何写入（例如报告说明）都要你点确认。
          </div>
        ) : null}

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div className="msg user" key={i}>
              {m.text}
            </div>
          ) : (
            <div className="msg bot" key={i}>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text.split("\n").map((line, j) => <div key={j}>{renderInline(line)}</div>)}</div>

              {m.steps?.length ? (
                <div style={{ marginTop: 8 }}>
                  <button
                    className="btn btn-sm"
                    type="button"
                    onClick={() => setOpenSteps((s) => ({ ...s, [i]: !s[i] }))}
                  >
                    {openSteps[i] ? "收起" : "查看"} Agent 轨迹（{m.steps.length} 次工具调用）
                  </button>
                  {openSteps[i] ? (
                    <div style={{ marginTop: 8 }}>
                      {m.steps.map((s, j) => (
                        <div className="step" key={j}>
                          <div className="row between">
                            <span className="step-tool">{s.tool}</span>
                            <span className="faint" style={{ fontSize: 10 }}>
                              {s.label}
                            </span>
                          </div>
                          <div className="step-args">{JSON.stringify(s.args)}</div>
                          <div className="step-obs">{s.observation}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {m.draft ? (
                <div style={{ marginTop: 8 }}>
                  <pre className="code" style={{ whiteSpace: "pre-wrap", background: "#f8fafc", color: "#334155", border: "1px solid var(--line)" }}>
                    {m.draft}
                  </pre>
                </div>
              ) : null}
            </div>
          ),
        )}

        {loading ? (
          <div className="msg bot">
            <span className="muted">正在调用工具…</span>
          </div>
        ) : null}
      </div>

      <div className="suggest">
        {list.map((s) => (
          <button key={s} type="button" onClick={() => ask(s)} disabled={loading}>
            {s}
          </button>
        ))}
      </div>

      <form
        className="agent-input"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <input
          className="input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="问一个具体问题，例如：这个患者的 AKI 依据是什么？"
          disabled={loading}
        />
        <button className="btn btn-primary" type="submit" disabled={loading || !input.trim()}>
          发送
        </button>
      </form>
    </section>
  );
}
