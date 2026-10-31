import { all, one } from "./db";
import { listPeriods, getReport, type ReportStatus } from "./reports";

export type PatientListRow = {
  id: string;
  mrn: string;
  name: string;
  gender: string;
  age: number;
  bed: string;
  dx: string;
  admitted_at: string;
  discharged_at: string | null;
  status: string;
  outcome: string | null;
  apache_ii: number | null;
  period: string;
  aki_stage: number | null;
  ards_severity: string | null;
  pf_ratio: number | null;
  dvt_prophylaxis: number | null;
  culture_before_abx: number | null;
  assessed_24h: number | null;
  vent_started: number | null;
  stay_hours: number | null;
  computed_at: string | null;
};

export type PatientDetail = PatientListRow & {
  weight_kg: number;
  height_cm: number;
  allergy: string | null;
  abx_started: number | null;
  evidence: string | null;
};

export function currentPeriod(): string {
  const periods = listPeriods();
  return periods[0] ?? "2026-10";
}

export function listPatients(options: {
  period?: string;
  search?: string;
  aki?: string;
  ards?: string;
  status?: string;
} = {}): PatientListRow[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (options.period) {
    where.push("m.period = ?");
    params.push(options.period);
  }
  if (options.search) {
    where.push("(p.name LIKE ? OR p.mrn LIKE ? OR p.bed LIKE ?)");
    const q = `%${options.search}%`;
    params.push(q, q, q);
  }
  if (options.aki === "yes") where.push("m.aki_stage >= 1");
  if (options.aki === "no") where.push("(m.aki_stage = 0 OR m.aki_stage IS NULL)");
  if (options.ards === "yes") where.push("m.ards_severity IN ('mild','moderate','severe')");
  if (options.status === "in_icu") where.push("p.status = 'in_icu'");
  if (options.status === "discharged") where.push("p.status = 'discharged'");

  const sql = `SELECT p.*, m.period, m.aki_stage, m.ards_severity, m.pf_ratio, m.dvt_prophylaxis,
                      m.culture_before_abx, m.assessed_24h, m.vent_started, m.stay_hours, m.computed_at
                 FROM patients p
                 LEFT JOIN patient_metrics m ON m.patient_id = p.id
                ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
                ORDER BY p.admitted_at DESC`;
  return all<PatientListRow>(sql, ...params);
}

export function getPatient(id: string): PatientDetail | undefined {
  return one<PatientDetail>(
    `SELECT p.*, m.period, m.aki_stage, m.ards_severity, m.pf_ratio, m.dvt_prophylaxis,
            m.culture_before_abx, m.abx_started, m.assessed_24h, m.vent_started, m.stay_hours, m.computed_at, m.evidence
       FROM patients p LEFT JOIN patient_metrics m ON m.patient_id = p.id
      WHERE p.id = ?`,
    id,
  );
}

export type Observation = { id: number; code: string; value: number; unit: string; measured_at: string; source: string };
export type CareEvent = { id: number; type: string; label: string; at: string; by_user: string | null };

export function getObservations(patientId: string, code?: string): Observation[] {
  if (code) {
    return all<Observation>(
      "SELECT * FROM observations WHERE patient_id = ? AND code = ? ORDER BY measured_at",
      patientId,
      code,
    );
  }
  return all<Observation>("SELECT * FROM observations WHERE patient_id = ? ORDER BY measured_at", patientId);
}

export function getEvents(patientId: string): CareEvent[] {
  return all<CareEvent>("SELECT * FROM care_events WHERE patient_id = ? ORDER BY at", patientId);
}

export type DashboardData = {
  period: string;
  reportStatus: ReportStatus;
  inIcu: number;
  monthPatients: number;
  akiCount: number;
  ventCount: number;
  pendingReview: number;
  pendingDraft: number;
  agentRuns: number;
};

export function getDashboard(period: string): DashboardData {
  const report = getReport(period);
  const stats = one<{ total: number; aki: number; vent: number }>(
    `SELECT COUNT(*) total,
            SUM(CASE WHEN aki_stage >= 1 THEN 1 ELSE 0 END) aki,
            SUM(CASE WHEN vent_started = 1 THEN 1 ELSE 0 END) vent
       FROM patient_metrics WHERE period = ?`,
    period,
  );
  const inIcu = one<{ c: number }>("SELECT COUNT(*) c FROM patients WHERE status = 'in_icu'");
  const submitted = one<{ c: number }>("SELECT COUNT(*) c FROM qc_reports WHERE status = 'submitted'");
  const draft = one<{ c: number }>("SELECT COUNT(*) c FROM qc_reports WHERE status IN ('draft','returned')");
  const runs = one<{ c: number }>("SELECT COUNT(*) c FROM agent_runs");
  return {
    period,
    reportStatus: report.status,
    inIcu: Number(inIcu?.c ?? 0),
    monthPatients: Number(stats?.total ?? 0),
    akiCount: Number(stats?.aki ?? 0),
    ventCount: Number(stats?.vent ?? 0),
    pendingReview: Number(submitted?.c ?? 0),
    pendingDraft: Number(draft?.c ?? 0),
    agentRuns: Number(runs?.c ?? 0),
  };
}

export function listReports() {
  return all<{
    period: string;
    status: ReportStatus;
    version: number;
    submitted_at: string | null;
    submitted_by: string | null;
    reviewed_at: string | null;
    reviewed_by: string | null;
    review_note: string | null;
    submit_note: string | null;
    reported_at: string | null;
    total: number;
    met: number;
  }>(
    `SELECT r.*,
            (SELECT COUNT(*) FROM indicator_results ir WHERE ir.period = r.period) total,
            (SELECT COUNT(*) FROM indicator_results ir JOIN indicator_defs d ON d.code = ir.code
              WHERE ir.period = r.period AND ir.rate >= d.target) met
       FROM qc_reports r ORDER BY r.period DESC`,
  );
}

export function userName(id: string | null): string {
  if (!id) return "—";
  const row = one<{ name: string; title: string }>("SELECT name, title FROM users WHERE id = ?", id);
  return row ? `${row.name}` : id;
}

/** 侧边栏角标：只读查询，避免在 layout 渲染时写库 */
export function chromeCounts() {
  const count = (sql: string) => Number(one<{ c: number }>(sql)?.c ?? 0);
  return {
    pendingReview: count("SELECT COUNT(*) c FROM qc_reports WHERE status = 'submitted'"),
    pendingDraft: count("SELECT COUNT(*) c FROM qc_reports WHERE status IN ('draft','returned')"),
    periods: count("SELECT COUNT(DISTINCT period) c FROM patient_metrics"),
  };
}
