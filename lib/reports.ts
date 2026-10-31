import { all, one, run } from "./db";
import { INDICATORS, computeIndicator, listIndicatorDefs, type IndicatorDef } from "./indicators";
import { recordAudit } from "./audit";
import { STATUS_LABEL, STATUS_TONE, type ReportStatus } from "./roles";
import type { User } from "./session";

export { STATUS_LABEL, STATUS_TONE };
export type { ReportStatus };

export type ReportRow = {
  period: string;
  status: ReportStatus;
  version: number;
  submit_note: string | null;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  reported_at: string | null;
  snapshot: string | null;
};

export type ReportItem = {
  def: IndicatorDef;
  numerator: number;
  denominator: number;
  rate: number | null;
  previousRate: number | null;
  delta: number | null;
  metTarget: boolean;
  direction: "up" | "down" | "info";
  missing: number;
};

export type SnapshotItem = {
  code: string;
  name: string;
  numerator: number;
  denominator: number;
  rate: number | null;
  patientIds: string[];
};

export type Snapshot = {
  version: number;
  frozenAt: string;
  frozenBy: string;
  items: SnapshotItem[];
};

export function listPeriods(): string[] {
  return all<{ period: string }>("SELECT DISTINCT period FROM patient_metrics ORDER BY period DESC").map((r) => r.period);
}

export function getReport(period: string): ReportRow {
  const existing = one<ReportRow>("SELECT * FROM qc_reports WHERE period = ?", period);
  if (existing) return existing;
  run("INSERT INTO qc_reports (period, status, version) VALUES (?, 'draft', 1)", period);
  return one<ReportRow>("SELECT * FROM qc_reports WHERE period = ?", period)!;
}

