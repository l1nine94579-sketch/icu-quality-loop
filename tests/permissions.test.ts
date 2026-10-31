import assert from "node:assert/strict";
import { test } from "node:test";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { can, capabilitiesOf, PermissionError } from "../lib/permissions";
import type { User } from "../lib/roles";

const source = join(process.cwd(), "data", "icu.db");
const scratch = join(process.cwd(), "data", "_test_perm.db");
const hasDb = existsSync(source);

if (hasDb) {
  for (const suffix of ["", "-wal", "-shm"]) {
    rmSync(scratch + suffix, { force: true });
    if (existsSync(source + suffix)) copyFileSync(source + suffix, scratch + suffix);
  }
  process.env.ICU_DB_PATH = scratch;
}

const SKIP = !hasDb ? "缺少 data/icu.db，请先执行 pnpm seed" : false;

const user = (role: User["role"]): User => ({
  id: `u-${role}`,
  name: role,
  role,
  title: role,
  dept: "重症医学科",
});

test("权限矩阵：各角色边界清晰", () => {
  assert.ok(can("qc", "report:submit"));
  assert.ok(!can("nurse", "report:submit"));
  assert.ok(!can("doctor", "report:submit"));
  assert.ok(!can("director", "report:submit"));

  assert.ok(can("director", "report:review"));
  assert.ok(!can("qc", "report:review"));
  assert.ok(!can("nurse", "report:review"));

  assert.ok(can("qc", "audit:view"));
  assert.ok(can("director", "audit:view"));
  assert.ok(!can("nurse", "audit:view"));
  assert.ok(!can("doctor", "audit:view"));

  assert.ok(can("nurse", "agent:patient"));
  assert.ok(can("doctor", "agent:patient"));
  assert.ok(!can("qc", "agent:patient"));
  assert.ok(can("qc", "agent:period"));
  assert.ok(!can("nurse", "agent:period"));

  // 每个角色都应至少有一项能力，且不能出现空角色
  for (const role of ["nurse", "doctor", "qc", "director"] as const) {
    assert.ok(capabilitiesOf(role).length > 0, `${role} 能力为空`);
  }
});

test("护士提交报告被服务端拒绝", { skip: SKIP }, async () => {
  const { submitReport } = await import("../lib/reports");
  assert.throws(
    () => submitReport("2026-10", user("nurse"), "护士尝试提交报告，说明足够长可以通过校验。"),
    (err: unknown) => err instanceof PermissionError && err.capability === "report:submit",
  );
});

test("质控员审核报告被拒绝，科主任可以审核", { skip: SKIP }, async () => {
  const { submitReport, approveReport, getReport } = await import("../lib/reports");
  const qc = user("qc");
  const director = user("director");

  submitReport("2026-10", qc, "本月指标口径完整，波动项已在说明中解释，申请审核。");
  assert.equal(getReport("2026-10").status, "submitted");

  assert.throws(
    () => approveReport("2026-10", qc, "自己审自己"),
    (err: unknown) => err instanceof PermissionError && err.capability === "report:review",
  );

  approveReport("2026-10", director, "同意上报。");
  assert.equal(getReport("2026-10").status, "approved");
});

test("医生不能重算派生指标，护士可以", () => {
  assert.ok(!can("doctor", "patient:edit"));
  assert.ok(can("nurse", "patient:edit"));
  assert.ok(can("qc", "patient:edit"));
});
