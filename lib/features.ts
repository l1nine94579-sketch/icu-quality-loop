/**
 * 派生层：把原始数据折算成患者级质控特征（patient_metrics）。
 *
 * 为什么单独一层：指标口径（SQL）只应该关心"这个患者是否满足条件"，
 * 不应该在 SQL 里重写一遍 KDIGO 与柏林定义。规则变化时只改这一层，
 * 指标口径与报告模板都不用动。
 */
import {
  evaluateAki,
  evaluateArds,
  type Criterion,
  type CreatininePoint,
  type UrinePoint,
} from "./engine";

export type RawObservation = { code: string; value: number; measuredAt: string };
export type RawEvent = { type: string; at: string; label?: string };

export type DerivedMetrics = {
  baselineCr: number | null;
  peakCr: number | null;
  akiStage: number;
  akiOnsetAt: string | null;
  pfRatio: number | null;
  ardsSeverity: string;
  peep: number | null;
  gcs: number | null;
  assessed24h: number;
  abxStarted: number;
  cultureBeforeAbx: number;
  dvtProphylaxis: number;
  ventStarted: number;
  stayHours: number;
  evidence: string;
};

const HOUR = 3600 * 1000;

function hoursBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / HOUR;
}

function nearest<T extends { at: string }>(points: T[], at: string, toleranceHours = 3): T | null {
  let best: T | null = null;
  let bestDiff = Infinity;
  for (const p of points) {
    const diff = Math.abs(new Date(p.at).getTime() - new Date(at).getTime()) / HOUR;
    if (diff < bestDiff && diff <= toleranceHours) {
      best = p;
      bestDiff = diff;
    }
  }
  return best;
}

export function derivePatient(input: {
  weightKg: number;
  admittedAt: string;
  dischargedAt: string | null;
  now?: Date;
  observations: RawObservation[];
  events: RawEvent[];
}): DerivedMetrics {
  const { weightKg, admittedAt, dischargedAt, observations, events } = input;
  const now = input.now ?? new Date();

  const creatinines: CreatininePoint[] = observations
    .filter((o) => o.code === "creatinine")
    .map((o) => ({ at: o.measuredAt, value: o.value }))
    .sort((a, b) => a.at.localeCompare(b.at));

  const urines: UrinePoint[] = observations
    .filter((o) => o.code === "urine_ml")
    .map((o) => ({ at: o.measuredAt, ml: o.value }))
    .sort((a, b) => a.at.localeCompare(b.at));

  const baselineCr = creatinines.length > 0 ? creatinines[0].value : null;
  const aki = evaluateAki({ baselineCr, creatinines, urines, weightKg });

  const pao2s = observations
    .filter((o) => o.code === "pao2")
    .map((o) => ({ at: o.measuredAt, value: o.value }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const fio2s = observations.filter((o) => o.code === "fio2").map((o) => ({ at: o.measuredAt, value: o.value }));
  const peeps = observations.filter((o) => o.code === "peep").map((o) => ({ at: o.measuredAt, value: o.value }));

  let ards = evaluateArds({ pao2: null, fio2: null, peep: null });
  let abgTrace: { pao2: number; fio2: number; peep: number | null; at: string; pf: number | null } | null = null;
  if (pao2s.length > 0) {
    const last = pao2s[pao2s.length - 1];
    const fio2 = nearest(fio2s, last.at, 2);
    const peep = nearest(peeps, last.at, 4);
    ards = evaluateArds({ pao2: last.value, fio2: fio2?.value ?? null, peep: peep?.value ?? null, at: last.at });
    abgTrace = {
      pao2: last.value,
      fio2: fio2?.value ?? 0,
      peep: peep?.value ?? null,
      at: last.at,
      pf: ards.pf,
    };
  }

  const gcsObs = observations.filter((o) => o.code === "gcs");
  const gcs = gcsObs.length ? gcsObs[gcsObs.length - 1].value : null;

  const assessment = events.find((e) => e.type === "assessment");
  const abx = events.filter((e) => e.type === "abx_start").sort((a, b) => a.at.localeCompare(b.at))[0];
  const culture = events
    .filter((e) => e.type === "culture")
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  const dvt = events.find((e) => e.type === "dvt_prophylaxis");
  const vent = events.find((e) => e.type === "vent_start");

  const end = dischargedAt ?? now.toISOString();
  const stayHours = Math.max(0, hoursBetween(admittedAt, end));

  const evidence = {
    creatinine: creatinines,
    baselineCr,
    peakCr: aki.peakCr,
    peakRatio: aki.peakRatio,
    aki: { stage: aki.stage, onsetAt: aki.onsetAt, criteria: aki.criteria, insufficient: aki.insufficient },
    urine: { points: urines.length, lowWindows: aki.criteria.filter((c) => c.source === "urine" && c.hit).map((c) => c.id) },
    abg: abgTrace,
    ards: { severity: ards.severity, pf: ards.pf, criteria: ards.criteria },
    events: {
      assessmentAt: assessment?.at ?? null,
      abxAt: abx?.at ?? null,
      cultureAt: culture?.at ?? null,
      dvtAt: dvt?.at ?? null,
      ventAt: vent?.at ?? null,
    },
    gcs,
  };

  return {
    baselineCr,
    peakCr: aki.peakCr,
    akiStage: aki.stage,
    akiOnsetAt: aki.onsetAt,
    pfRatio: ards.pf,
    ardsSeverity: ards.severity,
    peep: abgTrace?.peep ?? null,
    gcs,
    assessed24h: assessment && hoursBetween(admittedAt, assessment.at) <= 24 ? 1 : 0,
    abxStarted: abx ? 1 : 0,
    cultureBeforeAbx: abx && culture ? (new Date(culture.at).getTime() <= new Date(abx.at).getTime() ? 1 : 0) : 0,
    dvtProphylaxis: dvt && hoursBetween(admittedAt, dvt.at) <= 24 ? 1 : 0,
    ventStarted: vent ? 1 : 0,
    stayHours: Number(stayHours.toFixed(1)),
    evidence: JSON.stringify(evidence),
  };
}

export function parseEvidence<T = Record<string, unknown>>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export type Evidence = {
  creatinine: { at: string; value: number }[];
  baselineCr: number | null;
  peakCr: number | null;
  peakRatio: number | null;
  aki: { stage: number; onsetAt: string | null; criteria: Criterion[]; insufficient: boolean };
  urine: { points: number; lowWindows: string[] };
  abg: { pao2: number; fio2: number; peep: number | null; at: string; pf: number | null } | null;
  ards: { severity: string; pf: number | null; criteria: Criterion[] };
  events: Record<string, string | null>;
  gcs: number | null;
};