export function previousPeriod(period: string): string | null {
  const [y, m] = period.split("-").map(Number);
  if (!y || !m) return null;
  const prev = new Date(Date.UTC(y, m - 2, 1));
  return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildItems(period: string, defs: IndicatorDef[] = listIndicatorDefs()): ReportItem[] {
  const prev = previousPeriod(period);
  const prevRates = new Map<string, number | null>();
  if (prev) {
    for (const def of defs) {
      const r = computeIndicator(def, prev);
      prevRates.set(def.code, r.rate);
    }
  }
  return defs.map((def) => {
    const r = computeIndicator(def, period);
    const previousRate = prevRates.get(def.code) ?? null;
    const direction = def.direction ?? "up";
    const metTarget =
      r.rate == null
        ? false
        : direction === "info"
          ? true
          : direction === "down"
            ? r.rate <= def.target
            : r.rate >= def.target;
    return {
      def,
      numerator: r.numerator,
      denominator: r.denominator,
      rate: r.rate,
      previousRate,
      delta: r.rate != null && previousRate != null ? r.rate - previousRate : null,
      metTarget,
      direction,
      missing: r.missing,
    };
  });
}

export type ValidationIssue = { code: string; message: string; blocking: boolean };

/** 提交前的硬校验：口径必须完整，异常波动必须解释——这是质控报告能"经得起复核"的前提。 */
export function validateSubmission(period: string, submitNote: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const items = buildItems(period);

  for (const item of items) {
    if (item.denominator === 0) {
      issues.push({ code: item.def.code, message: `${item.def.name}：分母为 0，无法计算`, blocking: true });
    }
    if (item.delta != null && Math.abs(item.delta) >= 0.15) {
      issues.push({
        code: item.def.code,
        message: `${item.def.name}：环比波动 ${(item.delta * 100).toFixed(1)} 个百分点，需在说明中解释`,
        blocking: submitNote.trim().length < 10,
      });
    }
  }
  const belowTarget = items.filter((i) => i.rate != null && !i.metTarget);
  if (belowTarget.length > 0 && submitNote.trim().length < 10) {
    issues.push({
      code: "overall",
      message: `${belowTarget.length} 项指标未达目标值，提交说明至少 10 字`,
      blocking: true,
    });
  }
  return issues;
}

export function saveResults(period: string, actor: User): void {
  const items = buildItems(period);
  for (const item of items) {
    run(
      `INSERT INTO indicator_results (period, code, numerator, denominator, rate, computed_at, computed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(period, code) DO UPDATE SET
         numerator = excluded.numerator,
         denominator = excluded.denominator,
         rate = excluded.rate,
         computed_at = excluded.computed_at,
         computed_by = excluded.computed_by`,
      period,
      item.def.code,
      item.numerator,
      item.denominator,
      item.rate,
      new Date().toISOString(),
      actor.id,
    );
  }
}

export function submitReport(period: string, actor: User, note: string): void {
  const report = getReport(period);
  if (report.status !== "draft" && report.status !== "returned") {
    throw new Error(`当前状态「${STATUS_LABEL[report.status]}」不可提交`);
  }
  const issues = validateSubmission(period, note);
  const blocking = issues.filter((i) => i.blocking);
  if (blocking.length > 0) {
    throw new Error(blocking.map((i) => i.message).join("；"));
  }

  const items = buildItems(period);
  const snapshot: Snapshot = {
    version: report.version,
    frozenAt: new Date().toISOString(),
    frozenBy: actor.name,
    items: items.map((item) => ({
      code: item.def.code,
      name: item.def.name,
      numerator: item.numerator,
      denominator: item.denominator,
      rate: item.rate,
      patientIds: [],
    })),
  };
  // 冻结口径：把当时的分子分母与患者 ID 一起写进快照
  for (const def of INDICATORS) {
    const r = computeIndicator(def, period);
    const target = snapshot.items.find((i) => i.code === def.code);
    if (target) target.patientIds = r.rows.filter((row) => Number(row.hit) === 1).map((row) => row.patient_id);
  }

  saveResults(period, actor);
  const now = new Date().toISOString();
  run(
    `UPDATE qc_reports SET status = 'submitted', submit_note = ?, submitted_by = ?, submitted_at = ?,
       snapshot = ?, review_note = NULL, reviewed_by = NULL, reviewed_at = NULL
     WHERE period = ?`,
    note,
    actor.id,
    now,
    JSON.stringify(snapshot),
    period,
  );
  recordAudit({
    actor,
    action: "report_submitted",
    entity: "qc_report",
    entityId: period,
    before: { status: report.status, version: report.version },
    after: { status: "submitted", version: report.version },
    note: note || undefined,
  });
}

export function approveReport(period: string, actor: User, note: string): void {
  const report = getReport(period);
  if (report.status !== "submitted") throw new Error("只有待审核的报告可以通过");
  run(
    `UPDATE qc_reports SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE period = ?`,
    actor.id,
    new Date().toISOString(),
    note,
    period,
  );
  recordAudit({
    actor,
    action: "report_approved",
    entity: "qc_report",
    entityId: period,
    before: { status: "submitted" },
    after: { status: "approved" },
    note: note || undefined,
  });
}

export function returnReport(period: string, actor: User, note: string): void {
  const report = getReport(period);
  if (report.status !== "submitted") throw new Error("只有待审核的报告可以退回");
  if (note.trim().length < 6) throw new Error("退回必须写明原因（至少 6 字）");
  run(
    `UPDATE qc_reports SET status = 'returned', reviewed_by = ?, reviewed_at = ?, review_note = ?, version = version + 1
     WHERE period = ?`,
    actor.id,
    new Date().toISOString(),
    note,
    period,
  );
  recordAudit({
    actor,
    action: "report_returned",
    entity: "qc_report",
    entityId: period,
    before: { status: "submitted", version: report.version },
    after: { status: "returned", version: report.version + 1 },
    note,
  });
}

export function reportToCenter(period: string, actor: User): void {
  const report = getReport(period);
  if (report.status !== "approved") throw new Error("必须先审核通过才能上报");
  run(
    "UPDATE qc_reports SET status = 'reported', reported_at = ? WHERE period = ?",
    new Date().toISOString(),
    period,
  );
  recordAudit({
    actor,
    action: "report_reported",
    entity: "qc_report",
    entityId: period,
    before: { status: "approved" },
    after: { status: "reported" },
    note: "上报至省级重症质控中心（演示为本地模拟）",
  });
}

export function recomputeReport(period: string, actor: User): void {
  const report = getReport(period);
  const before = buildItems(period).map((i) => ({ code: i.def.code, rate: i.rate }));
  saveResults(period, actor);
  const after = buildItems(period).map((i) => ({ code: i.def.code, rate: i.rate }));
  recordAudit({
    actor,
    action: "report_recomputed",
    entity: "qc_report",
    entityId: period,
    before: { status: report.status, rates: before },
    after: { rates: after },
    note: "按当前口径重新取数（不改变已冻结快照）",
  });
}

export type SnapshotDiff = {
  code: string;
  name: string;
  frozen: number | null;
  live: number | null;
  changed: boolean;
};

export function snapshotDiff(period: string): SnapshotDiff[] {
  const report = getReport(period);
  if (!report.snapshot) return [];
  const snapshot = JSON.parse(report.snapshot) as Snapshot;
  return snapshot.items.map((item) => {
    const def = listIndicatorDefs().find((d) => d.code === item.code);
    const live = def ? computeIndicator(def, period).rate : null;
    return {
      code: item.code,
      name: item.name,
      frozen: item.rate,
      live,
      changed: item.rate != null && live != null && Math.abs(item.rate - live) > 0.0005,
    };
  });
}

export function readSnapshot(period: string): Snapshot | null {
  const report = getReport(period);
  if (!report.snapshot) return null;
  try {
    return JSON.parse(report.snapshot) as Snapshot;
  } catch {
    return null;
  }
}

/** 指标下钻：返回命中与未命中的患者明细 */
export function indicatorDrilldown(code: string, period: string) {
  const def = listIndicatorDefs().find((d) => d.code === code);
  if (!def) return null;
  const result = computeIndicator(def, period);
  const rows = all<{ id: string; name: string; mrn: string; bed: string; dx: string; admitted_at: string; discharged_at: string }>(
    `SELECT p.id, p.name, p.mrn, p.bed, p.dx, p.admitted_at, p.discharged_at
       FROM patients p JOIN patient_metrics m ON m.patient_id = p.id
      WHERE m.period = ? ORDER BY p.bed`,
    period,
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    def,
    result,
    hits: result.rows
      .filter((r) => Number(r.hit) === 1)
      .map((r) => ({ ...byId.get(r.patient_id), evidence: r.evidence })),
    misses: result.rows
      .filter((r) => Number(r.eligible) === 1 && Number(r.hit) === 0)
      .map((r) => ({ ...byId.get(r.patient_id), evidence: r.evidence })),
  };
}
