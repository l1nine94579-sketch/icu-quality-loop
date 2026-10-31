/**
 * 合成数据生成器（确定性随机，可重复）。
 *
 * 生成 2026-08 / 09 / 10 三个月的 ICU 患者、检验、护理事件，
 * 再用与线上完全相同的规则引擎推导 patient_metrics，
 * 最后跑指标口径、冻结 8 月与 9 月的报告快照。
 *
 * 全部为合成数据，不含任何真实患者信息。
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { derivePatient } from "../lib/features";
import { INDICATORS } from "../lib/indicators";

const ROOT = process.cwd();
const DB_PATH = join(ROOT, "data", "icu.db");
const SCHEMA = readFileSync(join(ROOT, "db", "schema.sql"), "utf8");

if (process.argv.includes("--reset")) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = DB_PATH + suffix;
    if (!existsSync(p)) continue;
    try {
      rmSync(p, { force: true });
    } catch {
      console.error(
        `无法删除 ${p}：文件正被占用。请先停止 pnpm dev（或关闭占用 data/icu.db 的程序）后重试；\n` +
          `  也可以不加 --reset 直接运行 pnpm seed，脚本会清空业务表后重灌。`,
      );
      process.exit(1);
    }
  }
}
mkdirSync(join(ROOT, "data"), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec(SCHEMA);

// ---------------------------------------------------------------- utilities
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261031);
const rand = (min: number, max: number) => min + rnd() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const chance = (p: number) => rnd() < p;
const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

const HOUR = 3600 * 1000;
const iso = (d: Date) => d.toISOString();
const plusHours = (base: Date, h: number) => new Date(base.getTime() + h * HOUR);

// ---------------------------------------------------------------- 基础字典
const USERS = [
  { id: "u-nurse-1", name: "王敏", role: "nurse", title: "ICU 责任护士", dept: "重症医学科" },
  { id: "u-nurse-2", name: "李倩", role: "nurse", title: "ICU 责任护士", dept: "重症医学科" },
  { id: "u-doc-1", name: "陈立", role: "doctor", title: "ICU 主治医师", dept: "重症医学科" },
  { id: "u-qc-1", name: "周澜", role: "qc", title: "科室质控员", dept: "重症医学科" },
  { id: "u-dir-1", name: "赵国强", role: "director", title: "科主任", dept: "重症医学科" },
];

const SURNAMES = "张王李赵陈刘杨黄周吴徐孙胡朱高林何郭马罗梁宋唐许韩冯邓曹彭".split("");
const GIVEN = [
  "建国", "淑兰", "志强", "海燕", "文军", "秀英", "国强", "丽华", "振宇", "桂芳",
  "明辉", "玉梅", "立新", "红霞", "少华", "春燕", "德胜", "雅琴", "守义", "素芬",
];

type Archetype = {
  dx: string;
  resp: number;
  antibiotics: number;
  vent: number;
  akiBias: number;
};

const ARCHETYPES: Archetype[] = [
  { dx: "重症肺炎 / ARDS", resp: 0.95, antibiotics: 0.95, vent: 0.75, akiBias: 0.1 },
  { dx: "脓毒症休克", resp: 0.7, antibiotics: 1, vent: 0.5, akiBias: 0.45 },
  { dx: "脓毒症相关急性肾损伤", resp: 0.4, antibiotics: 1, vent: 0.25, akiBias: 0.85 },
  { dx: "胃癌根治术后", resp: 0.25, antibiotics: 0.85, vent: 0.35, akiBias: 0.05 },
  { dx: "急性左心衰", resp: 0.65, antibiotics: 0.25, vent: 0.4, akiBias: 0.2 },
  { dx: "重症急性胰腺炎", resp: 0.35, antibiotics: 0.9, vent: 0.3, akiBias: 0.35 },
  { dx: "多发伤（车祸伤）", resp: 0.45, antibiotics: 0.8, vent: 0.55, akiBias: 0.25 },
  { dx: "COPD 急性加重", resp: 0.85, antibiotics: 0.7, vent: 0.45, akiBias: 0.05 },
  { dx: "脑出血术后", resp: 0.5, antibiotics: 0.6, vent: 0.6, akiBias: 0.15 },
  { dx: "上消化道大出血", resp: 0.3, antibiotics: 0.4, vent: 0.2, akiBias: 0.2 },
];

// 月份基线：9 月整体偏弱，10 月改进后回升，制造真实的口径波动
const MONTH_PROFILE: Record<string, { dvt: number; culture: number; assess: number; aki: number }> = {
  "2026-08": { dvt: 0.8, culture: 0.82, assess: 0.92, aki: 0.22 },
  "2026-09": { dvt: 0.66, culture: 0.7, assess: 0.85, aki: 0.28 },
  "2026-10": { dvt: 0.76, culture: 0.79, assess: 0.9, aki: 0.24 },
};

// ---------------------------------------------------------------- 清空业务表
for (const table of [
  "agent_runs", "audit_logs", "qc_reports", "indicator_results", "indicator_defs",
  "patient_metrics", "care_events", "observations", "patients", "users",
]) {
  db.exec(`DELETE FROM ${table}`);
}

const insertUser = db.prepare("INSERT INTO users (id,name,role,title,dept) VALUES (?,?,?,?,?)");
for (const u of USERS) insertUser.run(u.id, u.name, u.role, u.title, u.dept);

const insertPatient = db.prepare(`INSERT INTO patients
  (id,mrn,name,gender,age,bed,dx,weight_kg,height_cm,apache_ii,admitted_at,discharged_at,status,outcome,allergy)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertObs = db.prepare(
  "INSERT INTO observations (patient_id,code,value,unit,measured_at,source,flag) VALUES (?,?,?,?,?,?,?)",
);
const insertEvent = db.prepare(
  "INSERT INTO care_events (patient_id,type,label,detail,at,by_user) VALUES (?,?,?,?,?,?)",
);
const insertMetrics = db.prepare(`INSERT INTO patient_metrics
  (patient_id,period,baseline_cr,peak_cr,aki_stage,aki_onset_at,pf_ratio,ards_severity,peep,gcs,
   assessed_24h,abx_started,culture_before_abx,dvt_prophylaxis,vent_started,stay_hours,evidence,computed_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const NOW = new Date("2026-10-31T08:00:00+08:00");

let seq = 0;
const usedNames = new Set<string>();
const patientsForDerive: {
  id: string;
  weightKg: number;
  admittedAt: string;
  dischargedAt: string | null;
  observations: { code: string; value: number; measuredAt: string }[];
  events: { type: string; at: string; label?: string }[];
}[] = [];

for (const period of ["2026-08", "2026-09", "2026-10"]) {
  const profile = MONTH_PROFILE[period];
  const [year, month] = period.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const count = period === "2026-10" ? 18 : 20;

  for (let i = 0; i < count; i += 1) {
    seq += 1;
    const id = `p-${period.replace("-", "")}-${String(i + 1).padStart(3, "0")}`;
    let name = pick(SURNAMES) + pick(GIVEN);
    while (usedNames.has(name)) name = pick(SURNAMES) + pick(GIVEN);
    usedNames.add(name);

    const arch = pick(ARCHETYPES);
    const admittedDay = period === "2026-10" ? randInt(1, 22) : randInt(1, Math.min(24, daysInMonth));
    const admittedAt = new Date(Date.UTC(year, month - 1, admittedDay, randInt(0, 15), randInt(0, 59)));
    const losDays = period === "2026-10" ? rand(3, 12) : rand(3, 16);
    let dischargedAt: Date | null = plusHours(admittedAt, losDays * 24);
    if (dischargedAt > NOW) dischargedAt = chance(0.5) ? null : NOW;

    const weight = Number(rand(48, 92).toFixed(1));
    const height = Number(rand(152, 186).toFixed(0));
    const age = randInt(26, 89);
    const apache = Math.max(4, Math.min(36, randInt(6, 24)));
    const gender = chance(0.45) ? "女" : "男";
    const bed = `ICU-${String(i + 1).padStart(2, "0")}`;
    const status = dischargedAt ? "discharged" : "in_icu";
    const outcome = dischargedAt ? (chance(0.12) ? "死亡" : "转出 ICU") : null;

    insertPatient.run(
      id, `ICU${period.replace("-", "")}${String(i + 1).padStart(3, "0")}`, name, gender, age, bed,
      arch.dx, weight, height, apache, iso(admittedAt), dischargedAt ? iso(dischargedAt) : null,
      status, outcome, chance(0.2) ? "青霉素" : null,
    );

    const observations: { code: string; value: number; measuredAt: string }[] = [];
    const events: { type: string; at: string; label?: string }[] = [];

    // ---- 肌酐：按目标峰值倍率生成序列
    const isAki = chance(Math.min(0.55, profile.aki + arch.akiBias * 0.4));
    const peakRatio = isAki ? pick([1.6, 1.7, 1.9, 2.1, 2.3, 2.6, 3.2, 3.8]) : rand(1.0, 1.35);
    const baseline = Number(rand(0.62, 1.25).toFixed(2));
    const stayHours = Math.min(
      (dischargedAt ? dischargedAt.getTime() : NOW.getTime()) - admittedAt.getTime(),
      18 * 24 * HOUR,
    ) / HOUR;
    const pointCount = Math.max(4, Math.round(stayHours / 14));
    // 22% 患者首份检验延迟，用来制造"48h 内未识别"；延迟不能超过住院时长
    const rawDelay = chance(0.22) ? rand(32, 70) : rand(0.5, 4);
    const firstLabDelay = Math.min(rawDelay, Math.max(1, stayHours * 0.3));
    for (let k = 0; k < pointCount; k += 1) {
      const t = plusHours(admittedAt, firstLabDelay + (k * stayHours) / pointCount);
      if (t > NOW) break;
      const progress = Math.min(1, k / Math.max(1, pointCount * 0.55));
      const ratio = 1 + (peakRatio - 1) * progress;
      observations.push({
        code: "creatinine",
        value: Number((baseline * ratio * rand(0.97, 1.03)).toFixed(2)),
        measuredAt: iso(t),
      });
    }

    // ---- 尿量：每小时一条，部分 AKI 患者出现低尿量窗口
    const urineHours = Math.min(48, Math.round(stayHours));
    const lowUrine = isAki && chance(0.35);
    for (let h = 1; h <= urineHours; h += 1) {
      const t = plusHours(admittedAt, h + firstLabDelay);
      if (t > NOW) break;
      const inLowWindow = lowUrine && h >= 8 && h <= 8 + randInt(7, 22);
      const ml = inLowWindow ? rand(0.18, 0.42) * weight : rand(0.7, 1.6) * weight;
      observations.push({ code: "urine_ml", value: Number(ml.toFixed(0)), measuredAt: iso(t) });
    }

    // ---- 血气 / 呼吸支持
    const needsVent = chance(arch.vent);
    if (needsVent) {
      events.push({ type: "vent_start", at: iso(plusHours(admittedAt, rand(0, 6))), label: "气管插管接呼吸机" });
    }
    const abgCount = needsVent || chance(arch.resp) ? randInt(2, 4) : 0;
    const skipAbg = needsVent && chance(0.06);
    for (let k = 0; k < (skipAbg ? 0 : abgCount); k += 1) {
      const t = plusHours(admittedAt, rand(2, Math.max(4, stayHours - 2)));
      if (t > NOW) continue;
      observations.push({ code: "pao2", value: Number(rand(55, 145).toFixed(0)), measuredAt: iso(t) });
      if (!chance(0.15)) observations.push({ code: "fio2", value: Number(rand(0.35, 1).toFixed(2)), measuredAt: iso(t) });
      if (needsVent) observations.push({ code: "peep", value: randInt(5, 14), measuredAt: iso(t) });
    }

    // ---- GCS / 早期评估
    observations.push({ code: "gcs", value: randInt(5, 15), measuredAt: iso(plusHours(admittedAt, rand(0.5, 3))) });
    const assessEarly = chance(profile.assess);
    events.push({
      type: "assessment",
      at: iso(plusHours(admittedAt, assessEarly ? rand(0.5, 8) : rand(26, 44))),
      label: "入科早期评估（GCS / APACHEⅡ）",
    });

    // ---- 抗菌药与病原学送检
    if (chance(arch.antibiotics)) {
      const abxAt = plusHours(admittedAt, rand(2, 28));
      if (abxAt <= NOW) {
        if (chance(profile.culture)) {
          events.push({ type: "culture", at: iso(plusHours(abxAt, -rand(1, 6))), label: "血培养 + 痰培养送检" });
        } else if (chance(0.7)) {
          events.push({ type: "culture", at: iso(plusHours(abxAt, rand(3, 12))), label: "痰培养送检（晚于首剂）" });
        }
        events.push({ type: "abx_start", at: iso(abxAt), label: "首剂抗菌药物（哌拉西林他唑巴坦）" });
      }
    }

    // ---- DVT 预防
    const dvtEarly = chance(profile.dvt);
    events.push({
      type: "dvt_prophylaxis",
      at: iso(plusHours(admittedAt, dvtEarly ? rand(2, 22) : rand(28, 52))),
      label: dvtEarly ? "间歇充气加压 + 低分子肝素" : "低分子肝素（延迟执行）",
    });

    for (const o of observations) {
      const unit = o.code === "urine_ml" ? "mL/h"
        : o.code === "fio2" ? "ratio"
        : o.code === "gcs" ? "分"
        : o.code === "pao2" ? "mmHg"
        : o.code === "peep" ? "cmH2O"
        : "mg/dL";
      insertObs.run(id, o.code, o.value, unit, o.measuredAt, o.code === "urine_ml" ? "护理记录" : "LIS", null);
    }
    for (const e of events) insertEvent.run(id, e.type, e.label ?? e.type, null, e.at, "u-nurse-1");

    patientsForDerive.push({
      id,
      weightKg: weight,
      admittedAt: iso(admittedAt),
      dischargedAt: dischargedAt ? iso(dischargedAt) : null,
      observations,
      events,
    });
  }
}

// ---------------------------------------------------------------- 派生层
for (const p of patientsForDerive) {
  const m = derivePatient({ ...p, now: NOW });
  insertMetrics.run(
    p.id,
    p.admittedAt.slice(0, 7),
    m.baselineCr,
    m.peakCr,
    m.akiStage,
    m.akiOnsetAt,
    m.pfRatio,
    m.ardsSeverity,
    m.peep,
    m.gcs,
    m.assessed24h,
    m.abxStarted,
    m.cultureBeforeAbx,
    m.dvtProphylaxis,
    m.ventStarted,
    m.stayHours,
    m.evidence,
    NOW.toISOString(),
  );
}

// ---------------------------------------------------------------- 指标口径
const insertDef = db.prepare(`INSERT OR REPLACE INTO indicator_defs
  (code,name,category,unit,target,direction,formula,rationale,sql,owner,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
for (const d of INDICATORS) {
  insertDef.run(d.code, d.name, d.category, d.unit, d.target, d.direction ?? "up", d.formula, d.rationale, d.sql, d.owner, d.sort);
}

function compute(code: string, period: string) {
  const def = INDICATORS.find((d) => d.code === code)!;
  const rows = db.prepare(def.sql).all(period) as { patient_id: string; eligible: number; hit: number }[];
  const denominator = rows.reduce((s, r) => s + Number(r.eligible ?? 0), 0);
  const numerator = rows.reduce((s, r) => s + Number(r.hit ?? 0), 0);
  return {
    numerator,
    denominator,
    rate: denominator ? numerator / denominator : null,
    patientIds: rows.filter((r) => Number(r.hit) === 1).map((r) => r.patient_id),
  };
}

const insertResult = db.prepare(`INSERT OR REPLACE INTO indicator_results
  (period,code,numerator,denominator,rate,computed_at,computed_by) VALUES (?,?,?,?,?,?,?)`);

const PERIODS = ["2026-08", "2026-09", "2026-10"];
for (const period of PERIODS) {
  for (const def of INDICATORS) {
    const r = compute(def.code, period);
    insertResult.run(period, def.code, r.numerator, r.denominator, r.rate, `${period}-28T18:00:00.000Z`, "u-qc-1");
  }
}

// ---------------------------------------------------------------- 报告与审计
const insertReport = db.prepare(`INSERT INTO qc_reports
  (period,status,version,submit_note,submitted_by,submitted_at,reviewed_by,reviewed_at,review_note,reported_at,snapshot)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const insertAudit = db.prepare(`INSERT INTO audit_logs
  (at,actor_id,actor_name,role,action,entity,entity_id,before_json,after_json,note)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);

function snapshotFor(period: string, version: number, frozenAt: string) {
  return JSON.stringify({
    version,
    frozenAt,
    frozenBy: "周澜",
    items: INDICATORS.map((def) => {
      const r = compute(def.code, period);
      return {
        code: def.code,
        name: def.name,
        numerator: r.numerator,
        denominator: r.denominator,
        rate: r.rate,
        patientIds: r.patientIds,
      };
    }),
  });
}

const augFrozen = "2026-09-03T02:05:00.000Z";
insertReport.run(
  "2026-08", "reported", 2,
  "8 月报告已按质控科要求补充说明：DVT 预防与病原学送检两项环比下降，系 8 月中旬床位扩容、新入科护士培训期间执行延迟，9 月起恢复双人核查。",
  "u-qc-1", "2026-09-03T02:05:00.000Z", "u-dir-1", "2026-09-03T08:20:00.000Z",
  "同意上报。请持续跟踪 DVT 预防执行率，9 月纳入晨交班通报。", "2026-09-05T03:00:00.000Z",
  snapshotFor("2026-08", 2, augFrozen),
);

insertAudit.run("2026-09-02T01:10:00.000Z", "u-qc-1", "周澜", "qc", "report_submitted", "qc_report", "2026-08", JSON.stringify({ status: "draft" }), JSON.stringify({ status: "submitted", version: 1 }), "首次提交 8 月质控报告");
insertAudit.run("2026-09-02T07:40:00.000Z", "u-dir-1", "赵国强", "director", "report_returned", "qc_report", "2026-08", JSON.stringify({ status: "submitted" }), JSON.stringify({ status: "returned", version: 2 }), "DVT 预防率环比下降 14 个百分点，送检率下降 12 个百分点，请在提交说明中写清原因后再报。");
insertAudit.run("2026-09-03T02:05:00.000Z", "u-qc-1", "周澜", "qc", "report_submitted", "qc_report", "2026-08", JSON.stringify({ status: "returned", version: 1 }), JSON.stringify({ status: "submitted", version: 2 }), "已补充说明：床位扩容期间新护士培训导致执行延迟。");
insertAudit.run("2026-09-03T08:20:00.000Z", "u-dir-1", "赵国强", "director", "report_approved", "qc_report", "2026-08", JSON.stringify({ status: "submitted" }), JSON.stringify({ status: "approved" }), "同意上报。");
insertAudit.run("2026-09-05T03:00:00.000Z", "u-qc-1", "周澜", "qc", "report_reported", "qc_report", "2026-08", JSON.stringify({ status: "approved" }), JSON.stringify({ status: "reported" }), "已上报省级重症质控中心（演示为本地模拟）");

const sepFrozen = "2026-10-09T01:30:00.000Z";
insertReport.run(
  "2026-09", "submitted", 1,
  "9 月报告：AKI 48h 内识别率较上月下降，主要因 9 月 12 日 LIS 接口升级导致部分肌酐回报延迟；病原学送检率同步下降，已在科务会提出整改。",
  "u-qc-1", sepFrozen, null, null, null, null,
  snapshotFor("2026-09", 1, sepFrozen),
);
insertAudit.run("2026-10-08T02:00:00.000Z", "u-qc-1", "周澜", "qc", "metrics_rebuilt", "period", "2026-09", null, JSON.stringify({ patients: 14 }), "按最新检验数据重算 9 月患者派生指标");
insertAudit.run("2026-10-09T01:30:00.000Z", "u-qc-1", "周澜", "qc", "report_submitted", "qc_report", "2026-09", JSON.stringify({ status: "draft" }), JSON.stringify({ status: "submitted", version: 1 }), "提交 9 月质控报告，等待科主任审核。");

insertReport.run("2026-10", "draft", 1, null, null, null, null, null, null, null, null);

insertAudit.run("2026-10-28T09:12:00.000Z", "u-nurse-2", "李倩", "nurse", "observation_added", "patient", "p-202610-003", null, JSON.stringify({ code: "creatinine", value: 2.31 }), "补录外院带入的肌酐结果");
insertAudit.run("2026-10-29T01:20:00.000Z", "u-qc-1", "周澜", "qc", "report_recomputed", "qc_report", "2026-10", null, JSON.stringify({ note: "月初数据尚未完整" }), "10 月口径试算");

// ---------------------------------------------------------------- 汇总输出
const counts = {
  patients: db.prepare("SELECT COUNT(*) c FROM patients").get() as { c: number },
  obs: db.prepare("SELECT COUNT(*) c FROM observations").get() as { c: number },
  events: db.prepare("SELECT COUNT(*) c FROM care_events").get() as { c: number },
  reports: db.prepare("SELECT COUNT(*) c FROM qc_reports").get() as { c: number },
};
const summary = PERIODS.map((period) => {
  const parts = INDICATORS.map((d) => {
    const r = compute(d.code, period);
    return `${d.code}=${r.rate != null ? (r.rate * 100).toFixed(0) : "-"}%(${r.numerator}/${r.denominator})`;
  });
  return `${period}: ${parts.join("  ")}`;
}).join("\n");
console.log(`seeded: ${counts.patients.c} patients, ${counts.obs.c} observations, ${counts.events.c} care events, ${counts.reports.c} reports`);
console.log(summary);
db.close();
