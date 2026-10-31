import Link from "next/link";
import { listReports, userName } from "@/lib/repo";
import { listPeriods, STATUS_LABEL } from "@/lib/reports";
import { fmtDateTime, periodLabel } from "@/lib/format";
import { Card, Meter, StatusPill } from "@/components/ui";
import { IconArrow } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const reports = listReports();
  const periods = listPeriods();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">质控报告</h1>
          <div className="page-sub">
            按自然月出数 · 提交即冻结口径 · 退回会保留修改痕迹
          </div>
        </div>
        <div className="page-actions">
          <span className="chip">
            共 <b>{periods.length}</b> 个周期
          </span>
        </div>
      </div>

      <div className="stack">
        {reports.map((r) => (
          <Card
            key={r.period}
            title={
              <span className="row" style={{ gap: 8 }}>
                {periodLabel(r.period)}
                <StatusPill status={r.status} />
                <span className="tag">v{r.version}</span>
              </span>
            }
            sub={
              r.submitted_at
                ? `提交：${userName(r.submitted_by)} · ${fmtDateTime(r.submitted_at)}${
                    r.reviewed_at ? ` · 审核：${userName(r.reviewed_by)} · ${fmtDateTime(r.reviewed_at)}` : ""
                  }`
                : "尚未提交"
            }
            actions={
              <Link href={`/reports/${r.period}`} className="btn btn-sm">
                打开报告 <IconArrow style={{ width: 12, height: 12 }} />
              </Link>
            }
          >
            <div className="grid grid-3" style={{ alignItems: "center" }}>
              <div>
                <div className="kpi-label">指标达标</div>
                <div className="row" style={{ gap: 8, marginTop: 2 }}>
                  <b className="tnum" style={{ fontSize: 17 }}>
                    {r.met}/{r.total}
                  </b>
                  <span className="faint" style={{ fontSize: 11.5 }}>
                    项达到目标值
                  </span>
                </div>
                <Meter value={r.total ? r.met / r.total : 0} />
              </div>
              <div>
                <div className="kpi-label">提交说明</div>
                <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.5 }}>
                  {r.submit_note ? r.submit_note.slice(0, 78) + (r.submit_note.length > 78 ? "…" : "") : <span className="faint">—</span>}
                </div>
              </div>
              <div>
                <div className="kpi-label">审核意见</div>
                <div style={{ fontSize: 12, color: "var(--ink-2)", marginTop: 3, lineHeight: 1.5 }}>
                  {r.review_note ? r.review_note.slice(0, 78) + (r.review_note.length > 78 ? "…" : "") : <span className="faint">—</span>}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="hint" style={{ marginTop: 14 }}>
        状态：{Object.values(STATUS_LABEL).join(" → ")} · 只有质控员可以提交，只有科主任可以审核或退回。
      </div>
    </main>
  );
}
