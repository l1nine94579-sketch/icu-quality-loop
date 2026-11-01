/**
 * 数据补录：护士/质控员在患者维度补一条检验或护理事件，
 * 立刻重算该患者的派生指标，并把「影响了哪项质控指标」算给用户看。
 *
 * 这条链路是作品里唯一允许"改历史数据"的入口，所以三件事必须一起做：
 *   1) 权限断言（patient:edit）
 *   2) 重算派生层（rebuildMetrics）
 *   3) 审计留痕（before/after 的指标结果）
 */
import { one, run } from "./db";
import { assertCan } from "./permissions";
import { recordAudit } from "./audit";
import { rebuildMetrics } from "./rebuild";
import { buildItems, getReport } from "./reports";
import { pct } from "./format";
import type { User } from "./roles";

export const OBS_CODES = [
  { code: "creatinine", label: "血肌酐", unit: "mg/dL", min: 0.1, max: 20, step: 0.01 },
  { code: "urine_ml", label: "小时尿量", unit: "mL/h", min: 0, max: 2000, step: 1 },
  { code: "pao2", label: "PaO₂", unit: "mmHg", min: 20, max: 600, step: 1 },
  { code: "fio2", label: "FiO₂", unit: "ratio", min: 0.21, max: 1, step: 0.01 },
  { code: "peep", label: "PEEP", unit: "cmH₂O", min: 0, max: 30, step: 1 },
  { code: "gcs", label: "GCS", unit: "分", min: 3, max: 15, step: 1 },
] as const;

export const EVENT_TYPES = [
  { type: "dvt_prophylaxis", label: "DVT 预防（药物 / 机械）" },
  { type: "culture", label: "病原学送检" },
  { type: "abx_start", label: "抗菌药物首剂" },
  { type: "assessment", label: "入科早期评估" },
  { type: "vent_start", label: "气管插管上机" },
] as const;

export type IndicatorChange = {
  code: string;
  name: string;
  before: number | null;
  after: number | null;
};

export type EntryResult = {
  period: string;
  reportStatus: string;
  frozen: boolean;
  patientName: string;
  detail: string;
  changes: IndicatorChange[];
};

type PatientRow = {
  id: string;
  name: string;
  admitted_at: string;
  discharged_at: string | null;
};

function loadPatient(patientId: string): PatientRow {
  const patient = one<PatientRow>(
    "SELECT id, name, admitted_at, discharged_at FROM patients WHERE id = ?",
    patientId,
  );
  if (!patient) throw new Error("患者不存在");
  return patient;
}

function parseTime(raw: unknown, fallback: string): string {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) throw new Error("时间格式不正确");
  return date.toISOString();
}

/** 补录前后各算一次指标，只把真正变化的项返回给界面 */
function diffIndicators(period: string, before: ReturnType<typeof buildItems>): IndicatorChange[] {
  const after = buildItems(period);
  const byCode = new Map(before.map((i) => [i.def.code, i.rate]));
  return after
    .map((item) => ({
      code: item.def.code,
      name: item.def.name,
      before: byCode.get(item.def.code) ?? null,
      after: item.rate,
    }))
    .filter((c) => c.before !== c.after);
}

function reportState(period: string) {
  const report = getReport(period);
  return {
    period,
    reportStatus: report.status,
    frozen: Boolean(report.snapshot),
  };
}

export function addObservation(input: {
  patientId: string;
  code: string;
  value: number;
  measuredAt?: string;
  actor: User;
}): EntryResult {
  assertCan(input.actor, "patient:edit");
  const patient = loadPatient(input.patientId);
  const meta = OBS_CODES.find((c) => c.code === input.code);
  if (!meta) throw new Error("不支持的检验项目");

  const value = Number(input.value);
  if (!Number.isFinite(value)) throw new Error("数值必须是数字");
  if (value < meta.min || value > meta.max) {
    throw new Error(`${meta.label} 应在 ${meta.min} ~ ${meta.max} ${meta.unit} 之间`);
  }

  const fallback = new Date(new Date(patient.admitted_at).getTime() + 12 * 3600 * 1000).toISOString();
  const measuredAt = parseTime(input.measuredAt, fallback);
  if (new Date(measuredAt).getTime() > Date.now() + 24 * 3600 * 1000) {
    throw new Error("测量时间不能晚于明天");
  }

  const period = patient.admitted_at.slice(0, 7);
  const before = buildItems(period);

  run(
    "INSERT INTO observations (patient_id, code, value, unit, measured_at, source, flag) VALUES (?,?,?,?,?,?,?)",
    patient.id,
    meta.code,
    value,
    meta.unit,
    measuredAt,
    "人工补录",
    null,
  );
  rebuildMetrics(patient.id);

  const changes = diffIndicators(period, before);
  const state = reportState(period);

  recordAudit({
    actor: input.actor,
    action: "observation_added",
    entity: "patient",
    entityId: patient.id,
    before: { code: meta.code, rates: Object.fromEntries(before.map((i) => [i.def.code, i.rate])) },
    after: { value, unit: meta.unit, measuredAt, changes },
    note: `补录${meta.label} ${value} ${meta.unit}`,
  });

  return {
    ...state,
    patientName: patient.name,
    detail: `${meta.label} ${value} ${meta.unit}`,
    changes,
  };
}

export function addCareEvent(input: {
  patientId: string;
  type: string;
  at?: string;
  label?: string;
  actor: User;
}): EntryResult {
  assertCan(input.actor, "patient:edit");
  const patient = loadPatient(input.patientId);
  const meta = EVENT_TYPES.find((t) => t.type === input.type);
  if (!meta) throw new Error("不支持的事件类型");

  const fallback = new Date(new Date(patient.admitted_at).getTime() + 2 * 3600 * 1000).toISOString();
  const at = parseTime(input.at, fallback);
  if (new Date(at).getTime() > Date.now() + 24 * 3600 * 1000) {
    throw new Error("事件时间不能晚于明天");
  }

  const period = patient.admitted_at.slice(0, 7);
  const before = buildItems(period);
  const label = input.label?.trim() || meta.label;

  run(
    "INSERT INTO care_events (patient_id, type, label, detail, at, by_user) VALUES (?,?,?,?,?,?)",
    patient.id,
    meta.type,
    label,
    "由临床界面补录",
    at,
    input.actor.id,
  );
  rebuildMetrics(patient.id);

  const changes = diffIndicators(period, before);
  const state = reportState(period);

  recordAudit({
    actor: input.actor,
    action: "event_added",
    entity: "patient",
    entityId: patient.id,
    before: { type: meta.type, rates: Object.fromEntries(before.map((i) => [i.def.code, i.rate])) },
    after: { label, at, changes },
    note: `补录护理事件：${label}`,
  });

  return {
    ...state,
    patientName: patient.name,
    detail: label,
    changes,
  };
}

/** 把补录结果翻译成一句人话，直接放进 flash */
export function entryMessage(result: EntryResult, verb = "补录"): string {
  const changeText = result.changes.length
    ? `影响指标：${result.changes
        .map((c) => `${c.name} ${pct(c.before)} → ${pct(c.after)}`)
        .join("；")}`
    : "本月指标暂未变化（该患者不改变分子分母）";
  const frozenText = result.frozen ? `；${result.period} 报告已冻结，差异可在报告页对比` : "";
  return `已${verb}${result.detail}，${changeText}${frozenText}`;
}
