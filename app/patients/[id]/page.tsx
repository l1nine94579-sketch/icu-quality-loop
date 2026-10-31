import Link from "next/link";
import { notFound } from "next/navigation";
import { getEvents, getObservations, getPatient } from "@/lib/repo";
import { parseEvidence, type Evidence } from "@/lib/features";
import { AKI_STAGE_LABEL, SEVERITY_LABEL, type Criterion } from "@/lib/engine";
import { fmtDate, fmtDateTime, num, stayLabel } from "@/lib/format";
import { AkiPill, ArdsPill, Card, Flash, Meter, Pill } from "@/components/ui";
import { Sparkline } from "@/components/Sparkline";
import { AgentPanel } from "@/components/AgentPanel";
import { rebuildMetricsAction } from "@/app/actions";

export const dynamic = "force-dynamic";

function CriteriaList({ criteria, sourceLabel }: { criteria: Criterion[]; sourceLabel?: string }) {
  if (!criteria.length) return <div className="empty">规则未产出判据</div>;
  const hits = criteria.filter((c) => c.hit);
  const misses = criteria.filter((c) => !c.hit);
  const visible = [...hits, ...misses.slice(0, hits.length ? 0 : 2)];
  const rest = [...hits, ...misses].slice(visible.length);

  const Row = ({ c, i }: { c: Criterion; i: number }) => (
    <div className={`crit ${c.hit ? "hit" : ""}`} key={`${c.id}-${c.stage}-${i}`}>
      <div className="crit-head">
        <span className={`pill ${c.hit ? "warn" : "neutral"}`}>{c.hit ? "命中" : "未命中"}</span>
        <span className="name">{c.label}</span>
        <span className="spacer" />
        <span className="tag">
          {sourceLabel ?? (c.source === "creatinine" ? "肌酐" : c.source === "urine" ? "尿量" : "治疗")}
        </span>
      </div>
      <div className="crit-body">
        <span>
          <span className="k">实测 </span>
          {c.observed}
        </span>
        <span>
          <span className="k">阈值 </span>
          {c.threshold}
        </span>
      </div>
    </div>
  );

  return (
    <div className="stack" style={{ gap: 0 }}>
      {visible.map((c, i) => (
        <Row c={c} i={i} key={`v-${c.id}-${i}`} />
      ))}
      {rest.length ? (
        <details className="disclosure" style={{ marginTop: 8 }}>
          <summary>展开其余 {rest.length} 条未命中判据</summary>
          <div>
            {rest.map((c, i) => (
              <Row c={c} i={i} key={`r-${c.id}-${i}`} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default async function PatientDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ flash?: string; kind?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const p = getPatient(id);
  if (!p) notFound();

  const observations = getObservations(id);
  const events = getEvents(id);
  const evidence = parseEvidence<Evidence>(p.evidence);
  const creatinine = observations.filter((o) => o.code === "creatinine").map((o) => ({ at: o.measured_at, value: o.value }));
  const urine = observations.filter((o) => o.code === "urine_ml");

  const gaps: string[] = [];
  if (!p.dvt_prophylaxis) gaps.push("入科 24h 内未落实 DVT 预防");
  if (!p.assessed_24h) gaps.push("入科 24h 内未完成早期评估");
  if (p.abx_started && !p.culture_before_abx) gaps.push("抗菌药物使用前未送检病原学");
  if ((p.aki_stage ?? 0) >= 1 && !evidence?.creatinine?.length) gaps.push("AKI 阳性但缺少肌酐序列");
  if (p.vent_started && p.pf_ratio == null) gaps.push("机械通气但缺少可配对的 PaO₂ / FiO₂");

  return (
    <main className="page">
      <Flash message={sp.flash} kind={sp.kind} />

      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <Link href="/patients" className="muted" style={{ fontSize: 12 }}>
              ← 患者列表
            </Link>
            <span className="faint">/</span>
            <span className="mono faint" style={{ fontSize: 11.5 }}>
              {p.mrn}
            </span>
          </div>
          <h1 className="page-title" style={{ marginTop: 4 }}>
            {p.bed} · {p.name}
            <span className="muted" style={{ fontSize: 13, fontWeight: 400, marginLeft: 10 }}>
              {p.gender} · {p.age} 岁 · {p.dx}
            </span>
          </h1>
          <div className="page-sub">
            入科 {fmtDateTime(p.admitted_at)}
            {p.discharged_at ? ` · 出科 ${fmtDateTime(p.discharged_at)}` : " · 仍在科"}
            {" · "}住院 {stayLabel(p.stay_hours)} · 体重 {num(p.weight_kg)} kg · APACHEⅡ {p.apache_ii ?? "—"}
          </div>
        </div>
        <div className="page-actions">
          <span className="chip">
            AKI <b>{AKI_STAGE_LABEL[p.aki_stage ?? 0]}</b>
          </span>
          <span className="chip">
            ARDS <b>{SEVERITY_LABEL[(p.ards_severity ?? "insufficient") as keyof typeof SEVERITY_LABEL]}</b>
          </span>
          <form action={rebuildMetricsAction}>
            <input type="hidden" name="patientId" value={p.id} />
            <button className="btn btn-sm" type="submit">
              重算派生指标
            </button>
          </form>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <div className="grid grid-4">
            <div className="card kpi">
              <div className="kpi-label">AKI 分期</div>
              <div className="kpi-value" style={{ fontSize: 20 }}>
                <AkiPill stage={p.aki_stage} />
              </div>
              <div className="kpi-foot">基线 {num(evidence?.baselineCr)} mg/dL</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">峰值倍率</div>
              <div className="kpi-value" style={{ fontSize: 20 }}>
                {evidence?.peakRatio ? `${evidence.peakRatio}×` : "—"}
              </div>
              <div className="kpi-foot">峰值 {num(evidence?.peakCr)} mg/dL</div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">P/F 比值</div>
              <div className="kpi-value" style={{ fontSize: 20 }}>
                {num(p.pf_ratio, 0)}
                <span className="muted" style={{ fontSize: 11, marginLeft: 3 }}>
                  mmHg
                </span>
              </div>
              <div className="kpi-foot">
                <ArdsPill severity={p.ards_severity} />
              </div>
            </div>
            <div className="card kpi">
              <div className="kpi-label">GCS</div>
              <div className="kpi-value" style={{ fontSize: 20 }}>
                {p.aki_stage === null ? "—" : (evidence?.gcs ?? "—")}
              </div>
              <div className="kpi-foot">{p.vent_started ? "机械通气" : "自主呼吸"}</div>
            </div>
          </div>

          <Card title="肌酐趋势" sub={`${creatinine.length} 次检测 · 基线取入科后首份结果`}>
            <Sparkline points={creatinine} baseline={evidence?.baselineCr ?? null} unit="mg/dL" />
            {urine.length > 0 ? (
              <div className="hint" style={{ marginTop: 6 }}>
                同期尿量记录 {urine.length} 条，最低 {Math.min(...urine.map((u) => u.value))} mL/h
                {evidence?.urine?.lowWindows?.length ? ` · 命中低尿量窗口：${evidence.urine.lowWindows.join("、")}` : ""}
              </div>
            ) : null}
          </Card>

          <Card
            title="AKI 判定依据（KDIGO 2012）"
            sub="命中项来自肌酐与尿量两条路径，尿量窗口按小时聚合"
            actions={<Pill tone={(p.aki_stage ?? 0) >= 1 ? "bad" : "ok"}>{AKI_STAGE_LABEL[p.aki_stage ?? 0]}</Pill>}
          >
            <CriteriaList criteria={evidence?.aki?.criteria ?? []} />
            <div className="note" style={{ marginTop: 12 }}>
              分期取所有命中判据中的最高等级；数据不足时标记"无法判定"，不做缺省推定。
            </div>
          </Card>

          <Card
            title="ARDS 分度（柏林定义）"
            sub="需要 PaO₂、FiO₂ 与 PEEP 三个前提，缺一即标记数据不足"
            actions={<ArdsPill severity={p.ards_severity} />}
          >
            <CriteriaList criteria={evidence?.ards?.criteria ?? []} sourceLabel="血气" />
            {evidence?.abg ? (
              <div className="hint" style={{ marginTop: 10 }}>
                取最近一次血气：PaO₂ {evidence.abg.pao2} mmHg / FiO₂ {evidence.abg.fio2}
                {evidence.abg.peep != null ? ` / PEEP ${evidence.abg.peep} cmH₂O` : ""} ·{" "}
                {fmtDateTime(evidence.abg.at)}
              </div>
            ) : null}
          </Card>

          <Card title="护理事件与医嘱执行" sub="指标分母中的关键时间点都来自这里" bodyClass="tight">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>事件</th>
                    <th>类型</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{fmtDateTime(e.at)}</td>
                      <td>{e.label}</td>
                      <td>
                        <span className="tag">{e.type}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="数据缺口" sub="这些缺口会直接拉低月度指标">
            {gaps.length === 0 ? (
              <div className="note">未发现结构化缺口，质控证据链完整。</div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {gaps.map((g) => (
                  <div key={g} className="note warn">
                    {g}
                  </div>
                ))}
              </div>
            )}
            <div className="divider" />
            <div className="row between" style={{ fontSize: 12 }}>
              <span className="muted">DVT 预防</span>
              {p.dvt_prophylaxis ? <Pill tone="ok">已完成</Pill> : <Pill tone="bad">缺失</Pill>}
            </div>
            <div className="row between" style={{ fontSize: 12, marginTop: 6 }}>
              <span className="muted">用药前送检</span>
              {p.culture_before_abx ? <Pill tone="ok">合规</Pill> : <Pill tone="bad">不合规</Pill>}
            </div>
            <div className="row between" style={{ fontSize: 12, marginTop: 6 }}>
              <span className="muted">24h 早期评估</span>
              {p.assessed_24h ? <Pill tone="ok">已完成</Pill> : <Pill tone="warn">延迟</Pill>}
            </div>
            <div className="divider" />
            <div className="muted" style={{ fontSize: 11.5 }}>
              派生指标更新于 {fmtDateTime(p.computed_at)}
            </div>
          </Card>

          <AgentPanel patientId={p.id} patientName={p.name} />
        </div>
      </div>
    </main>
  );
}
