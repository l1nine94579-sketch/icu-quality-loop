import Link from "next/link";
import { notFound } from "next/navigation";
import {
  buildItems,
  getReport,
  indicatorDrilldown,
  listPeriods,
  previousPeriod,
  readSnapshot,
  snapshotDiff,
  STATUS_LABEL,
  STATUS_TONE,
  validateSubmission,
} from "@/lib/reports";
import { listAudit, ACTION_LABEL } from "@/lib/audit";
import { currentUser, ROLE_LABEL } from "@/lib/session";
import { can, CAP_LABEL } from "@/lib/permissions";
import { userName } from "@/lib/repo";
import { fmtDateTime, periodLabel, pct } from "@/lib/format";
import { Card, Delta, Flash, Meter, NoAccess, Pill, StatusPill } from "@/components/ui";
import { AgentPanel } from "@/components/AgentPanel";
import { PrintButton } from "@/components/PrintButton";
import { runRuleAgent } from "@/lib/agent";
import {
  adoptAgentDraft,
  approveAction,
  recomputeAction,
  reportOutAction,
  returnAction,
  submitReportAction,
} from "@/app/actions";

export const dynamic = "force-dynamic";

function parseEvidence(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ period: string }>;
  searchParams: Promise<{ code?: string; draft?: string; flash?: string; kind?: string }>;
}) {
  const { period } = await params;
  const sp = await searchParams;
  if (!listPeriods().includes(period)) notFound();

  const user = await currentUser();
  if (!can(user.role, "report:view")) return <NoAccess role={user.role} capability="report:view" />;

  const items = buildItems(period);
  const report = getReport(period);
  const audit = listAudit({ entity: "qc_report", entityId: period, limit: 20 });
  const snapshot = readSnapshot(period);
  const diffs = snapshot ? snapshotDiff(period) : [];
  const drill = sp.code ? indicatorDrilldown(sp.code, period) : null;
  const prev = previousPeriod(period);
  const issues = validateSubmission(period, report.submit_note ?? "");

  const generatedDraft =
    sp.draft === "1"
      ? runRuleAgent({ question: "帮我起草一段报告说明", period, patientId: undefined })
      : null;

  const canSubmit = can(user.role, "report:submit") && (report.status === "draft" || report.status === "returned");
  const canReview = can(user.role, "report:review") && report.status === "submitted";
  const canReportOut = can(user.role, "report:reportOut") && report.status === "approved";
  const canRecompute = can(user.role, "report:recompute");

  return (
    <main className="page">
      <Flash message={sp.flash} kind={sp.kind} />

      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <Link href="/reports" className="muted" style={{ fontSize: 12 }}>
              ← 质控报告
            </Link>
            <span className="faint">/</span>
            <span className="mono faint" style={{ fontSize: 11.5 }}>
              {period}
            </span>
          </div>
          <h1 className="page-title" style={{ marginTop: 4 }}>
            {periodLabel(period)}质控报告
            <span style={{ marginLeft: 10 }}>
              <StatusPill status={report.status} />
            </span>
          </h1>
          <div className="page-sub">
            版本 v{report.version}
            {snapshot ? ` · 口径冻结于 ${fmtDateTime(snapshot.frozenAt)}（${snapshot.frozenBy}）` : " · 尚未冻结"}
            {prev ? ` · 环比基准 ${prev}` : ""}
          </div>
        </div>
        <div className="page-actions">
          <a className="btn btn-sm" href={`/api/reports/${period}/export`}>
            导出 CSV
          </a>
          <PrintButton />
          {can(user.role, "agent:period") ? (
            <Link href={`/reports/${period}?draft=1`} className="btn btn-sm">
              AI 起草说明
            </Link>
          ) : null}
          {canRecompute ? (
            <form action={recomputeAction}>
              <input type="hidden" name="period" value={period} />
              <button className="btn btn-sm" type="submit">
                按当前口径重取数
              </button>
            </form>
          ) : (
            <span className="chip muted" title="需科室质控员权限">
              重取数需质控员权限
            </span>
          )}
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <Card
            title="指标明细"
            sub="分子 / 分母均可下钻到患者与原始事件；口径定义见「指标口径库」"
            bodyClass="tight"
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th className="num">结果</th>
                    <th className="num">目标</th>
                    <th className="num">环比</th>
                    <th style={{ width: 110 }}>达标</th>
                    <th className="num">分子 / 分母</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.def.code} style={sp.code === item.def.code ? { background: "#f0fdfa" } : undefined}>
                      <td>
                        <div className="strong">{item.def.name}</div>
                        <div className="mono faint" style={{ fontSize: 10.5 }}>
                          {item.def.code} · {item.def.category}
                        </div>
                      </td>
                      <td className="num strong">{pct(item.rate)}</td>
                      <td className="num faint">{pct(item.def.target, 0)}</td>
                      <td className="num">
                        <Delta value={item.delta} direction={item.direction} />
                      </td>
                      <td>
                        {item.direction === "info" ? (
                          <Pill tone="neutral">参考值</Pill>
                        ) : item.metTarget ? (
                          <Pill tone="ok">达标</Pill>
                        ) : (
                          <Pill tone="warn">未达标</Pill>
                        )}
                      </td>
                      <td className="num">
                        {item.numerator} / {item.denominator}
                      </td>
                      <td>
                        <Link
                          href={`/reports/${period}?code=${item.def.code}`}
                          className="btn btn-sm"
                          style={{ padding: "2px 7px" }}
                        >
                          下钻
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {drill ? (
            <Card
              title={`下钻 · ${drill.def.name}`}
              sub={drill.def.formula}
              actions={
                <Link href={`/reports/${period}`} className="muted" style={{ fontSize: 11.5 }}>
                  关闭下钻
                </Link>
              }
              bodyClass="tight"
            >
              <div className="card-body" style={{ paddingBottom: 8 }}>
                <div className="note" style={{ marginBottom: 10 }}>
                  {drill.def.rationale}
                </div>
                <div className="row wrap" style={{ gap: 8, marginBottom: 4 }}>
                  <span className="chip">
                    分子 <b>{drill.result.numerator}</b>
                  </span>
                  <span className="chip">
                    分母 <b>{drill.result.denominator}</b>
                  </span>
                  <span className="chip">
                    结果 <b>{pct(drill.result.rate)}</b>
                  </span>
                </div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>患者</th>
                      <th>床号</th>
                      <th>诊断</th>
                      <th>判定</th>
                      <th>证据（来自派生层）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...drill.misses, ...drill.hits].map((row: { id?: string; name?: string; bed?: string; dx?: string; evidence?: string | null }, idx) => {
                      const ev = parseEvidence(row.evidence ?? null);
                      const hit = drill.hits.some((h: { id?: string }) => h.id === row.id);
                      return (
                        <tr key={`${row.id}-${idx}`}>
                          <td>
                            <Link href={`/patients/${row.id}`} className="row-link">
                              {row.name}
                            </Link>
                          </td>
                          <td className="mono">{row.bed}</td>
                          <td>{row.dx}</td>
                          <td>{hit ? <Pill tone="ok">命中</Pill> : <Pill tone="bad">未命中</Pill>}</td>
                          <td className="mono" style={{ fontSize: 10.5, color: "var(--muted)", maxWidth: 300 }}>
                            {ev
                              ? Object.entries(ev)
                                  .filter(([, v]) => v !== null && v !== undefined)
                                  .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
                                  .join(" · ")
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          {generatedDraft ? (
            <Card
              title="AI 起草 · 报告说明"
              sub={`引擎：${generatedDraft.engine === "rules" ? "确定性规划器（未配置模型 Key）" : "大模型"} · ${generatedDraft.steps.length} 次工具调用`}
              actions={
                <Link href={`/reports/${period}`} className="muted" style={{ fontSize: 11.5 }}>
                  关闭
                </Link>
              }
            >
              <form action={adoptAgentDraft}>
                <input type="hidden" name="period" value={period} />
                <div className="field">
                  <label>草稿内容（可编辑，确认后写入提交说明）</label>
                  <textarea className="textarea" name="note" rows={7} defaultValue={generatedDraft.draft ?? generatedDraft.answer} />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-primary" type="submit">
                    采纳到提交说明
                  </button>
                  <span className="hint" style={{ margin: 0 }}>
                    Agent 只产出文本，落库必须由你确认（HITL）
                  </span>
                </div>
              </form>
              <div className="divider" />
              <div className="stack" style={{ gap: 6 }}>
                {generatedDraft.steps.map((s, i) => (
                  <div className="step" key={i}>
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
            </Card>
          ) : null}

          {snapshot ? (
            <Card title="冻结快照 vs 当前重算" sub="提交后口径被冻结，后续数据变化不会悄悄改写已上报的数字">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>指标</th>
                      <th className="num">冻结值</th>
                      <th className="num">当前重算</th>
                      <th>差异</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => (
                      <tr key={d.code}>
                        <td>{d.name}</td>
                        <td className="num">{pct(d.frozen)}</td>
                        <td className="num">{pct(d.live)}</td>
                        <td>
                          {d.changed ? (
                            <Pill tone="warn">已发生变化</Pill>
                          ) : (
                            <span className="faint" style={{ fontSize: 11.5 }}>一致</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <Card title="本报告审计轨迹" sub="谁在什么时候改了什么，都能追到" bodyClass="tight">
            <div className="card-body">
              <div className="timeline">
                {audit.length === 0 ? <div className="empty">暂无记录</div> : null}
                {audit.map((entry) => (
                  <div className="tl-item" key={entry.id}>
                    <div
                      className={`tl-dot ${
                        entry.action.includes("returned") ? "bad" : entry.action.includes("approved") ? "ok" : "info"
                      }`}
                    />
                    <div className="tl-head">
                      <span className="tl-title">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                      <span className="tl-time">{fmtDateTime(entry.at)}</span>
                    </div>
                    <div className="tl-body">
                      {entry.actor_name} · {ROLE_LABEL[(entry.role as keyof typeof ROLE_LABEL) ?? "qc"]}
                    </div>
                    {entry.note ? <div className="tl-meta">{entry.note}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card
            title="审批与流转"
            sub={`当前身份：${user.name} · ${ROLE_LABEL[user.role]}`}
            actions={<span className={`pill ${STATUS_TONE[report.status]}`}>{STATUS_LABEL[report.status]}</span>}
          >
            {canSubmit ? (
              <form action={submitReportAction}>
                <input type="hidden" name="period" value={period} />
                <div className="field">
                  <label>提交说明（波动超过 15pp 或指标未达标时必须写清原因）</label>
                  <textarea
                    className="textarea"
                    name="note"
                    rows={5}
                    defaultValue={report.submit_note ?? ""}
                    placeholder="例如：本月 DVT 预防率下降，主要因新人培训导致执行延迟，已排班双人核查……"
                  />
                </div>
                {issues.length ? (
                  <div className="note warn" style={{ marginBottom: 10 }}>
                    <strong>提交前校验</strong>
                    <ul style={{ margin: "5px 0 0 16px", padding: 0 }}>
                      {issues.slice(0, 4).map((i, idx) => (
                        <li key={idx} style={{ fontSize: 11.5 }}>
                          {i.message}
                          {i.blocking ? "（阻断）" : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="note" style={{ marginBottom: 10 }}>
                    校验通过：口径完整，波动项已有解释。
                  </div>
                )}
                <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} type="submit">
                  提交给科主任审核
                </button>
              </form>
            ) : null}

            {canReview ? (
              <form action={approveAction}>
                <input type="hidden" name="period" value={period} />
                <div className="field">
                  <label>审核意见</label>
                  <textarea className="textarea" name="note" rows={3} placeholder="同意上报 / 请补充说明……" />
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1, justifyContent: "center" }} type="submit">
                    审核通过
                  </button>
                  <button
                    className="btn btn-danger"
                    style={{ flex: 1, justifyContent: "center" }}
                    type="submit"
                    formAction={returnAction}
                  >
                    退回修订
                  </button>
                </div>
              </form>
            ) : null}

            {canReportOut ? (
              <form action={reportOutAction}>
                <input type="hidden" name="period" value={period} />
                <div className="note" style={{ marginBottom: 10 }}>
                  报告已通过审核，可上报至质控中心。上报后仍可在「冻结快照」中追溯当时的分子分母。
                </div>
                <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} type="submit">
                  上报质控中心
                </button>
              </form>
            ) : null}

            {!canSubmit && !canReview && !canReportOut ? (
              <div className="note">
                {report.status === "submitted"
                  ? "报告已提交，等待科主任审核。当前身份无审核权限，可切换为「赵国强 · 科主任」体验审核。"
                  : report.status === "reported"
                    ? "报告已上报，口径已冻结。"
                    : report.status === "approved"
                      ? "报告已通过审核，等待科主任上报。"
                      : `当前状态「${STATUS_LABEL[report.status]}」，由质控员发起提交，科主任审核。`}
              </div>
            ) : null}

            <div className="divider" />
            <div className="stack" style={{ gap: 8, fontSize: 12 }}>
              <div className="row between">
                <span className="muted">提交人</span>
                <span>{userName(report.submitted_by)}</span>
              </div>
              <div className="row between">
                <span className="muted">提交时间</span>
                <span className="mono">{report.submitted_at ? fmtDateTime(report.submitted_at) : "—"}</span>
              </div>
              <div className="row between">
                <span className="muted">审核人</span>
                <span>{userName(report.reviewed_by)}</span>
              </div>
              <div className="row between">
                <span className="muted">上报时间</span>
                <span className="mono">{report.reported_at ? fmtDateTime(report.reported_at) : "—"}</span>
              </div>
            </div>
            {report.submit_note ? (
              <>
                <div className="divider" />
                <div className="kpi-label">提交说明</div>
                <div style={{ fontSize: 12, lineHeight: 1.6, marginTop: 3 }}>{report.submit_note}</div>
              </>
            ) : null}
            {report.review_note ? (
              <>
                <div className="divider" />
                <div className="kpi-label">审核意见</div>
                <div style={{ fontSize: 12, lineHeight: 1.6, marginTop: 3 }}>{report.review_note}</div>
              </>
            ) : null}
          </Card>

          {can(user.role, "agent:period") ? (
            <AgentPanel period={period} />
          ) : (
            <Card title="临床 Agent" sub="报告级会诊仅对质控与管理角色开放">
              <div className="note">
                当前身份是「{ROLE_LABEL[user.role]}」，可以使用患者级会诊（进入患者详情页）。
                报告级分析涉及全科室数据，仅对科室质控员与科主任开放。
              </div>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
