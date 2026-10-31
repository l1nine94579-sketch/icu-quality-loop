/**
 * 临床 Agent：工具调用 + 证据回填 + 人工确认。
 *
 * 设计取舍：
 *  1) 工具是唯一的数据入口，模型不能直接查库，避免"编造数值"；
 *  2) 每次调用都记录参数与观测结果，前端把轨迹摊开展示，医生可以逐条核对；
 *  3) 写操作（保存报告说明、提交报告）永远需要人点击确认，Agent 只产出草稿；
 *  4) 没有配置模型 Key 时走确定性规划器，输出同一套轨迹结构——演示不依赖外网，也不会瞎编。
 */
import { all } from "./db";
import { buildItems, indicatorDrilldown, previousPeriod } from "./reports";
import { currentPeriod, getObservations, getPatient } from "./repo";
import { parseEvidence, type Evidence } from "./features";
import { AKI_STAGE_LABEL, SEVERITY_LABEL } from "./engine";
import { fmtDateTime, pct } from "./format";

export type ToolStep = {
  tool: string;
  label: string;
  args: Record<string, unknown>;
  observation: string;
  at: string;
};

export type AgentResult = {
  answer: string;
  steps: ToolStep[];
  engine: "rules" | "llm";
  model: string | null;
  draft?: string;
};

export type AgentContext = { patientId?: string; period?: string; question: string };

type ToolDef = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, { type: string; description: string; required?: boolean }>;
  run: (args: Record<string, unknown>) => { observation: string; data: unknown };
};

// ---------------------------------------------------------------- tools
function patientSummary(patientId: string) {
  const p = getPatient(patientId);
  if (!p) return null;
  const evidence = parseEvidence<Evidence>(p.evidence);
  return { p, evidence };
}

