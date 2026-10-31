/**
 * 临床规则引擎（纯函数，无 IO）
 *
 * 只做一件事：把原始检验/护理数据折算成可解释的临床结论。
 * 每个结论都带 criteria（命中与未命中的判据）和 evidence（原始取值），
 * 上层界面与 AI Agent 都直接消费这份结构，保证"人看到的"和"机器说的"是同一条依据。
 *
 * 规则来源：
 *  - AKI：KDIGO 2012 肌酐与尿量分期
 *  - ARDS：柏林定义（P/F 比值 + PEEP ≥ 5 cmH₂O）
 * 实现上刻意不做"缺省推定"：数据不足时返回 insufficient，而不是猜一个分级。
 */

export type CreatininePoint = { at: string; value: number };
export type UrinePoint = { at: string; ml: number };

export type Criterion = {
  id: string;
  label: string;
  observed: string;
  threshold: string;
  hit: boolean;
  stage: number;
  source: "creatinine" | "urine" | "rrt";
};

export type AkiInput = {
  baselineCr: number | null;
  creatinines: CreatininePoint[];
  urines: UrinePoint[];
  weightKg: number;
  rrt?: boolean;
};

export type AkiResult = {
  stage: number;
  onsetAt: string | null;
  baselineCr: number | null;
  peakCr: number | null;
  peakRatio: number | null;
  criteria: Criterion[];
  insufficient: boolean;
};

export type ArdsInput = {
  pao2: number | null;
  fio2: number | null;
  peep: number | null;
  at?: string | null;
};

export type ArdsResult = {
  pf: number | null;
  severity: "none" | "mild" | "moderate" | "severe" | "insufficient";
  criteria: Criterion[];
};

const num = (v: number, digits = 2): string => {
  if (!Number.isFinite(v)) return "—";
  return Number(v.toFixed(digits)).toString();
};

/** 肌酐较基线的最大倍率（用于趋势与证据展示） */
export function creatinineRatioSeries(
  baselineCr: number | null,
  creatinines: CreatininePoint[],
): { at: string; value: number; ratio: number | null }[] {
  return creatinines.map((p) => ({
    at: p.at,
    value: p.value,
    ratio: baselineCr && baselineCr > 0 ? p.value / baselineCr : null,
  }));
}

/**
 * 尿量窗口：给定持续时长与阈值速率，找出是否连续满足低尿量。
 * 入参 urine 必须是按小时聚合的尿量（ml/h），窗口内平均值低于阈值即命中。
 */
function urineWindow(
  urines: UrinePoint[],
  weightKg: number,
  hours: number,
  threshold: number,
): { hit: boolean; observed: string; startAt: string | null } {
  if (urines.length < hours || weightKg <= 0) {
    return { hit: false, observed: "尿量记录不足，无法判定", startAt: null };
  }
  const sorted = [...urines].sort((a, b) => a.at.localeCompare(b.at));
  for (let i = 0; i + hours <= sorted.length; i += 1) {
    const slice = sorted.slice(i, i + hours);
    const total = slice.reduce((sum, p) => sum + p.ml, 0);
    const rate = total / (hours * weightKg);
    if (rate < threshold) {
      return {
        hit: true,
        observed: `${hours}h 平均 ${num(rate)} mL/kg/h（共 ${num(total, 0)} mL）`,
        startAt: slice[0].at,
      };
    }
  }
  return {
    hit: false,
    observed: `各 ${hours}h 窗口均 ≥ ${threshold} mL/kg/h`,
    startAt: null,
  };
}

