import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAki, evaluateArds } from "../lib/engine";

const at = (h: number) => new Date(Date.UTC(2026, 8, 1, h)).toISOString();

test("无肌酐升高时判为无 AKI", () => {
  const r = evaluateAki({
    baselineCr: 1.0,
    creatinines: [
      { at: at(0), value: 1.0 },
      { at: at(12), value: 1.1 },
      { at: at(24), value: 0.95 },
    ],
    urines: [],
    weightKg: 70,
  });
  assert.equal(r.stage, 0);
  assert.equal(r.peakRatio, 1.1);
});

test("肌酐 1.75 倍判为 1 期，并给出命中判据", () => {
  const r = evaluateAki({
    baselineCr: 1.0,
    creatinines: [
      { at: at(0), value: 1.0 },
      { at: at(24), value: 1.75 },
    ],
    urines: [],
    weightKg: 70,
  });
  assert.equal(r.stage, 1);
  const hit = r.criteria.find((c) => c.id === "cr_1_5x");
  assert.ok(hit?.hit);
  assert.match(hit!.observed, /1\.75/);
});

test("肌酐 3 倍直接判为 3 期", () => {
  const r = evaluateAki({
    baselineCr: 1.0,
    creatinines: [
      { at: at(0), value: 1.0 },
      { at: at(30), value: 3.2 },
    ],
    urines: [],
    weightKg: 70,
  });
  assert.equal(r.stage, 3);
});

test("48h 内绝对升高 0.3 mg/dL 判为 1 期", () => {
  const r = evaluateAki({
    baselineCr: 1.0,
    creatinines: [
      { at: at(0), value: 1.0 },
      { at: at(40), value: 1.32 },
    ],
    urines: [],
    weightKg: 70,
  });
  assert.equal(r.stage, 1);
  const hit = r.criteria.find((c) => c.id === "cr_delta_48h");
  assert.ok(hit?.hit);
});

test("尿量 < 0.5 mL/kg/h 持续 6h 触发 1 期", () => {
  const urines = Array.from({ length: 8 }, (_, i) => ({ at: at(i), ml: 25 }));
  const r = evaluateAki({ baselineCr: 1.0, creatinines: [{ at: at(0), value: 1.0 }], urines, weightKg: 70 });
  assert.equal(r.stage, 1);
  const hit = r.criteria.find((c) => c.id === "urine_6h");
  assert.ok(hit?.hit);
});

test("缺少基线肌酐时明确标记数据不足，不做推定", () => {
  const r = evaluateAki({ baselineCr: null, creatinines: [], urines: [], weightKg: 70 });
  assert.equal(r.insufficient, true);
  assert.equal(r.stage, 0);
});

test("P/F 133 且 PEEP 8 判为中度 ARDS", () => {
  const r = evaluateArds({ pao2: 80, fio2: 0.6, peep: 8 });
  assert.equal(r.severity, "moderate");
  assert.equal(r.pf, 133.3);
});

test("PEEP 不足 5 时不判 ARDS", () => {
  const r = evaluateArds({ pao2: 80, fio2: 1.0, peep: 4 });
  assert.equal(r.severity, "none");
});

test("缺少 FiO₂ 时返回数据不足", () => {
  const r = evaluateArds({ pao2: 80, fio2: null, peep: 8 });
  assert.equal(r.severity, "insufficient");
  assert.equal(r.pf, null);
});
