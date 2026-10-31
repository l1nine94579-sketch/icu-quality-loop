import Link from "next/link";
import { getIndicatorDef, listIndicatorDefs } from "@/lib/indicators";
import { buildItems } from "@/lib/reports";
import { currentPeriod } from "@/lib/repo";
import { listPeriods } from "@/lib/reports";
import { pct, periodLabel } from "@/lib/format";
import { Card, Meter, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function IndicatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const sp = await searchParams;
  const periods = listPeriods();
  const period = sp.period && periods.includes(sp.period) ? sp.period : currentPeriod();
  const defs = listIndicatorDefs();
  const items = buildItems(period);
  const byCode = new Map(items.map((i) => [i.def.code, i]));

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">指标口径库</h1>
          <div className="page-sub">
            一条指标 = 一段可审阅的 SQL + 一句人话公式 + 目标值；分子分母都在患者粒度产出，随时可下钻
          </div>
        </div>
        <div className="page-actions">
          {periods.map((p) => (
            <Link key={p} href={`/indicators?period=${p}`} className={`chip ${p === period ? "" : "muted"}`}>
              {p === period ? <b>{periodLabel(p)}</b> : periodLabel(p)}
            </Link>
          ))}
        </div>
      </div>

      <div className="stack">
        {defs.map((def) => {
          const item = byCode.get(def.code);
          const target = getIndicatorDef(def.code)?.target ?? def.target;
          return (
            <Card
              key={def.code}
              title={
                <span className="row" style={{ gap: 8 }}>
                  {def.name}
                  <span className="mono faint" style={{ fontSize: 10.5, fontWeight: 400 }}>
                    {def.code}
                  </span>
                  <Pill tone={item?.metTarget ? "ok" : "warn"}>
                    {periodLabel(period)} {pct(item?.rate)}
                  </Pill>
                </span>
              }
              sub={`${def.category} · 口径负责人：${def.owner} · ${
                (def.direction ?? "up") === "info" ? `参考值 ${pct(target, 0)}` : `目标 ${(def.direction ?? "up") === "down" ? "≤" : "≥"}${pct(target, 0)}`
              }`}
              actions={
                <Link href={`/reports/${period}?code=${def.code}`} className="btn btn-sm">
                  患者明细
                </Link>
              }
            >
              <div className="grid grid-3" style={{ marginBottom: 12 }}>
                <div>
                  <div className="kpi-label">人话公式</div>
                  <div style={{ fontSize: 12, marginTop: 2 }}>{def.formula}</div>
                </div>
                <div>
                  <div className="kpi-label">分子 / 分母</div>
                  <div className="tnum" style={{ fontSize: 16, fontWeight: 650, marginTop: 1 }}>
                    {item?.numerator} / {item?.denominator}
                  </div>
                </div>
                <div>
                  <div className="kpi-label">达标进度</div>
                  <Meter value={item?.rate ?? 0} tone={item?.metTarget ? "ok" : "warn"} />
                  <div className="faint" style={{ fontSize: 10.5, marginTop: 3 }}>
                    {item?.metTarget ? "已达标" : `距目标 ${pct(Math.max(0, target - (item?.rate ?? 0)), 1)}`}
                  </div>
                </div>
              </div>

              <div className="note" style={{ marginBottom: 10 }}>
                {def.rationale}
              </div>

              <details className="disclosure">
                <summary>查看口径 SQL（只读，运行时按周期参数执行）</summary>
                <div>
                  <pre className="code">{def.sql}</pre>
                </div>
              </details>
            </Card>
          );
        })}
      </div>
    </main>
  );
}
