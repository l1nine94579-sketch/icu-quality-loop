import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

/**
 * 指标口径与报告流转测试。
 * 复制一份种子库到临时文件再跑，避免污染演示数据。
 */
const source = join(process.cwd(), "data", "icu.db");
const scratch = join(process.cwd(), "data", "_test.db");
const hasDb = existsSync(source);

if (hasDb) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(scratch + suffix, { force: true });
    if (existsSync(source + suffix)) copyFileSync(source + suffix, scratch + suffix);
  }
  process.env.ICU_DB_PATH = scratch;
}

const SKIP = !hasDb ? "缺少 data/icu.db，请先执行 pnpm seed" : false;

test("指标口径：分子分母均可在患者粒度复现", { skip: SKIP }, async () => {
  const { computeIndicator, listIndicatorDefs } = await import("../lib/indicators");
  const defs = listIndicatorDefs();
  assert.ok(defs.length >= 7, "指标口径库应有至少 7 项指标");

  for (const def of defs) {
    const r = computeIndicator(def, "2026-10");
    assert.ok(r.denominator >= 0, `${def.code} 分母非法`);
    assert.ok(r.numerator <= r.denominator, `${def.code} 分子不应大于分母`);
    if (r.denominator > 0) {
      assert.equal(Number((r.rate! * 100).toFixed(6)), Number(((r.numerator / r.denominator) * 100).toFixed(6)));
    }
  }
});

test("报告流转：退回后版本号递增，重新提交生成新快照", { skip: SKIP }, async () => {
  const { getReport, returnReport, submitReport } = await import("../lib/reports");
  const qc = { id: "u-qc-1", name: "周澜", role: "qc" as const, title: "科室质控员", dept: "重症医学科" };
  const director = { id: "u-dir-1", name: "赵国强", role: "director" as const, title: "科主任", dept: "重症医学科" };

  const before = getReport("2026-10");
  assert.equal(before.status, "draft");

  submitReport("2026-10", qc, "测试提交：本月指标口径完整，波动项已解释。");
  const submitted = getReport("2026-10");
  assert.equal(submitted.status, "submitted");
  assert.ok(submitted.snapshot, "提交时必须生成冻结快照");

  returnReport("2026-10", director, "退回原因：请补充 AKI 检出率的口径说明。");
  const returned = getReport("2026-10");
  assert.equal(returned.status, "returned");
  assert.equal(returned.version, submitted.version + 1);

  submitReport("2026-10", qc, "已补充 AKI 检出率口径说明，重新提交。");
  const resubmitted = getReport("2026-10");
  assert.equal(resubmitted.status, "submitted");
  assert.equal(resubmitted.version, returned.version);
  assert.ok(resubmitted.snapshot);
});

test("提交校验：波动超 15pp 且说明过短时阻断", { skip: SKIP }, async () => {
  const { validateSubmission } = await import("../lib/reports");
  const issues = validateSubmission("2026-10", "太短");
  assert.ok(issues.some((i) => i.blocking), "过短的说明不应通过校验");
  const ok = validateSubmission("2026-10", "本月 DVT 预防率下降主要因新人培训，已安排双人核查并在晨交班通报。");
  assert.equal(ok.filter((i) => i.blocking).length, 0, "充分说明后不应再有阻断项");
});