/** KDIGO 2012 AKI 分期 */
export function evaluateAki(input: AkiInput): AkiResult {
  const { baselineCr, creatinines, urines, weightKg, rrt } = input;
  const criteria: Criterion[] = [];
  const sorted = [...creatinines].sort((a, b) => a.at.localeCompare(b.at));

  if (!baselineCr || sorted.length === 0) {
    return {
      stage: 0,
      onsetAt: null,
      baselineCr: baselineCr ?? null,
      peakCr: null,
      peakRatio: null,
      criteria: [],
      insufficient: true,
    };
  }

  let stage = 0;
  let onsetAt: string | null = null;
  let peakCr = sorted[0].value;
  let peakRatio = 1;
  let worst: { stage: number; at: string; criteria: Criterion[] } | null = null;
  // 记录倍率最高那一次的完整判据（含未命中项），用于界面展示"为什么没判上"
  let peakPointCriteria: Criterion[] = [];

  for (const point of sorted) {
    const ratio = point.value / baselineCr;
    if (ratio > peakRatio) {
      peakRatio = ratio;
      peakCr = point.value;
    }
    // 48h 内绝对升高：与 48h 窗口内最低值比较
    const windowStart = new Date(new Date(point.at).getTime() - 48 * 3600 * 1000).toISOString();
    const windowValues = sorted
      .filter((p) => p.at >= windowStart && p.at <= point.at)
      .map((p) => p.value);
    const delta = point.value - Math.min(...(windowValues.length ? windowValues : [point.value]));

    const pointCriteria: Criterion[] = [
      {
        id: "cr_3x",
        label: "肌酐 ≥ 基线 3.0 倍",
        observed: `${num(point.value)} / ${num(baselineCr)} = ${num(ratio)}×`,
        threshold: "≥ 3.0×",
        hit: ratio >= 3,
        stage: 3,
        source: "creatinine",
      },
      {
        id: "cr_abs_4",
        label: "肌酐绝对值 ≥ 4.0 mg/dL",
        observed: `${num(point.value)} mg/dL`,
        threshold: "≥ 4.0 mg/dL",
        hit: point.value >= 4,
        stage: 3,
        source: "creatinine",
      },
      {
        id: "cr_2x",
        label: "肌酐 ≥ 基线 2.0 倍",
        observed: `${num(point.value)} / ${num(baselineCr)} = ${num(ratio)}×`,
        threshold: "≥ 2.0×",
        hit: ratio >= 2,
        stage: 2,
        source: "creatinine",
      },
      {
        id: "cr_1_5x",
        label: "肌酐 ≥ 基线 1.5 倍",
        observed: `${num(point.value)} / ${num(baselineCr)} = ${num(ratio)}×`,
        threshold: "≥ 1.5×",
        hit: ratio >= 1.5,
        stage: 1,
        source: "creatinine",
      },
      {
        id: "cr_delta_48h",
        label: "48h 内肌酐绝对升高 ≥ 0.3 mg/dL",
        observed: `+${num(delta)} mg/dL`,
        threshold: "≥ 0.3 mg/dL",
        hit: delta >= 0.3,
        stage: 1,
        source: "creatinine",
      },
    ];

    const hits = pointCriteria.filter((c) => c.hit);
    const pointStage = hits.reduce((max, c) => Math.max(max, c.stage), 0);
    if (pointStage > 0 && onsetAt === null) onsetAt = point.at;
    if (ratio >= peakRatio - 1e-9 || peakPointCriteria.length === 0) {
      peakPointCriteria = pointCriteria;
    }
    if (pointStage > 0 && (!worst || pointStage > worst.stage)) {
      worst = { stage: pointStage, at: point.at, criteria: hits };
    }
  }

  if (worst) {
    stage = worst.stage;
    criteria.push(...worst.criteria);
  } else {
    criteria.push(...peakPointCriteria);
  }

  const urineStage3 = urineWindow(urines, weightKg, 24, 0.3);
  const urineStage2 = urineWindow(urines, weightKg, 12, 0.5);
  const urineStage1 = urineWindow(urines, weightKg, 6, 0.5);

  criteria.push(
    {
      id: "urine_24h",
      label: "尿量 < 0.3 mL/kg/h 持续 ≥ 24h",
      observed: urineStage3.observed,
      threshold: "< 0.3 mL/kg/h × 24h",
      hit: urineStage3.hit,
      stage: 3,
      source: "urine",
    },
    {
      id: "urine_12h",
      label: "尿量 < 0.5 mL/kg/h 持续 ≥ 12h",
      observed: urineStage2.observed,
      threshold: "< 0.5 mL/kg/h × 12h",
      hit: urineStage2.hit,
      stage: 2,
      source: "urine",
    },
    {
      id: "urine_6h",
      label: "尿量 < 0.5 mL/kg/h 持续 ≥ 6h",
      observed: urineStage1.observed,
      threshold: "< 0.5 mL/kg/h × 6h",
      hit: urineStage1.hit,
      stage: 1,
      source: "urine",
    },
  );

  for (const c of criteria) {
    if (c.source === "urine" && c.hit) {
      if (c.stage > stage) stage = c.stage;
      if (onsetAt === null) onsetAt = c.id === "urine_24h" ? urineStage3.startAt : c.id === "urine_12h" ? urineStage2.startAt : urineStage1.startAt;
    }
  }

  if (rrt) {
    criteria.push({
      id: "rrt",
      label: "已启动肾脏替代治疗（RRT）",
      observed: "CRRT 运行中",
      threshold: "启动即 3 期",
      hit: true,
      stage: 3,
      source: "rrt",
    });
    stage = 3;
  }

  return {
    stage,
    onsetAt,
    baselineCr,
    peakCr,
    peakRatio: Number(peakRatio.toFixed(2)),
    criteria,
    insufficient: false,
  };
}

