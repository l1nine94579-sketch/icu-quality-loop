import Link from "next/link";
import { currentPeriod, listPatients } from "@/lib/repo";
import { listPeriods } from "@/lib/reports";
import { fmtDate, periodLabel, stayLabel } from "@/lib/format";
import { AkiPill, ArdsPill, Card, Flash, Pill } from "@/components/ui";
import { IconArrow } from "@/components/icons";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "all", label: "全部" },
  { key: "aki", label: "AKI" },
  { key: "ards", label: "ARDS" },
  { key: "in_icu", label: "在科" },
];

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; q?: string; filter?: string; flash?: string; kind?: string }>;
}) {
  const sp = await searchParams;
  const periods = listPeriods();
  const period = sp.period && periods.includes(sp.period) ? sp.period : currentPeriod();
  const filter = sp.filter ?? "all";

  const rows = listPatients({
    period,
    search: sp.q,
    aki: filter === "aki" ? "yes" : undefined,
    ards: filter === "ards" ? "yes" : undefined,
    status: filter === "in_icu" ? "in_icu" : undefined,
  });

  const all = listPatients({ period });
  const akiCount = all.filter((r) => (r.aki_stage ?? 0) >= 1).length;
  const ardsCount = all.filter((r) => ["mild", "moderate", "severe"].includes(r.ards_severity ?? "")).length;

  return (
    <main className="page">
      <Flash message={sp.flash} kind={sp.kind} />
      <div className="page-head">
        <div>
          <h1 className="page-title">患者与专病</h1>
          <div className="page-sub">
            {periodLabel(period)} · 收治 {all.length} 例 · AKI {akiCount} 例 · ARDS {ardsCount} 例
          </div>
        </div>
        <div className="page-actions">
          {periods.map((p) => (
            <Link key={p} href={`/patients?period=${p}`} className={`chip ${p === period ? "" : "muted"}`}>
              {p === period ? <b>{periodLabel(p)}</b> : periodLabel(p)}
            </Link>
          ))}
        </div>
      </div>

      <Card
        title="患者列表"
        sub="AKI / ARDS 结果来自规则引擎，点击患者可查看判定依据与 AI 会诊"
        actions={
          <form className="row" action="/patients" style={{ gap: 6 }}>
            <input type="hidden" name="period" value={period} />
            <input type="hidden" name="filter" value={filter} />
            <div className="search">
              <input name="q" defaultValue={sp.q ?? ""} placeholder="姓名 / 住院号 / 床号" />
            </div>
            <button className="btn btn-sm" type="submit">
              搜索
            </button>
          </form>
        }
        bodyClass="tight"
      >
        <div className="row wrap" style={{ padding: "10px 14px", borderBottom: "1px solid var(--line)", gap: 6 }}>
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/patients?period=${period}&filter=${f.key}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}
              className={`chip ${filter === f.key ? "" : "muted"}`}
            >
              {filter === f.key ? <b>{f.label}</b> : f.label}
            </Link>
          ))}
          <span className="spacer" />
          <span className="faint" style={{ fontSize: 11.5 }}>
            共 {rows.length} 条
          </span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>床号 / 患者</th>
                <th>入科诊断</th>
                <th>入科</th>
                <th>住院时长</th>
                <th>AKI</th>
                <th>ARDS</th>
                <th>DVT 预防</th>
                <th>用药前送检</th>
                <th>24h 评估</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/patients/${p.id}`} className="row-link">
                      {p.bed} · {p.name}
                    </Link>
                    <div className="mono faint" style={{ fontSize: 10.5 }}>
                      {p.mrn} · {p.gender} {p.age} 岁
                    </div>
                  </td>
                  <td style={{ maxWidth: 190 }}>{p.dx}</td>
                  <td className="mono">{fmtDate(p.admitted_at)}</td>
                  <td className="mono">{stayLabel(p.stay_hours)}</td>
                  <td>
                    <AkiPill stage={p.aki_stage} />
                  </td>
                  <td>
                    <ArdsPill severity={p.ards_severity} />
                  </td>
                  <td>
                    {p.dvt_prophylaxis ? <Pill tone="ok">已完成</Pill> : <Pill tone="bad">待补</Pill>}
                  </td>
                  <td>
                    {p.culture_before_abx ? (
                      <Pill tone="ok">合规</Pill>
                    ) : (
                      <span className="faint">未用药</span>
                    )}
                  </td>
                  <td>
                    {p.assessed_24h ? <Pill tone="ok">已完成</Pill> : <Pill tone="warn">延迟</Pill>}
                  </td>
                  <td>
                    <Link href={`/patients/${p.id}`} className="btn btn-sm">
                      详情 <IconArrow style={{ width: 12, height: 12 }} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 ? <div className="empty">没有符合条件的患者</div> : null}
        </div>
      </Card>
    </main>
  );
}