const TOOLS: ToolDef[] = [
  {
    name: "get_patient",
    label: "读取患者档案",
    description: "返回患者基本信息、入科诊断、AKI/ARDS 结论与关键护理事件",
    parameters: { patientId: { type: "string", description: "患者 ID", required: true } },
    run: (args) => {
      const found = patientSummary(String(args.patientId));
      if (!found) return { observation: "未找到该患者", data: null };
      const { p } = found;
      return {
        observation: `${p.bed} ${p.name}，${p.gender} ${p.age} 岁，诊断：${p.dx}；AKI ${AKI_STAGE_LABEL[p.aki_stage ?? 0]}，ARDS ${SEVERITY_LABEL[(p.ards_severity ?? "insufficient") as keyof typeof SEVERITY_LABEL]}`,
        data: {
          id: p.id,
          name: p.name,
          bed: p.bed,
          dx: p.dx,
          akiStage: p.aki_stage,
          ards: p.ards_severity,
          pf: p.pf_ratio,
          pao2: p.pf_ratio ? null : undefined,
          vent: p.vent_started,
          dvt: p.dvt_prophylaxis,
          culture: p.culture_before_abx,
          assessed24h: p.assessed_24h,
          apache: p.apache_ii,
          admittedAt: p.admitted_at,
        },
      };
    },
  },
  {
    name: "calc_aki",
    label: "重跑 KDIGO 分期",
    description: "按 KDIGO 2012 重新计算肌酐与尿量两条路径的分期，返回命中与未命中的判据",
    parameters: { patientId: { type: "string", description: "患者 ID", required: true } },
    run: (args) => {
      const found = patientSummary(String(args.patientId));
      if (!found?.evidence) return { observation: "缺少派生证据，无法复算", data: null };
      const { evidence } = found;
      const hits = evidence.aki.criteria.filter((c) => c.hit);
      return {
        observation: `分期 ${evidence.aki.stage} 期；命中 ${hits.length} 条判据：${
          hits.map((h) => `${h.label}（${h.observed}）`).join("；") || "无"
        }`,
        data: {
          stage: evidence.aki.stage,
          baselineCr: evidence.baselineCr,
          peakCr: evidence.peakCr,
          peakRatio: evidence.peakRatio,
          onsetAt: evidence.aki.onsetAt,
          hits: hits.map((h) => ({ label: h.label, observed: h.observed, source: h.source })),
        },
      };
    },
  },
  {
    name: "calc_ards",
    label: "重跑柏林分度",
    description: "按柏林定义用最近一次血气计算 P/F 与分度，缺数据时明确返回不足",
    parameters: { patientId: { type: "string", description: "患者 ID", required: true } },
    run: (args) => {
      const found = patientSummary(String(args.patientId));
      if (!found?.evidence) return { observation: "缺少血气记录", data: null };
      const { evidence } = found;
      return {
        observation: `P/F ${evidence.ards.pf ?? "—"} mmHg，分度：${
          SEVERITY_LABEL[(evidence.ards.severity ?? "insufficient") as keyof typeof SEVERITY_LABEL]
        }${evidence.abg?.peep != null ? `（PEEP ${evidence.abg.peep}）` : ""}`,
        data: { pf: evidence.ards.pf, severity: evidence.ards.severity, abg: evidence.abg },
      };
    },
  },
  {
    name: "list_observations",
    label: "查询原始检验",
    description: "按项目返回患者原始检验序列（肌酐 / 尿量 / 血气 / GCS）",
    parameters: {
      patientId: { type: "string", description: "患者 ID", required: true },
      code: { type: "string", description: "creatinine | urine_ml | pao2 | gcs" },
    },
    run: (args) => {
      const code = args.code ? String(args.code) : undefined;
      const rows = getObservations(String(args.patientId), code);
      const series = rows.slice(0, 24).map((r) => `${fmtDateTime(r.measured_at)} ${r.value}${r.unit}`);
      return {
        observation: rows.length ? `${rows.length} 条，最近：${series.slice(-3).join("；")}` : "无记录",
        data: { count: rows.length, series },
      };
    },
  },
  {
    name: "indicator_board",
    label: "读取指标看板",
    description: "返回指定周期的全部质控指标：分子、分母、达标值、环比",
    parameters: { period: { type: "string", description: "YYYY-MM" } },
    run: (args) => {
      const period = String(args.period ?? currentPeriod());
      const items = buildItems(period);
      return {
        observation: items
          .map((i) => `${i.def.name} ${pct(i.rate)}（${i.numerator}/${i.denominator}${i.metTarget ? "" : "，未达标"}）`)
          .join("；"),
        data: items.map((i) => ({
          code: i.def.code,
          name: i.def.name,
          rate: i.rate,
          numerator: i.numerator,
          denominator: i.denominator,
          target: i.def.target,
          delta: i.delta,
          met: i.metTarget,
        })),
      };
    },
  },
  {
    name: "list_gaps",
    label: "定位证据缺口",
    description: "找出指标未命中的患者及原因，可按指标编码过滤",
    parameters: {
      period: { type: "string", description: "YYYY-MM" },
      code: { type: "string", description: "指标编码，例如 DVT_PRO" },
    },
    run: (args) => {
      const period = String(args.period ?? currentPeriod());
      const code = args.code ? String(args.code) : null;
      const items = buildItems(period).filter((i) => (code ? i.def.code === code : !i.metTarget || i.rate == null));
      const details = items.map((i) => {
        const drill = indicatorDrilldown(i.def.code, period);
        const names = (drill?.misses ?? []).slice(0, 6).map((m) => m.name ?? m.id);
        return `${i.def.name}：${pct(i.rate)}，未命中 ${i.missing} 例${names.length ? `（${names.join("、")}）` : ""}`;
      });
      return {
        observation: details.join("；") || "无缺口",
        data: items.map((i) => ({
          code: i.def.code,
          name: i.def.name,
          rate: i.rate,
          misses: indicatorDrilldown(i.def.code, period)?.misses.map((m) => m.id) ?? [],
        })),
      };
    },
  },
  {
    name: "explain_indicator",
    label: "解释单项指标波动",
    description: "对比上一个周期，给出某项指标的环比变化、未命中患者与缺口原因",
    parameters: {
      code: { type: "string", description: "指标编码，例如 DVT_PRO", required: true },
      period: { type: "string", description: "YYYY-MM" },
    },
    run: (args) => {
      const period = String(args.period ?? currentPeriod());
      const code = String(args.code);
      const prev = previousPeriod(period);
      const cur = buildItems(period).find((i) => i.def.code === code);
      const before = prev ? buildItems(prev).find((i) => i.def.code === code) : undefined;
      if (!cur) return { observation: "未找到该指标", data: null };
      const drill = indicatorDrilldown(code, period);
      const misses = drill?.misses ?? [];
      const reasons = misses.slice(0, 6).map((m) => {
        const specific =
          code === "DVT_PRO" ? "DVT 预防事件晚于 24h 或缺失"
          : code === "CULTURE" ? "病原学送检晚于首剂抗菌药"
          : code === "EARLY_ASSESS" ? "早期评估晚于 24h"
          : code === "ARDS_PF" ? "缺少可配对的 PaO₂ / FiO₂"
          : "未命中原定条件";
        return `${m.name}（${m.bed}）— ${specific}`;
      });
      const delta = cur.rate != null && before?.rate != null ? cur.rate - before.rate : null;
      return {
        observation: `${cur.def.name}：${prev ?? "上一周期"} ${pct(before?.rate)} → ${period} ${pct(cur.rate)}${
          delta != null ? `（${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)}pp）` : ""
        }；未命中 ${cur.missing} 例：${reasons.join("；") || "无"}`,
        data: {
          code,
          name: cur.def.name,
          current: cur.rate,
          previous: before?.rate ?? null,
          delta,
          denominator: cur.denominator,
          misses: misses.map((m) => ({ id: m.id, name: m.name, bed: m.bed })),
          reasons,
        },
      };
    },
  },
  {
    name: "audit_trail",
    label: "读取审计轨迹",
    description: "返回报告的状态变更与数据修改记录，用于解释口径变化",
    parameters: { limit: { type: "number", description: "返回条数，默认 8" } },
    run: (args) => {
      const limit = Number(args.limit ?? 8);
      const rows = all<{ at: string; actor_name: string; action: string; entity_id: string; note: string | null }>(
        "SELECT at, actor_name, action, entity_id, note FROM audit_logs ORDER BY id DESC LIMIT ?",
        limit,
      );
      return {
        observation: rows.map((r) => `${fmtDateTime(r.at)} ${r.actor_name} ${r.action}${r.entity_id ? `(${r.entity_id})` : ""}`).join("；"),
        data: rows,
      };
    },
  },
  {
    name: "draft_report_note",
    label: "生成报告说明草稿",
    description: "根据指标缺口与审计记录起草一段报告说明，仅返回文本，不写库",
    parameters: { period: { type: "string", description: "YYYY-MM" } },
    run: (args) => {
      const period = String(args.period ?? currentPeriod());
      const items = buildItems(period);
      const below = items.filter((i) => i.rate != null && !i.metTarget);
      const worst = [...below].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0)).slice(0, 3);
      const lines: string[] = [];
      lines.push(`${period} 质控说明（AI 草稿，需人工确认）：`);
      if (worst.length === 0) {
        lines.push(`本周期 ${items.length} 项指标全部达到目标值，数据来源为 LIS 与护理事件，未发现结构性缺口。`);
      } else {
        lines.push(
          `本周期 ${below.length} 项指标未达目标值，其中 ${worst
            .map((w) => `${w.def.name}（${pct(w.rate)}，目标 ${pct(w.def.target, 0)}）`)
            .join("、")} 偏差最大。`,
        );
        const gapCode = worst[0].def.code;
        const drill = indicatorDrilldown(gapCode, period);
        const missCount = drill?.result.missing ?? 0;
        lines.push(
          `以 ${worst[0].def.name} 为例，分母 ${worst[0].denominator} 例中有 ${missCount} 例未命中，已定位到具体患者，建议由责任护士在 24h 内补录对应事件。`,
        );
        const prev = previousPeriod(period);
        if (prev) {
          const prevItems = buildItems(prev);
          const moved = items.filter((i) => Math.abs(i.delta ?? 0) >= 0.15);
          if (moved.length) {
            lines.push(
              `环比波动超过 15 个百分点的指标：${moved
                .map((m) => `${m.def.name}（${pct(prevItems.find((x) => x.def.code === m.def.code)?.rate)} → ${pct(m.rate)}）`)
                .join("、")}，需在提交前补充口径变化说明。`,
            );
          }
        }
      }
      return { observation: `已生成 ${lines.length} 段草稿，等待人工确认后落库`, data: { draft: lines.join("\n") } };
    },
  },
];

