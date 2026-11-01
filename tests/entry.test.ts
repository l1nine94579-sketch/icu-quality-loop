import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { User } from "../lib/roles";
import { PermissionError } from "../lib/permissions";

const source = join(process.cwd(), "data", "icu.db");
const scratch = join(process.cwd(), "data", "_test_entry.db");
const hasDb = existsSync(source);

if (hasDb) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(scratch + suffix, { force: true });
    if (existsSync(source + suffix)) copyFileSync(source + suffix, scratch + suffix);
  }
  process.env.ICU_DB_PATH = scratch;
}

const SKIP = !hasDb ? "缺少 data/icu.db，请先执行 pnpm seed" : false;

const nurse: User = { id: "u-nurse-1", name: "王敏", role: "nurse", title: "责任护士", dept: "重症医学科" };
const doctor: User = { id: "u-doc-1", name: "陈立", role: "doctor", title: "主治医师", dept: "重症医学科" };

test("补录 DVT 预防事件 → 重算 → 指标上升 → 审计留痕", { skip: SKIP }, async () => {
  const { addCareEvent, entryMessage } = await import("../lib/entry");
  const { computeIndicator, listIndicatorDefs } = await import("../lib/indicators");
  const { all } = await import("../lib/db");

  const def = listIndicatorDefs().find((d) => d.code === "DVT_PRO")!;
  const before = computeIndicator(def, "2026-10");
  assert.ok(before.denominator > 0, "分母应大于 0");

  const target = all<{ patient_id: string; admitted_at: string; name: string }>(
    `SELECT m.patient_id, p.admitted_at, p.name
       FROM patient_metrics m JOIN patients p ON p.id = m.patient_id
      WHERE m.period = '2026-10' AND m.dvt_prophylaxis = 0
      LIMIT 1`,
  )[0];
  assert.ok(target, "应存在未落实 DVT 预防的患者");

  const at = new Date(new Date(target.admitted_at).getTime() + 2 * 3600 * 1000).toISOString();
  const result = addCareEvent({ patientId: target.patient_id, type: "dvt_prophylaxis", at, actor: nurse });

  assert.equal(result.frozen, false, "2026-10 尚未冻结");
  assert.ok(result.changes.some((c) => c.code === "DVT_PRO"), "应报告 DVT_PRO 发生变化");

  const after = computeIndicator(def, "2026-10");
  assert.ok(after.numerator > before.numerator, "分子应增加");
  assert.ok((after.rate ?? 0) > (before.rate ?? 0), "指标应上升");

  const metrics = all<{ dvt_prophylaxis: number }>(
    "SELECT dvt_prophylaxis FROM patient_metrics WHERE patient_id = ?",
    target.patient_id,
  )[0];
  assert.equal(metrics.dvt_prophylaxis, 1, "派生层应同步为已完成");

  const audit = all<{ action: string; note: string }>(
    "SELECT action, note FROM audit_logs WHERE entity_id = ? AND action = 'event_added'",
    target.patient_id,
  );
  assert.ok(audit.length >= 1, "应写入补录审计");

  const message = entryMessage(result);
  assert.match(message, /影响指标/);
  assert.match(message, /DVT 预防措施落实率/);
});

test("医生没有补录权限", { skip: SKIP }, async () => {
  const { addObservation } = await import("../lib/entry");
  assert.throws(
    () => addObservation({ patientId: "p-202610-001", code: "creatinine", value: 1.2, actor: doctor }),
    (err: unknown) => err instanceof PermissionError && err.capability === "patient:edit",
  );
});

test("补录数值超出临床范围会被拒绝", { skip: SKIP }, async () => {
  const { addObservation } = await import("../lib/entry");
  assert.throws(
    () => addObservation({ patientId: "p-202610-001", code: "creatinine", value: -3, actor: nurse }),
    /应在/,
  );
  assert.throws(
    () => addObservation({ patientId: "p-202610-001", code: "fio2", value: 1.8, actor: nurse }),
    /应在/,
  );
});

test("补录肌酐推高分期后，AKI 指标与患者结论同步", { skip: SKIP }, async () => {
  const { addObservation } = await import("../lib/entry");
  const { computeIndicator, listIndicatorDefs } = await import("../lib/indicators");
  const { all } = await import("../lib/db");

  const def = listIndicatorDefs().find((d) => d.code === "AKI_RATE")!;
  const before = computeIndicator(def, "2026-10");

  const target = all<{ patient_id: string; admitted_at: string; aki_stage: number }>(
    `SELECT m.patient_id, p.admitted_at, m.aki_stage
       FROM patient_metrics m JOIN patients p ON p.id = m.patient_id
      WHERE m.period = '2026-10' AND m.aki_stage = 0
      LIMIT 1`,
  )[0];
  assert.ok(target, "应存在无 AKI 的患者");

  const at = new Date(new Date(target.admitted_at).getTime() + 36 * 3600 * 1000).toISOString();
  addObservation({ patientId: target.patient_id, code: "creatinine", value: 9.9, measuredAt: at, actor: nurse });

  const stage = all<{ aki_stage: number }>(
    "SELECT aki_stage FROM patient_metrics WHERE patient_id = ?",
    target.patient_id,
  )[0];
  assert.ok(stage.aki_stage >= 1, "肌酐 9.9 应触发 AKI 分期");

  const after = computeIndicator(def, "2026-10");
  assert.ok(after.numerator >= before.numerator, "AKI 分子不应减少");
});
