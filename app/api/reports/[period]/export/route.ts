import { currentUser } from "@/lib/session";
import { can } from "@/lib/permissions";
import { buildItems, getReport, listPeriods, STATUS_LABEL } from "@/lib/reports";
import { recordAudit } from "@/lib/audit";
import { fmtDateTime, pct } from "@/lib/format";

export const dynamic = "force-dynamic";

function cell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const DIRECTION_LABEL: Record<string, string> = {
  up: "越高越好",
  down: "越低越好",
  info: "仅参考",
};

export async function GET(_request: Request, { params }: { params: Promise<{ period: string }> }) {
  const user = await currentUser();
  if (!can(user.role, "report:view")) {
    return new Response("当前身份无导出权限", { status: 403 });
  }

  const { period } = await params;
  if (!listPeriods().includes(period)) {
    return new Response("报告不存在", { status: 404 });
  }

  const report = getReport(period);
  const items = buildItems(period);

  const lines: string[] = [];
  lines.push(["质控报告", period].map(cell).join(","));
  lines.push(["状态", STATUS_LABEL[report.status]].map(cell).join(","));
  lines.push(["版本", `v${report.version}`].map(cell).join(","));
  lines.push(["提交时间", report.submitted_at ? fmtDateTime(report.submitted_at) : "—"].map(cell).join(","));
  lines.push(
    ["口径冻结", report.snapshot ? "是（提交时冻结）" : "否（当前为实时数据）"].map(cell).join(","),
  );
  lines.push(["导出时间", fmtDateTime(new Date().toISOString())].map(cell).join(","));
  lines.push("");
  lines.push(
    ["指标编码", "指标名称", "分类", "分子", "分母", "结果", "目标", "方向", "环比(pp)", "是否达标", "口径说明"]
      .map(cell)
      .join(","),
  );

  for (const item of items) {
    lines.push(
      [
        item.def.code,
        item.def.name,
        item.def.category,
        item.numerator,
        item.denominator,
        pct(item.rate),
        pct(item.def.target, 0),
        DIRECTION_LABEL[item.direction] ?? item.direction,
        item.delta == null ? "—" : (item.delta * 100).toFixed(1),
        item.direction === "info" ? "参考值" : item.metTarget ? "达标" : "未达标",
        item.def.formula,
      ]
        .map(cell)
        .join(","),
    );
  }

  lines.push("");
  lines.push(["提交说明", report.submit_note ?? ""].map(cell).join(","));
  lines.push(["审核意见", report.review_note ?? ""].map(cell).join(","));
  lines.push(["导出人", `${user.name}（${user.title}）`].map(cell).join(","));

  recordAudit({
    actor: user,
    action: "report_exported",
    entity: "qc_report",
    entityId: period,
    after: { format: "csv", rows: items.length },
    note: `导出 ${period} 质控报告 CSV`,
  });

  const filename = `质控报告-${period}.csv`;
  const body = `\ufeff${lines.join("\r\n")}\r\n`;

  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="report-${period}.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "cache-control": "no-store",
    },
  });
}