// ---------------------------------------------------------------- planner
function pickTool(name: string) {
  return TOOLS.find((t) => t.name === name)!;
}

const INDICATOR_HINTS: { code: string; test: RegExp }[] = [
  { code: "DVT_PRO", test: /dvt|血栓|深静脉/i },
  { code: "CULTURE", test: /送检|病原|培养|抗菌/i },
  { code: "AKI_48H", test: /48\s*(小时|h)|检测及时/i },
  { code: "AKI_RATE", test: /aki|肾/i },
  { code: "ARDS_PF", test: /ards|氧合|分层|呼吸/i },
  { code: "EARLY_ASSESS", test: /评估/i },
  { code: "APACHE_HIGH", test: /apache|收治/i },
];

function mentionedIndicator(q: string): string | null {
  return INDICATOR_HINTS.find((h) => h.test.test(q))?.code ?? null;
}

function plan(ctx: AgentContext): { tool: string; args: Record<string, unknown> }[] {
  const q = ctx.question.toLowerCase();
  const patientId = ctx.patientId;
  const period = ctx.period ?? currentPeriod();
  const calls: { tool: string; args: Record<string, unknown> }[] = [];

  const wantsPatient = /患者|这个|他|她|aki|肌酐|分几期|分期|ards|氧合|pf|呼吸/.test(q) && patientId;

  if (wantsPatient) {
    calls.push({ tool: "get_patient", args: { patientId } });
    if (/aki|肌酐|分期|肾/.test(q)) calls.push({ tool: "calc_aki", args: { patientId } });
    if (/ards|氧合|pf|呼吸|氧合指数/.test(q)) calls.push({ tool: "calc_ards", args: { patientId } });
    if (/缺|补|核对|证据|交代/.test(q)) calls.push({ tool: "list_gaps", args: { period } });
    if (calls.length === 1) calls.push({ tool: "calc_aki", args: { patientId } });
    return calls;
  }

  if (/说明|草稿|汇报|写一段|怎么写/.test(q)) {
    calls.push({ tool: "indicator_board", args: { period } });
    calls.push({ tool: "list_gaps", args: { period } });
    calls.push({ tool: "draft_report_note", args: { period } });
    return calls;
  }

  const focused = mentionedIndicator(q);
  if (/为什么|原因|下降|上升|波动|退回|异常|解释/.test(q)) {
    calls.push({ tool: "indicator_board", args: { period } });
    if (focused) calls.push({ tool: "explain_indicator", args: { code: focused, period } });
    else calls.push({ tool: "list_gaps", args: { period } });
    calls.push({ tool: "audit_trail", args: { limit: 6 } });
    return calls;
  }

  calls.push({ tool: "indicator_board", args: { period } });
  if (focused) calls.push({ tool: "explain_indicator", args: { code: focused, period } });
  else if (/缺|问题|核对/.test(q)) calls.push({ tool: "list_gaps", args: { period } });
  return calls;
}

