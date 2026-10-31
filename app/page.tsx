import Link from "next/link";
import { buildItems, getReport, listPeriods, STATUS_LABEL } from "@/lib/reports";
import { getDashboard, listPatients } from "@/lib/repo";
import { listAudit, ACTION_LABEL } from "@/lib/audit";
import { currentUser, ROLE_LABEL } from "@/lib/session";
import { fmtDateTime, periodLabel, pct } from "@/lib/format";
import { AkiPill, ArdsPill, Card, Delta, Flash, Kpi, Meter, Pill, StatusPill } from "@/components/ui";
import { IconArrow } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ flash?: string; kind?: string; period?: string }>;
}) {
  const sp = await searchParams;
  const user = await currentUser();
  const periods = listPeriods();

  if (periods.length === 0) {
    return (
      <main className="page">
        <Card title="还没有数据" sub="首次运行需要生成合成数据集">
          <div className="note">
            在项目根目录执行 <code className="mono">pnpm seed</code>（或 <code className="mono">npm run seed</code>），
            会生成 58 例合成患者、3 个质控周期与 2 份已提交报告，然后刷新本页。
          </div>
          <div className="hint">数据库文件：data/icu.db · 全部为合成数据，不含真实患者信息</div>
        </Card>
      </main>
    );
  }

  const period = sp.period && periods.includes(sp.period) ? sp.period : periods[0];
  const report = getReport(period);
  const dash = getDashboard(period);
  const items = buildItems(period);
  const audit = listAudit({ limit: 6 });
  const recent = listPatients({ period }).slice(0, 5);
  const below = items.filter((i) => i.rate != null && !i.metTarget);

  const todo =
    user.role === "director"
      ? { title: "待你审核的报告", body: `${dash.pendingReview} 份报告等待科主任审核`, href: "/reports" }
      : user.role === "qc"
        ? { title: "待你提交的报告", body: `${dash.pendingDraft} 个周期处于填报 / 退回状态`, href: "/reports" }
        : { title: "今日待关注", body: `${below.length} 项指标低于目标值，${dash.akiCount} 例 AKI 患者`, href: "/reports" };

  return (
    <main className="page">
      <Flash message={sp.flash} kind={sp.kind} />

      <div className="page-head">
        <div>
          <h1 className="page-title">临床工作台</h1>
          <div className="page-sub">
            {periodLabel(period)} · 科室质控闭环 · 数据截至 {fmtDateTime(new Date().toISOString())}
          </div>
        </div>
        <div className="page-actions">
          {periods.map((p) => (
            <Link key={p} href={`/?period=${p}`} className={`chip ${p === period ? "" : "muted"}`}>
              {p === period ? <b>{periodLabel(p)}</b> : periodLabel(p)}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 14 }}>
        <Kpi
          label="当前在科患者"
          value={dash.inIcu}
          foot={<span>{periodLabel(period)}收治 {dash.monthPatients} 例</span>}
        />
        <Kpi
          label="AKI 检出"
          value={`${dash.akiCount} 例`}
          foot={<span>占比 {pct(dash.monthPatients ? dash.akiCount / dash.monthPatients : 0)}</span>}
          tone="warn"
        />
        <Kpi
          label="机械通气"
          value={`${dash.ventCount} 例`}
          foot={<span>ARDS 分层完成情况见质控报告</span>}
        />
        <Kpi
          label={`${periodLabel(period)}报告`}
          value={<span style={{ fontSize: 17 }}>{STATUS_LABEL[report.status]}</span>}
          foot={
            <span>
              版本 v{report.version} · {report.submitted_at ? fmtDateTime(report.submitted_at) : "尚未提交"}
            </span>
          }
          tone={report.status === "returned" ? "bad" : report.status === "draft" ? "warn" : "ok"}
        />
      </div>

      <div className="split">
        <div className="stack">
          <Card
            title="指标概览"
            sub={`${periodLabel(period)} · 点击任一指标查看分子分母与患者明细`}
            actions={
              <Link href={`/reports/${period}`} className="btn btn-sm">
                查看报告 <IconArrow style={{ width: 13, height: 13 }} />
              </Link>
            }
            bodyClass="tight"
          >
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th className="num">本周期</th>
                    <th className="num">环比</th>
                    <th style={{ width: 130 }}>达标情况</th>
                    <th className="num">分子 / 分母</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.def.code}>
                      <td>
                        <Link href={`/reports/${period}?code=${item.def.code}`} className="row-link">
                          {item.def.name}
                        </Link>
                        <div className="mono faint" style={{ fontSize: 10.5 }}>
                          {item.def.code}
                        </div>
                      </td>
                      <td className="num strong">{pct(item.rate)}</td>
                      <td className="num">
                        <Delta value={item.delta} direction={item.direction} />
                      </td>
                      <td>
                        {item.direction === "info" ? (
                          <Pill tone="neutral">参考值 {pct(item.def.target, 0)}</Pill>
                        ) : item.metTarget ? (
                          <Pill tone="ok">达标</Pill>
                        ) : (
                          <Pill tone="warn">低于目标</Pill>
                        )}
                      </td>
                      <td className="num">
                        {item.numerator} / {item.denominator}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="最近在科患者" sub="按入科时间排序 · 点击进入患者详情" bodyClass="tight">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>床号 / 患者</th>
                    <th>入科诊断</th>
                    <th>AKI</th>
                    <th>ARDS</th>
                    <th className="num">APACHEⅡ</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/patients/${p.id}`} className="row-link">
                          {p.bed} · {p.name}
                        </Link>
                        <div className="mono faint" style={{ fontSize: 10.5 }}>
                          {p.mrn}
                        </div>
                      </td>
                      <td>{p.dx}</td>
                      <td>
                        <AkiPill stage={p.aki_stage} />
                      </td>
                      <td>
                        <ArdsPill severity={p.ards_severity} />
                      </td>
                      <td className="num">{p.apache_ii ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card title="你的待办" sub={`${user.name} · ${ROLE_LABEL[user.role]}`}>
            <div className="note" style={{ marginBottom: 10 }}>
              <strong>{todo.title}</strong>
              <div style={{ marginTop: 3 }}>{todo.body}</div>
            </div>
            <Link href={todo.href} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
              去处理
            </Link>
            <div className="divider" />
            <div className="row between" style={{ fontSize: 12 }}>
              <span className="muted">低于目标的指标</span>
              <b>{below.length} 项</b>
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 8 }}>
              {below.slice(0, 3).map((i) => (
                <div key={i.def.code} className="row between">
                  <span style={{ fontSize: 12 }}>{i.def.name}</span>
                  <Pill tone="warn">{pct(i.rate)}</Pill>
                </div>
              ))}
              {below.length === 0 ? <span className="muted" style={{ fontSize: 12 }}>全部达标</span> : null}
            </div>
          </Card>

          <Card
            title="审计动态"
            sub="所有状态变更与数据修改都留痕"
            actions={
              <Link href="/audit" className="muted" style={{ fontSize: 11.5 }}>
                全部
              </Link>
            }
          >
            <div className="timeline">
              {audit.map((entry) => (
                <div className="tl-item" key={entry.id}>
                  <div className={`tl-dot ${entry.action.includes("returned") ? "bad" : entry.action.includes("approved") ? "ok" : "info"}`} />
                  <div className="tl-head">
                    <span className="tl-title">{ACTION_LABEL[entry.action] ?? entry.action}</span>
                    <span className="tl-time">{fmtDateTime(entry.at)}</span>
                  </div>
                  <div className="tl-body">
                    {entry.actor_name}（{ROLE_LABEL[(entry.role as keyof typeof ROLE_LABEL) ?? "nurse"]}）
                    {entry.entity === "qc_report" ? ` · ${entry.entity_id}` : ""}
                  </div>
                  {entry.note ? <div className="tl-meta">{entry.note}</div> : null}
                </div>
              ))}
            </div>
          </Card>

          <Card title="报告流转" sub="当前周期状态机">
            <div className="row wrap" style={{ gap: 6 }}>
              <StatusPill status="draft" />
              <span className="faint">→</span>
              <StatusPill status="submitted" />
              <span className="faint">→</span>
              <StatusPill status="approved" />
              <span className="faint">→</span>
              <StatusPill status="reported" />
            </div>
            <div className="hint" style={{ marginTop: 8 }}>
              退回会把版本号 +1 并回到「已退回」，重新提交后生成新的冻结快照。
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
