import { all, one } from "./db";

export type IndicatorDef = {
  code: string;
  name: string;
  category: string;
  unit: string;
  target: number;
  /** up = 越高越好；down = 越低越好；info = 仅作参考，不设达标线 */
  direction?: "up" | "down" | "info";
  formula: string;
  rationale: string;
  sql: string;
  owner: string;
  sort: number;
};

export type IndicatorRow = {
  patient_id: string;
  eligible: number;
  hit: number;
  evidence: string | null;
};

export type IndicatorResult = {
  numerator: number;
  denominator: number;
  rate: number | null;
  rows: IndicatorRow[];
  missing: number;
};

/**
 * 指标口径集中在这里：一条指标 = 一段可审阅的 SQL + 一句人话公式 + 目标值。
 * 分子/分母都在患者粒度产出，页面可以逐级下钻到具体患者与原始证据。
 */
export const INDICATORS: IndicatorDef[] = [
  {
    code: "AKI_RATE",
    name: "AKI 发生率",
    category: "过程指标",
    unit: "%",
    target: 0.35,
    direction: "down",
    formula: "AKI 患者数 ÷ 同期 ICU 收治患者数 × 100%",
    rationale: "KDIGO 2012 肌酐与尿量分期，任一维度达 1 期即计入；基线取入科后首次肌酐。",
    sql: `SELECT m.patient_id,
       1 AS eligible,
       CASE WHEN m.aki_stage >= 1 THEN 1 ELSE 0 END AS hit,
       json_object('akiStage', m.aki_stage,
                   'baselineCr', m.baseline_cr,
                   'peakCr', m.peak_cr,
                   'onsetAt', m.aki_onset_at) AS evidence
  FROM patient_metrics m
 WHERE m.period = ?`,
    owner: "科室质控员",
    sort: 1,
  },
  {
    code: "AKI_48H",
    name: "AKI 48 小时内检测及时率",
    category: "过程指标",
    unit: "%",
    target: 0.9,
    formula: "48h 内完成过肌酐检测的 AKI 患者 ÷ AKI 患者总数 × 100%",
    rationale: "分母只纳入 AKI 患者；以入科时间与首份肌酐的关系判断是否在 48h 内完成检测。",
    sql: `SELECT m.patient_id,
       CASE WHEN m.aki_stage >= 1 THEN 1 ELSE 0 END AS eligible,
       CASE WHEN m.aki_stage >= 1 AND EXISTS (
              SELECT 1 FROM observations o
               WHERE o.patient_id = m.patient_id
                 AND o.code = 'creatinine'
                 AND (julianday(o.measured_at) - julianday(p.admitted_at)) * 24 <= 48
            ) THEN 1 ELSE 0 END AS hit,
       json_object('akiStage', m.aki_stage,
                   'onsetAt', m.aki_onset_at,
                   'admittedAt', p.admitted_at) AS evidence
  FROM patient_metrics m
  JOIN patients p ON p.id = m.patient_id
 WHERE m.period = ?`,
    owner: "ICU 医生",
    sort: 2,
  },
  {
    code: "ARDS_PF",
    name: "ARDS 严重度分层完成率",
    category: "过程指标",
    unit: "%",
    target: 0.85,
    formula: "完成 P/F 分层的机械通气患者 ÷ 机械通气患者数 × 100%",
    rationale: "Berlin 定义需 PEEP ≥ 5 cmH₂O；PaO₂ 或 FiO₂ 缺失时标记数据不足，不计入完成。",
    sql: `SELECT m.patient_id,
       CASE WHEN m.vent_started = 1 THEN 1 ELSE 0 END AS eligible,
       CASE WHEN m.vent_started = 1 AND m.pf_ratio IS NOT NULL THEN 1 ELSE 0 END AS hit,
       json_object('ardsSeverity', m.ards_severity, 'pfRatio', m.pf_ratio, 'peep', m.peep) AS evidence
  FROM patient_metrics m
 WHERE m.period = ?`,
    owner: "ICU 医生",
    sort: 3,
  },
  {
    code: "DVT_PRO",
    name: "DVT 预防措施落实率",
    category: "过程指标",
    unit: "%",
    target: 0.9,
    formula: "入科 24h 内落实 DVT 预防的患者 ÷ 同期收治患者数 × 100%",
    rationale: "预防措施来自护理事件（药物或机械预防），按事件时间与入科时间比较。",
    sql: `SELECT m.patient_id,
       1 AS eligible,
       CASE WHEN m.dvt_prophylaxis = 1 THEN 1 ELSE 0 END AS hit,
       json_object('dvtProphylaxis', m.dvt_prophylaxis) AS evidence
  FROM patient_metrics m
 WHERE m.period = ?`,
    owner: "ICU 护士",
    sort: 4,
  },
  {
    code: "CULTURE",
    name: "抗菌药物使用前病原学送检率",
    category: "过程指标",
    unit: "%",
    target: 0.8,
    formula: "用药前完成病原学送检的患者 ÷ 使用抗菌药物的患者数 × 100%",
    rationale: '送检事件时间 ≤ 首次抗菌药给药时间即视为"用药前送检"；同一患者多次用药取首次。',
    sql: `SELECT m.patient_id,
       CASE WHEN m.abx_started = 1 THEN 1 ELSE 0 END AS eligible,
       CASE WHEN m.abx_started = 1 AND m.culture_before_abx = 1 THEN 1 ELSE 0 END AS hit,
       json_object('abxStarted', m.abx_started,
                   'cultureBeforeAbx', m.culture_before_abx) AS evidence
  FROM patient_metrics m
 WHERE m.period = ?`,
    owner: "科室质控员",
    sort: 5,
  },
  {
    code: "EARLY_ASSESS",
    name: "入科 24h 内早期评估完成率",
    category: "过程指标",
    unit: "%",
    target: 0.95,
    formula: "24h 内完成早期评估的患者数 ÷ 同期收治患者数 × 100%",
    rationale: "早期评估包含 GCS/APACHEⅡ 等结构化记录，以护理事件落库时间为准。",
    sql: `SELECT m.patient_id,
       1 AS eligible,
       CASE WHEN m.assessed_24h = 1 THEN 1 ELSE 0 END AS hit,
       json_object('assessed24h', m.assessed_24h) AS evidence
  FROM patient_metrics m
 WHERE m.period = ?`,
    owner: "ICU 护士",
    sort: 6,
  },
  {
    code: "APACHE_HIGH",
    name: "APACHEⅡ ≥ 15 分收治占比",
    category: "结构指标",
    unit: "%",
    target: 0.5,
    direction: "info",
    formula: "APACHEⅡ ≥ 15 分的患者数 ÷ 同期收治患者数 × 100%",
    rationale: "反映收治患者病情危重程度，用于床位与人力配置评估。",
    sql: `SELECT m.patient_id,
       1 AS eligible,
       CASE WHEN p.apache_ii >= 15 THEN 1 ELSE 0 END AS hit,
       json_object('apacheII', p.apache_ii) AS evidence
  FROM patient_metrics m
  JOIN patients p ON p.id = m.patient_id
 WHERE m.period = ?`,
    owner: "科主任",
    sort: 7,
  },
];

export function computeIndicator(def: IndicatorDef, period: string): IndicatorResult {
  const rows = all<IndicatorRow>(def.sql, period);
  const numerator = rows.reduce((sum, r) => sum + Number(r.hit ?? 0), 0);
  const denominator = rows.reduce((sum, r) => sum + Number(r.eligible ?? 0), 0);
  return {
    numerator,
    denominator,
    rate: denominator > 0 ? numerator / denominator : null,
    rows,
    missing: rows.filter((r) => Number(r.eligible) === 1 && Number(r.hit) === 0).length,
  };
}

export function listIndicatorDefs(): IndicatorDef[] {
  return all<IndicatorDef>("SELECT * FROM indicator_defs ORDER BY sort");
}

export function getIndicatorDef(code: string): IndicatorDef | undefined {
  return one<IndicatorDef>("SELECT * FROM indicator_defs WHERE code = ?", code);
}