function composeAnswer(ctx: AgentContext, results: { tool: string; data: unknown; observation: string }[]): string {
  const lines: string[] = [];
  const period = ctx.period ?? currentPeriod();

  for (const r of results) {
    if (r.tool === "get_patient") {
      const d = r.data as Record<string, unknown> | null;
      if (d) {
        lines.push(
          `**${d.bed} ${d.name}**：${d.dx}；AKI ${AKI_STAGE_LABEL[Number(d.akiStage) ?? 0]}，ARDS ${
            SEVERITY_LABEL[(String(d.ards) ?? "insufficient") as keyof typeof SEVERITY_LABEL]
          }${d.pf ? `（P/F ${d.pf}）` : ""}。`,
        );
      }
    }
    if (r.tool === "calc_aki") {
      const d = r.data as { stage?: number; baselineCr?: number; peakCr?: number; peakRatio?: number; hits?: { label: string; observed: string }[] } | null;
      if (d) {
        lines.push(
          `KDIGO 分期 **${d.stage} 期**：基线 ${d.baselineCr} mg/dL，峰值 ${d.peakCr} mg/dL（${d.peakRatio}×）。`,
        );
        if (d.hits?.length) {
          lines.push(`命中依据：${d.hits.map((h) => `${h.label} — ${h.observed}`).join("；")}。`);
        } else {
          lines.push("未命中任何分期判据，按 KDIGO 判定为无 AKI。");
        }
      }
    }
    if (r.tool === "calc_ards") {
      const d = r.data as { pf?: number; severity?: string } | null;
      if (d) {
        lines.push(
          `柏林分度：P/F ${d.pf ?? "—"} mmHg → **${
            SEVERITY_LABEL[(d.severity ?? "insufficient") as keyof typeof SEVERITY_LABEL]
          }**。`,
        );
      }
    }
    if (r.tool === "indicator_board") {
      const d = r.data as { name: string; rate: number | null; target: number; met: boolean; delta: number | null }[];
      const below = d.filter((i) => !i.met);
      lines.push(
        `**${period} 指标看板**：${d.length} 项里 ${below.length} 项未达目标值。${
          below.length
            ? `需要关注：${below.map((i) => `${i.name} ${pct(i.rate)}（目标 ${pct(i.target, 0)}）`).join("、")}。`
            : "全部达标。"
        }`,
      );
    }
    if (r.tool === "explain_indicator") {
      const d = r.data as
        | { name: string; current: number | null; previous: number | null; delta: number | null; denominator: number; reasons: string[] }
        | null;
      if (d) {
        const dir = d.delta == null ? "" : d.delta > 0 ? "上升" : "下降";
        lines.push(
          `**${d.name}**：${pct(d.previous)} → ${pct(d.current)}${
            d.delta == null ? "" : `（${dir} ${Math.abs(d.delta * 100).toFixed(1)} 个百分点）`
          }，分母 ${d.denominator} 例。`,
        );
        if (d.reasons.length) {
          lines.push(`未命中原因逐条核对：${d.reasons.join("；")}。`);
          lines.push("这些属于执行时间点问题，可在患者详情页补录事件后点「重算派生指标」再复算。");
        }
      }
    }
    if (r.tool === "list_gaps") {
      const d = r.data as { name: string; rate: number | null; misses: string[] }[];
      const withGaps = d.filter((i) => i.misses.length > 0);
      if (withGaps.length) {
        lines.push(
          `证据缺口集中在：${withGaps
            .slice(0, 4)
            .map((i) => `${i.name}（${i.misses.length} 例患者）`)
            .join("、")}。可在「指标口径库」下钻到具体患者与原始事件。`,
        );
      }
    }
    if (r.tool === "audit_trail") {
      const d = r.data as { at: string; actor_name: string; action: string }[];
      if (d.length) {
        lines.push(`近期审计：${d.slice(0, 3).map((a) => `${fmtDateTime(a.at)} ${a.actor_name} ${a.action}`).join("；")}。`);
      }
    }
  }

  if (ctx.patientId && results.some((r) => r.tool === "calc_aki")) {
    lines.push("以上结论均来自规则引擎的判据表，可逐条点开核对原始检验时间戳；若与临床判断不一致，请以床旁评估为准。");
  } else {
    lines.push("需要我把某一项指标拆到患者级，或直接起草报告说明吗？草稿需要你确认后才会写入报告。");
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- runner
export async function runAgent(ctx: AgentContext): Promise<AgentResult> {
  const engine = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY ? "llm" : "rules";

  if (engine === "llm") {
    try {
      return await runLlmAgent(ctx);
    } catch {
      // 模型不可用时静默降级，演示不中断
    }
  }
  return runRuleAgent(ctx);
}

export function runRuleAgent(ctx: AgentContext): AgentResult {
  const calls = plan(ctx);
  const steps: ToolStep[] = [];
  const results: { tool: string; data: unknown; observation: string }[] = [];

  for (const call of calls) {
    const tool = pickTool(call.tool);
    let out: { observation: string; data: unknown };
    try {
      out = tool.run(call.args);
    } catch (err) {
      out = { observation: `工具执行失败：${err instanceof Error ? err.message : "未知错误"}`, data: null };
    }
    steps.push({
      tool: tool.name,
      label: tool.label,
      args: call.args,
      observation: out.observation,
      at: new Date().toISOString(),
    });
    results.push({ tool: tool.name, ...out });
  }

  const draft = results.find((r) => r.tool === "draft_report_note")?.data as { draft?: string } | undefined;
  return {
    answer: composeAnswer(ctx, results),
    steps,
    engine: "rules",
    model: null,
    draft: draft?.draft,
  };
}

// ---------------------------------------------------------------- LLM path
async function runLlmAgent(ctx: AgentContext): Promise<AgentResult> {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY!;
  const baseUrl = process.env.LLM_BASE_URL || "https://api.deepseek.com/v1";
  const model = process.env.LLM_MODEL || "deepseek-chat";

  const tools = TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }]),
        ),
        required: Object.entries(t.parameters).filter(([, v]) => v.required).map(([k]) => k),
      },
    },
  }));

  const messages: Record<string, unknown>[] = [
    {
      role: "system",
      content:
        "你是重症医学科的质控分析助手。只能通过工具读取数据，禁止编造数值。回答使用简体中文，先给结论再给依据，必要时列出患者明细。涉及写操作时只给草稿，不自行落库。",
    },
    {
      role: "user",
      content: `${ctx.question}${ctx.patientId ? `（患者 ID：${ctx.patientId}）` : ""}${
        ctx.period ? `（周期：${ctx.period}）` : ""
      }`,
    },
  ];
  const steps: ToolStep[] = [];

  for (let round = 0; round < 4; round += 1) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto", temperature: 0.2 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const json = (await res.json()) as {
      choices: { message: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
    };
    const message = json.choices?.[0]?.message;
    if (!message) throw new Error("empty choice");
    messages.push({ role: "assistant", ...message });

    if (!message.tool_calls?.length) {
      return {
        answer: message.content ?? "（模型未返回内容）",
        steps,
        engine: "llm",
        model,
      };
    }

    for (const call of message.tool_calls) {
      const tool = TOOLS.find((t) => t.name === call.function.name);
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }
      let out = { observation: "未知工具", data: null as unknown };
      if (tool) {
        try {
          out = tool.run(args);
        } catch (err) {
          out = { observation: `工具失败：${err instanceof Error ? err.message : "未知"}`, data: null };
        }
        steps.push({
          tool: tool.name,
          label: tool.label,
          args,
          observation: out.observation,
          at: new Date().toISOString(),
        });
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(out.data ?? out.observation) });
    }
  }
  throw new Error("tool loop exceeded");
}

export function persistRun(ctx: AgentContext, actorId: string, result: AgentResult): number {
  const res = all<{ id: number }>(
    `INSERT INTO agent_runs (at, actor_id, question, answer, steps_json, engine, patient_id, period)
     VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
    new Date().toISOString(),
    actorId,
    ctx.question,
    result.answer,
    JSON.stringify(result.steps),
    result.engine,
    ctx.patientId ?? null,
    ctx.period ?? null,
  );
  return Number(res[0]?.id ?? 0);
}

export { TOOLS };