/** 柏林定义 ARDS 分度；数据缺失时明确返回 insufficient，不做推定 */
export function evaluateArds(input: ArdsInput): ArdsResult {
  const { pao2, fio2, peep } = input;
  const criteria: Criterion[] = [];

  if (pao2 == null || fio2 == null || fio2 <= 0) {
    return {
      pf: null,
      severity: "insufficient",
      criteria: [
        {
          id: "pf_missing",
          label: "PaO₂ 或 FiO₂ 缺失",
          observed: `PaO₂=${pao2 ?? "—"}，FiO₂=${fio2 ?? "—"}`,
          threshold: "两者均需存在",
          hit: false,
          stage: 0,
          source: "creatinine",
        },
      ],
    };
  }

  const pf = pao2 / fio2;
  criteria.push(
    {
      id: "peep",
      label: "PEEP ≥ 5 cmH₂O（Berlin 前提）",
      observed: peep == null ? "未记录 PEEP" : `${num(peep)} cmH₂O`,
      threshold: "≥ 5 cmH₂O",
      hit: peep != null && peep >= 5,
      stage: 0,
      source: "creatinine",
    },
    {
      id: "pf_300",
      label: "P/F ≤ 300 mmHg",
      observed: `${num(pao2)} / ${num(fio2)} = ${num(pf)} mmHg`,
      threshold: "≤ 300 mmHg",
      hit: pf <= 300,
      stage: 1,
      source: "creatinine",
    },
    {
      id: "pf_200",
      label: "P/F ≤ 200 mmHg（中度及以上）",
      observed: `${num(pf)} mmHg`,
      threshold: "≤ 200 mmHg",
      hit: pf <= 200,
      stage: 2,
      source: "creatinine",
    },
    {
      id: "pf_100",
      label: "P/F ≤ 100 mmHg（重度）",
      observed: `${num(pf)} mmHg`,
      threshold: "≤ 100 mmHg",
      hit: pf <= 100,
      stage: 3,
      source: "creatinine",
    },
  );

  const peepOk = peep != null && peep >= 5;
  let severity: ArdsResult["severity"] = "none";
  if (peepOk) {
    if (pf <= 100) severity = "severe";
    else if (pf <= 200) severity = "moderate";
    else if (pf <= 300) severity = "mild";
  }

  return { pf: Number(pf.toFixed(1)), severity, criteria };
}

export const SEVERITY_LABEL: Record<ArdsResult["severity"], string> = {
  none: "未达 ARDS 标准",
  mild: "轻度",
  moderate: "中度",
  severe: "重度",
  insufficient: "数据不足",
};

export const AKI_STAGE_LABEL: Record<number, string> = {
  0: "无 AKI",
  1: "1 期",
  2: "2 期",
  3: "3 期",
};
