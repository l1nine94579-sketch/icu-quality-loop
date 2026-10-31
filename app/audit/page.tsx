import { ACTION_LABEL, listAudit } from "@/lib/audit";
import { ROLE_LABEL, type Role } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { Card, Pill } from "@/components/ui";

export const dynamic = "force-dynamic";

const TONE = (action: string) => {
  if (action.includes("returned")) return "bad";
  if (action.includes("approved") || action.includes("reported")) return "ok";
  if (action.includes("agent")) return "brand";
  return "neutral";
};

export default async function AuditPage() {
  const rows = listAudit({ limit: 120 });

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">审计日志</h1>
          <div className="page-sub">
            状态流转、数据修改、AI 会诊与草稿采纳全部留痕；每条记录保留变更前后的 JSON
          </div>
        </div>
        <div className="page-actions">
          <span className="chip">
            共 <b>{rows.length}</b> 条
          </span>
        </div>
      </div>

      <Card title="全量轨迹" sub="按时间倒序" bodyClass="tight">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>对象</th>
                <th>操作人</th>
                <th>说明</th>
                <th>变更</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{fmtDateTime(r.at)}</td>
                  <td>
                    <Pill tone={TONE(r.action)}>{ACTION_LABEL[r.action] ?? r.action}</Pill>
                  </td>
                  <td>
                    <span className="tag">{r.entity}</span>
                    <span className="mono" style={{ fontSize: 11, marginLeft: 6 }}>
                      {r.entity_id}
                    </span>
                  </td>
                  <td>
                    {r.actor_name}
                    <span className="muted" style={{ fontSize: 11 }}>
                      {" "}
                      · {ROLE_LABEL[(r.role as Role) ?? "nurse"]}
                    </span>
                  </td>
                  <td style={{ maxWidth: 380, color: "var(--ink-2)" }}>{r.note ?? "—"}</td>
                  <td>
                    {r.before_json || r.after_json ? (
                      <details className="disclosure" style={{ minWidth: 120 }}>
                        <summary style={{ padding: "3px 6px", fontSize: 11 }}>展开</summary>
                        <div style={{ padding: 6 }}>
                          {r.before_json ? (
                            <div className="mono" style={{ fontSize: 10, color: "var(--muted)" }}>
                              before: {r.before_json.slice(0, 160)}
                            </div>
                          ) : null}
                          {r.after_json ? (
                            <div className="mono" style={{ fontSize: 10, color: "var(--ink-2)" }}>
                              after: {r.after_json.slice(0, 200)}
                            </div>
                          ) : null}
                        </div>
                      </details>
                    ) : (
                      <span className="faint">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
