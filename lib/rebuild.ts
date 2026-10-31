import { all, run, tx } from "./db";
import { derivePatient } from "./features";

export type RebuildResult = { count: number; period: string | null; at: string };

/**
 * 从原始数据重算派生层。
 * 这是唯一允许"改口径历史"的入口：只重算 patient_metrics，指标结果与报告快照另行重取，
 * 已冻结的报告不会被悄悄改写。
 */
export function rebuildMetrics(patientId?: string): RebuildResult {
  const patients = patientId
    ? all<{ id: string; weight_kg: number; admitted_at: string; discharged_at: string | null; period: string }>(
        `SELECT p.id, p.weight_kg, p.admitted_at, p.discharged_at, substr(p.admitted_at, 1, 7) AS period
           FROM patients p WHERE p.id = ?`,
        patientId,
      )
    : all<{ id: string; weight_kg: number; admitted_at: string; discharged_at: string | null; period: string }>(
        `SELECT p.id, p.weight_kg, p.admitted_at, p.discharged_at, substr(p.admitted_at, 1, 7) AS period
           FROM patients p`,
      );

  const now = new Date();
  let count = 0;
  tx(() => {
    for (const p of patients) {
      const observations = all<{ code: string; value: number; measured_at: string }>(
        "SELECT code, value, measured_at FROM observations WHERE patient_id = ? ORDER BY measured_at",
        p.id,
      );
      const events = all<{ type: string; at: string }>(
        "SELECT type, at FROM care_events WHERE patient_id = ? ORDER BY at",
        p.id,
      );
      const m = derivePatient({
        weightKg: p.weight_kg,
        admittedAt: p.admitted_at,
        dischargedAt: p.discharged_at,
        now,
        observations: observations.map((o) => ({ code: o.code, value: o.value, measuredAt: o.measured_at })),
        events,
      });
      run(
        `INSERT INTO patient_metrics
           (patient_id, period, baseline_cr, peak_cr, aki_stage, aki_onset_at, pf_ratio, ards_severity, peep, gcs,
            assessed_24h, abx_started, culture_before_abx, dvt_prophylaxis, vent_started, stay_hours, evidence, computed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(patient_id) DO UPDATE SET
           period = excluded.period, baseline_cr = excluded.baseline_cr, peak_cr = excluded.peak_cr,
           aki_stage = excluded.aki_stage, aki_onset_at = excluded.aki_onset_at, pf_ratio = excluded.pf_ratio,
           ards_severity = excluded.ards_severity, peep = excluded.peep, gcs = excluded.gcs,
           assessed_24h = excluded.assessed_24h, abx_started = excluded.abx_started,
           culture_before_abx = excluded.culture_before_abx, dvt_prophylaxis = excluded.dvt_prophylaxis,
           vent_started = excluded.vent_started, stay_hours = excluded.stay_hours,
           evidence = excluded.evidence, computed_at = excluded.computed_at`,
        p.id, p.period, m.baselineCr, m.peakCr, m.akiStage, m.akiOnsetAt, m.pfRatio, m.ardsSeverity,
        m.peep, m.gcs, m.assessed24h, m.abxStarted, m.cultureBeforeAbx, m.dvtProphylaxis, m.ventStarted,
        m.stayHours, m.evidence, now.toISOString(),
      );
      count += 1;
    }
  });
  return { count, period: patients[0]?.period ?? null, at: now.toISOString() };
}
